-- 0830_share_links_join.sql
--
-- A view link gets a way in. Until now only an edit ("invite") link could be
-- joined (claim_collab_link); a view link showed the cluster and stopped.
--
--   get_share_meta    + link_kind, can_join, sharer_name (first word of the
--                       maker's display name, never an email), card_count,
--                       cluster_count, workspace_id (the Worker builds the
--                       share card's storage key from it). Still `returns json`, so CREATE OR
--                       REPLACE keeps its grants (anon reads it for the
--                       Worker's link preview and the /share page).
--   join_view_link    a signed-in person joins the cluster a view link shows,
--                       as a named viewer (board_shares role 'viewer',
--                       invited_by = the link's maker). The maker hears
--                       ('joined', same toast + email as an edit link).
--   edit_requests     "Ask to edit": a viewer asks, the link's maker or the
--                       cluster's owner answers in one tap. A yes goes
--                       through the 10-editor limit like every other door.
--   request_edit / answer_edit_request / list_edit_requests
--   _tg_share_notification_email: emails 'edit_request' and 'edit_granted'
--                       (only when the person is offline, like 'joined').
--
-- A view link that leaves sub-clusters out (include_subboards = false) on a
-- cluster that has some cannot be joined: a share on a cluster reaches the
-- clusters inside it, which would hand out more than the sharer chose.
--
-- Link tokens never go into analytics props.

-- ── 1. get_share_meta ──────────────────────────────────────────────────────
create or replace function public.get_share_meta(p_token uuid, p_board_id uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_root_id   uuid;
  v_target    uuid;
  v_allow     boolean;
  v_include   boolean;
  v_board     record;
  v_slug      text;
  v_kind      text;
  v_role      text;
  v_maker     uuid;
  v_name      text;
  v_cards     int;
  v_clusters  int;
  v_has_kids  boolean;
begin
  select t.root_id, t.target_id, t.allow_indexing, t.include_subboards
    into v_root_id, v_target, v_allow, v_include
  from public._resolve_share_target(p_token, p_board_id) t;

  select b.id, b.workspace_id, b.name, b.thumb_key, b.thumb_updated_at, b.thumb_version into v_board
  from boards b where b.id = v_target;

  select pb.slug into v_slug
  from public_boards pb
  where pb.board_id = v_target and pb.published_at is not null;

  select l.kind, l.role, l.created_by into v_kind, v_role, v_maker
  from public_share_links l where l.token = p_token;

  -- First word of the display name only. An address-looking name is no name.
  select nullif(split_part(btrim(p.display_name), ' ', 1), '') into v_name
  from public.profiles p where p.user_id = v_maker;
  if v_name is not null and (position('@' in v_name) > 0 or length(v_name) > 40) then
    v_name := null;
  end if;

  select count(*) filter (where ci.kind not in ('board', 'boardlink', 'shape')),
         count(*) filter (where ci.kind = 'board')
    into v_cards, v_clusters
  from public.card_index ci where ci.board_id = v_target;

  select exists (select 1 from boards c where c.parent_board_id = v_root_id and c.deleted_at is null)
    into v_has_kids;

  return json_build_object(
    'board_id', v_board.id,
    'workspace_id', v_board.workspace_id,
    'root_id', v_root_id,
    'name', v_board.name,
    'thumb_key', v_board.thumb_key,
    'thumb_updated_at', v_board.thumb_updated_at,
    'thumb_version', v_board.thumb_version,
    'allow_indexing', coalesce(v_allow, false),
    'public_slug', v_slug,
    'link_kind', coalesce(v_kind, 'view'),
    'link_role', coalesce(v_role, 'viewer'),
    'can_join', coalesce(v_kind, 'view') = 'invite'
                or coalesce(v_include, false)
                or not coalesce(v_has_kids, false),
    'sharer_name', v_name,
    'card_count', coalesce(v_cards, 0),
    'cluster_count', coalesce(v_clusters, 0)
  );
end;
$function$;


-- ── 2. join_view_link ──────────────────────────────────────────────────────
create or replace function public.join_view_link(p_token uuid)
returns table(workspace_id uuid, board_id uuid, role text, status text)
language plpgsql
security definer
set search_path = public, auth
as $function$
#variable_conflict use_column
declare
  v_link         public_share_links%rowtype;
  v_workspace    uuid;
  v_owner        uuid;
  v_existing     board_shares%rowtype;
  v_joiner_name  text;
  v_is_new_user  boolean;
  v_has_card     boolean;
  v_ref_ins      int := 0;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to join' using errcode = '42501';
  end if;
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select * into v_link from public_share_links where token = p_token;
  if not found or v_link.kind is distinct from 'view' then
    raise exception 'share link not found' using errcode = 'P0002';
  end if;
  if v_link.revoked_at is not null then
    raise exception 'this share link was turned off' using errcode = '22023';
  end if;
  if v_link.expires_at is not null and v_link.expires_at <= now() then
    raise exception 'this share link has expired' using errcode = '22023';
  end if;
  if public._sharer_suspended(v_link.created_by) then
    raise exception 'this share link was turned off' using errcode = '22023';
  end if;
  -- 0525: a link works only while its maker can still edit the cluster.
  if not public._user_can_write_board(v_link.created_by, v_link.board_id) then
    raise exception 'this share link was turned off' using errcode = '22023';
  end if;

  select b.workspace_id, w.created_by into v_workspace, v_owner
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = v_link.board_id and b.deleted_at is null;
  if v_workspace is null then
    raise exception 'board no longer exists' using errcode = 'P0002';
  end if;
  if public._user_banned(v_owner) then
    raise exception 'board no longer exists' using errcode = 'P0002';
  end if;

  -- Already the owner / a workspace member: nothing to grant.
  if v_owner = auth.uid() or is_workspace_member(v_workspace) then
    return query select v_workspace, v_link.board_id, 'owner'::text, 'noop'::text;
    return;
  end if;

  -- Already shared (either role): keep what they have.
  select * into v_existing
  from board_shares bs
  where bs.board_id = v_link.board_id and bs.user_id = auth.uid();
  if found then
    return query select v_workspace, v_link.board_id, v_existing.role, 'already'::text;
    return;
  end if;

  -- Reaches them already through a parent cluster's share: nothing to add.
  if public.can_read_board(v_link.board_id) then
    return query select v_workspace, v_link.board_id,
      case when public.can_write_board(v_link.board_id) then 'editor' else 'viewer' end,
      'already'::text;
    return;
  end if;

  -- A link that leaves sub-clusters out can't be joined on a cluster that has
  -- some: the share would reach them.
  if not coalesce(v_link.include_subboards, false)
     and exists (select 1 from boards c
                  where c.parent_board_id = v_link.board_id and c.deleted_at is null) then
    raise exception 'this link shares one cluster only' using errcode = '22023';
  end if;

  insert into board_shares (board_id, user_id, role, invited_by, via_link_token)
  values (v_link.board_id, auth.uid(), 'viewer', v_link.created_by, v_link.token)
  on conflict (board_id, user_id) do nothing;

  -- The maker hears (toast + email via the share_notifications trigger).
  begin
    if v_link.created_by is not null and v_link.created_by <> auth.uid() then
      select coalesce(nullif(p.display_name, ''), u.email, 'Someone')
        into v_joiner_name
      from auth.users u
      left join public.profiles p on p.user_id = u.id
      where u.id = auth.uid();
      insert into share_notifications (user_id, board_id, role, shared_by, kind, detail)
      values (v_link.created_by, v_link.board_id, 'viewer', auth.uid(), 'joined', v_joiner_name);
    end if;
  exception when others then
    raise warning 'join_view_link: joined notification failed: %', sqlerrm;
  end;

  -- Referral ledger, as claim_collab_link (0525): a NEW account (< 7 days)
  -- credits the link's maker. source stays 'collab'; meta says which link.
  begin
    select (u.created_at > now() - interval '7 days') into v_is_new_user
    from auth.users u where u.id = auth.uid();
    if coalesce(v_is_new_user, false)
       and v_link.created_by is not null
       and v_link.created_by <> auth.uid() then
      insert into public.referrals (referrer_id, referee_id, source, status, meta)
      values (v_link.created_by, auth.uid(), 'collab', 'pending',
              jsonb_build_object('via', 'view_link', 'board_id', v_link.board_id::text))
      on conflict (referee_id) do nothing;
      get diagnostics v_ref_ins = row_count;
      if v_ref_ins > 0 then
        update public.profiles
           set bonus_card_credits = coalesce(bonus_card_credits, 0) + 25
         where user_id = auth.uid();
        insert into public.analytics_events (user_id, event, props)
        values (auth.uid(), 'referral_signup',
                jsonb_build_object('source', 'collab', 'via', 'view_link'));
        select (first_card_at is not null) into v_has_card
        from public.profiles where user_id = auth.uid();
        if coalesce(v_has_card, false) then
          perform public.grant_referral_reward(auth.uid());
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'join_view_link: referral block failed: %', sqlerrm;
  end;

  begin
    insert into public.analytics_events (user_id, event, props)
    values (auth.uid(), 'view_link_joined',
            jsonb_build_object('board_id', v_link.board_id, 'role', 'viewer', 'status', 'joined'));
  exception when others then null;
  end;

  return query select v_workspace, v_link.board_id, 'viewer'::text, 'joined'::text;
end;
$function$;

revoke execute on function public.join_view_link(uuid) from public, anon;
grant execute on function public.join_view_link(uuid) to authenticated, service_role;


-- ── 3. edit_requests ───────────────────────────────────────────────────────
create table if not exists public.edit_requests (
  id            uuid primary key default gen_random_uuid(),
  board_id      uuid not null references public.boards(id) on delete cascade,
  requester_id  uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'yes', 'not_now')),
  created_at    timestamptz not null default now(),
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz
);
create unique index if not exists edit_requests_one_pending
  on public.edit_requests (board_id, requester_id) where status = 'pending';
create index if not exists edit_requests_board_idx
  on public.edit_requests (board_id, created_at desc);
create index if not exists edit_requests_requester_idx
  on public.edit_requests (requester_id, created_at desc);

alter table public.edit_requests enable row level security;
drop policy if exists "edit_requests read own" on public.edit_requests;
create policy "edit_requests read own" on public.edit_requests
  for select using (requester_id = auth.uid());
-- Written only by the functions below.
revoke insert, update, delete, truncate on public.edit_requests from public, anon, authenticated;
revoke all on public.edit_requests from anon;


-- ── 4. request_edit ────────────────────────────────────────────────────────
-- p_board_id may be the shared cluster or any cluster inside it: the ask goes
-- on the cluster whose share reaches the caller.
create or replace function public.request_edit(p_board_id uuid)
returns table(request_id uuid, board_id uuid, status text)
language plpgsql
security definer
set search_path = public, auth
as $function$
#variable_conflict use_column
declare
  v_share      board_shares%rowtype;
  v_workspace  uuid;
  v_owner      uuid;
  v_req        edit_requests%rowtype;
  v_name       text;
  v_board_name text;
  v_to         uuid[];
  v_uid        uuid;
  v_recent     int;
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  if public.can_write_board(p_board_id) then
    return query select null::uuid, p_board_id, 'editor'::text;
    return;
  end if;

  -- The nearest share on the cluster or above it.
  with recursive chain as (
    select b.id, b.parent_board_id, 0 as depth from boards b where b.id = p_board_id
    union all
    select b.id, b.parent_board_id, c.depth + 1
    from boards b join chain c on b.id = c.parent_board_id
    where c.depth < 64
  )
  select bs.* into v_share
  from chain c join board_shares bs on bs.board_id = c.id and bs.user_id = auth.uid()
  order by c.depth
  limit 1;
  if not found then
    raise exception 'only people this cluster is shared with can ask to edit' using errcode = '42501';
  end if;
  if v_share.role = 'editor' then
    return query select null::uuid, v_share.board_id, 'editor'::text;
    return;
  end if;

  select b.workspace_id, w.created_by, b.name into v_workspace, v_owner, v_board_name
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = v_share.board_id and b.deleted_at is null;
  if v_workspace is null then
    raise exception 'board no longer exists' using errcode = 'P0002';
  end if;

  -- One open ask at a time; after a "Not now", again after a day.
  select * into v_req from edit_requests r
   where r.board_id = v_share.board_id and r.requester_id = auth.uid()
   order by r.created_at desc limit 1;
  if found and (v_req.status = 'pending'
                or (v_req.status = 'not_now' and v_req.decided_at > now() - interval '1 day')) then
    return query select v_req.id, v_share.board_id, 'pending'::text;
    return;
  end if;

  -- A light brake on asking everyone at once.
  select count(*) into v_recent from edit_requests r
   where r.requester_id = auth.uid() and r.created_at > now() - interval '1 day';
  if v_recent >= 20 then
    raise exception 'too many asks today, try again tomorrow' using errcode = '54000';
  end if;

  insert into edit_requests (board_id, requester_id)
  values (v_share.board_id, auth.uid())
  returning * into v_req;

  select coalesce(nullif(p.display_name, ''), u.email, 'Someone')
    into v_name
  from auth.users u left join public.profiles p on p.user_id = u.id
  where u.id = auth.uid();

  -- Who can say yes: the person who let them in, and the cluster's owner.
  select array_agg(distinct x) into v_to
  from unnest(array[v_share.invited_by, v_owner]) as x
  where x is not null and x <> auth.uid();

  begin
    if v_to is not null then
      foreach v_uid in array v_to loop
        insert into share_notifications (user_id, board_id, role, shared_by, kind, detail)
        values (v_uid, v_share.board_id, 'editor', auth.uid(), 'edit_request', v_name);
      end loop;
      perform public._notify_users(
        v_to, 'edit_request', v_share.board_id, v_share.board_id, v_workspace, auth.uid(),
        v_name || ' asked to edit ' || coalesce(v_board_name, 'a cluster'),
        null,
        jsonb_build_object('request_id', v_req.id, 'requester_id', auth.uid())
      );
    end if;
  exception when others then
    raise warning 'request_edit: notify failed: %', sqlerrm;
  end;

  begin
    insert into public.analytics_events (user_id, event, props)
    values (auth.uid(), 'edit_asked', jsonb_build_object('board_id', v_share.board_id));
  exception when others then null;
  end;

  return query select v_req.id, v_share.board_id, 'pending'::text;
end;
$function$;

revoke execute on function public.request_edit(uuid) from public, anon;
grant execute on function public.request_edit(uuid) to authenticated, service_role;


-- ── 5. answer_edit_request ─────────────────────────────────────────────────
-- Who may answer: whoever may change that person's access in the Share panel
-- (share_board's rule): a workspace manager, or the editor who let them in.
create or replace function public.answer_edit_request(p_request_id uuid, p_yes boolean)
returns text
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_req        edit_requests%rowtype;
  v_share      board_shares%rowtype;
  v_workspace  uuid;
  v_board_name text;
  v_me_name    text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select * into v_req from edit_requests where id = p_request_id for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  select b.workspace_id, b.name into v_workspace, v_board_name
  from boards b where b.id = v_req.board_id and b.deleted_at is null;
  if v_workspace is null then
    raise exception 'board no longer exists' using errcode = 'P0002';
  end if;

  select * into v_share from board_shares bs
   where bs.board_id = v_req.board_id and bs.user_id = v_req.requester_id;

  if not public.can_manage_workspace(v_workspace)
     and not (public.can_write_board(v_req.board_id)
              and v_share.user_id is not null and v_share.invited_by = auth.uid()) then
    raise exception 'you can only change the access of people you invited' using errcode = '42501';
  end if;

  if v_req.status <> 'pending' then
    return v_req.status;           -- someone already answered
  end if;

  if v_share.user_id is null then
    -- Removed since they asked: nothing to grant.
    update edit_requests set status = 'not_now', decided_by = auth.uid(), decided_at = now()
     where id = v_req.id;
    return 'gone';
  end if;

  if not coalesce(p_yes, false) then
    update edit_requests set status = 'not_now', decided_by = auth.uid(), decided_at = now()
     where id = v_req.id;
    begin
      insert into public.analytics_events (user_id, event, props)
      values (auth.uid(), 'edit_answered', jsonb_build_object('board_id', v_req.board_id, 'answer', 'not_now'));
    exception when others then null;
    end;
    return 'not_now';
  end if;

  if v_share.role <> 'editor' then
    -- 0520: the 10-editor limit, as every other door. Raises when full.
    if public._editor_admit(v_workspace, v_req.requester_id, null) = 'full' then
      perform public._editor_refuse(v_workspace);
    end if;
    update board_shares bs set role = 'editor'
     where bs.board_id = v_req.board_id and bs.user_id = v_req.requester_id;
  end if;

  update edit_requests set status = 'yes', decided_by = auth.uid(), decided_at = now()
   where id = v_req.id;

  begin
    select coalesce(nullif(p.display_name, ''), u.email, 'Someone')
      into v_me_name
    from auth.users u left join public.profiles p on p.user_id = u.id
    where u.id = auth.uid();
    insert into share_notifications (user_id, board_id, role, shared_by, kind, detail)
    values (v_req.requester_id, v_req.board_id, 'editor', auth.uid(), 'edit_granted', v_me_name);
    perform public._notify_users(
      array[v_req.requester_id], 'edit_granted', v_req.board_id, v_req.board_id, v_workspace, auth.uid(),
      v_me_name || ' said yes: you can edit ' || coalesce(v_board_name, 'the cluster'),
      null, jsonb_build_object('request_id', v_req.id)
    );
  exception when others then
    raise warning 'answer_edit_request: notify failed: %', sqlerrm;
  end;

  begin
    insert into public.analytics_events (user_id, event, props)
    values (auth.uid(), 'edit_answered', jsonb_build_object('board_id', v_req.board_id, 'answer', 'yes'));
  exception when others then null;
  end;

  return 'yes';
end;
$function$;

revoke execute on function public.answer_edit_request(uuid, boolean) from public, anon;
grant execute on function public.answer_edit_request(uuid, boolean) to authenticated, service_role;


-- ── 6. list_edit_requests ──────────────────────────────────────────────────
-- Open asks on a cluster that the caller can answer (the Share panel).
create or replace function public.list_edit_requests(p_board_id uuid)
returns table(request_id uuid, requester_id uuid, requester_name text, email text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_manager boolean;
begin
  select public.can_manage_workspace(b.workspace_id) into v_manager
  from boards b where b.id = p_board_id;
  if not coalesce(v_manager, false) and not public.can_write_board(p_board_id) then
    raise exception 'you do not have permission to view this board''s access' using errcode = '42501';
  end if;

  return query
  select r.id, r.requester_id,
         coalesce(nullif(p.display_name, ''), split_part(u.email::text, '@', 1)),
         u.email::text, r.created_at
  from edit_requests r
  join board_shares bs on bs.board_id = r.board_id and bs.user_id = r.requester_id
  join auth.users u on u.id = r.requester_id
  left join public.profiles p on p.user_id = r.requester_id
  where r.board_id = p_board_id
    and r.status = 'pending'
    and (coalesce(v_manager, false) or bs.invited_by = auth.uid())
  order by r.created_at asc;
end;
$function$;

revoke execute on function public.list_edit_requests(uuid) from public, anon;
grant execute on function public.list_edit_requests(uuid) to authenticated, service_role;


-- ── 7. _tg_share_notification_email: + edit_request, edit_granted ──────────
create or replace function public._tg_share_notification_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_kind            text := coalesce(new.kind, 'share');
  v_recipient_email text;
  v_board_name      text;
  v_workspace_id    uuid;
  v_workspace_name  text;
  v_peer_name       text;
  v_request_id      uuid;
begin
  if new.shared_by is null or new.shared_by = new.user_id then
    return new;
  end if;

  if v_kind = 'joined' then
    if public._is_user_online(new.user_id) then return new; end if;
    if not public._email_pref_enabled(new.user_id, 'email_invite_accepted') then return new; end if;
  elsif v_kind = 'share' then
    if not public._email_pref_enabled(new.user_id, 'email_board_shared') then return new; end if;
  elsif v_kind in ('edit_request', 'edit_granted') then
    -- 0830: online, the toast and the bell say it.
    if public._is_user_online(new.user_id) then return new; end if;
    if not public._email_pref_enabled(new.user_id, 'email_board_shared') then return new; end if;
  else
    return new;  -- explore_* & future kinds: in-app only
  end if;

  select email into v_recipient_email
  from auth.users where id = new.user_id;
  if v_recipient_email is null then return new; end if;

  select name, workspace_id into v_board_name, v_workspace_id
  from public.boards where id = new.board_id;

  -- 'share': the sharer; 'joined' / 'edit_request': the joiner / asker;
  -- 'edit_granted': who said yes.
  select coalesce(nullif(p.display_name, ''), u.email, 'Someone on Clusters')
  into v_peer_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = new.shared_by;

  if v_kind = 'joined' then
    -- 0452: a whole-workspace join names the workspace (the template cleans it).
    if new.scope = 'workspace' then
      select w.name into v_workspace_name from public.workspaces w where w.id = v_workspace_id;
    end if;
    perform public._notify_email(
      'invite_accepted',
      v_recipient_email,
      jsonb_build_object(
        'boardName',   coalesce(v_board_name, 'a board'),
        'joinerName',  coalesce(nullif(new.detail, ''), v_peer_name, 'Someone'),
        'role',        coalesce(new.role, 'viewer'),
        'workspaceId', v_workspace_id::text,
        'boardId',     new.board_id::text
      ) || case when new.scope = 'workspace' and nullif(v_workspace_name, '') is not null
                then jsonb_build_object('scope', 'workspace', 'workspaceName', v_workspace_name)
                else '{}'::jsonb end
    );
  elsif v_kind = 'edit_request' then
    select r.id into v_request_id from public.edit_requests r
     where r.board_id = new.board_id and r.requester_id = new.shared_by and r.status = 'pending'
     order by r.created_at desc limit 1;
    perform public._notify_email(
      'edit_request',
      v_recipient_email,
      jsonb_build_object(
        'boardName',   coalesce(v_board_name, 'a cluster'),
        'askerName',   coalesce(nullif(new.detail, ''), v_peer_name, 'Someone'),
        'workspaceId', v_workspace_id::text,
        'boardId',     new.board_id::text,
        'requestId',   v_request_id::text
      )
    );
  elsif v_kind = 'edit_granted' then
    perform public._notify_email(
      'edit_granted',
      v_recipient_email,
      jsonb_build_object(
        'boardName',   coalesce(v_board_name, 'a cluster'),
        'sharerName',  coalesce(nullif(new.detail, ''), v_peer_name, 'Someone'),
        'workspaceId', v_workspace_id::text,
        'boardId',     new.board_id::text
      )
    );
  else
    perform public._notify_email(
      'board_shared',
      v_recipient_email,
      jsonb_build_object(
        'boardName',   coalesce(v_board_name,  'a board'),
        'sharerName',  coalesce(v_peer_name, 'Someone on Clusters'),
        'role',        coalesce(new.role, 'viewer'),
        'workspaceId', v_workspace_id::text,
        'boardId',     new.board_id::text
      )
    );
  end if;

  return new;
end;
$function$;


-- ── 7b. list_board_shares: + via_link ──────────────────────────────────────
-- The Share panel says "joined from your link" for people a link let in. The
-- return type changes, so DROP + CREATE, which drops the ACL: re-granted
-- below (authenticated + service_role, as live had it) and proved at the end.
-- An app still on the old build ignores the extra column.
drop function if exists public.list_board_shares(uuid);
create function public.list_board_shares(p_board_id uuid)
returns table(user_id uuid, email text, role text, invited_by uuid, created_at timestamptz, via_link boolean)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_is_owner boolean;
begin
  select public.can_manage_workspace(b.workspace_id) into v_is_owner
  from boards b where b.id = p_board_id;
  if not coalesce(v_is_owner, false) and not can_write_board(p_board_id) then
    raise exception 'you do not have permission to view this board''s access'
      using errcode = '42501';
  end if;

  return query
  select s.user_id, u.email::text, s.role, s.invited_by, s.created_at, (s.via_link_token is not null)
  from board_shares s
  join auth.users u on u.id = s.user_id
  where s.board_id = p_board_id
  order by s.created_at asc;
end;
$function$;
revoke execute on function public.list_board_shares(uuid) from public, anon;
grant execute on function public.list_board_shares(uuid) to authenticated, service_role;


-- ── 8. _outbound_gate: the two new emails are member mail ─────────────────
-- Both go between people already on the cluster, so they take the member
-- class (recipient must have opened the app; per-sender hourly and
-- per-recipient daily caps). Body re-emitted from 0541; only the member list
-- changes.
create or replace function public._outbound_gate(p_template text, p_to text, p_data jsonb)
returns text
language plpgsql security definer
set search_path = public, auth as $$
declare
  cfg       jsonb   := coalesce((select value from public.app_config where key = 'outbound_breaker'), '{}'::jsonb);
  c_warn10  integer := coalesce((cfg->>'stranger_warn_10min')::int, 10);
  c_hold_h  integer := coalesce((cfg->>'stranger_hold_hour')::int, 30);
  c_hold_d  integer := coalesce((cfg->>'stranger_hold_day')::int, 60);
  c_recip_d integer := coalesce((cfg->>'recipient_stranger_day')::int, 3);
  c_mem_ah  integer := coalesce((cfg->>'member_actor_hour')::int, 30);
  c_mem_rd  integer := coalesce((cfg->>'member_recipient_day')::int, 10);
  c_new_h   integer := coalesce((cfg->>'new_account_hours')::int, 72);
  c_slack   integer := coalesce((cfg->>'budget_slack')::int, 2);
  v_actor   uuid    := auth.uid();
  v_key     text    := public._outbound_recipient_key(p_to);
  v_risk    text;
  v_state   text    := 'send';
  v_reason  text;
  v_email   text;
  v_created timestamptz;
  v_budget  integer;
  v_hold_since timestamptz;
  v_released   timestamptz;
  v_n10 integer; v_n60 integer; v_n24 integer;
  v_actor_n integer; v_recip_n integer;
  v_recipient uuid;
begin
  v_risk := case
    when p_template in ('pending_invite', 'board_shared', 'workspace_invite', 'file_shared', 'team_invite') then 'stranger'
    when p_template in ('mention_email', 'comment_reply_email', 'schedule_update', 'invite_accepted', 'file_commented', 'edit_request', 'edit_granted') then 'member'
    else 'system'
  end;
  if v_actor is not null then
    select u.email, u.created_at into v_email, v_created from auth.users u where u.id = v_actor;
  end if;

  if v_actor is not null and exists (select 1 from public.profiles p
                                      where p.user_id = v_actor and p.send_hold_at is not null) then
    v_state := 'hold'; v_reason := 'sender_on_hold';

  elsif v_risk = 'stranger' then
    -- One stranger send at a time, so the counts below cannot be raced.
    perform pg_advisory_xact_lock(hashtext('outbound_breaker:stranger'));
    select b.global_hold_since, b.released_at into v_hold_since, v_released
      from public.outbound_breaker b where b.id = 1;
    if v_hold_since is not null then
      v_state := 'hold'; v_reason := 'global_hold';
    else
      -- Releasing the breaker starts the count again, or the mail that tripped
      -- it would trip it a second time on the next invitation.
      select count(*) filter (where l.created_at > now() - interval '10 minutes'),
             count(*) filter (where l.created_at > now() - interval '1 hour'),
             count(*)
        into v_n10, v_n60, v_n24
        from public.outbound_ledger l
       where l.risk = 'stranger' and l.state in ('sent', 'held', 'released')
         and l.created_at > greatest(now() - interval '24 hours', coalesce(v_released, '-infinity'::timestamptz));
      select count(*) into v_recip_n
        from public.outbound_ledger l
       where l.risk = 'stranger' and l.recipient_hash = v_key and l.state in ('sent', 'released')
         and l.created_at > now() - interval '24 hours';

      if v_recip_n >= c_recip_d then
        v_state := 'drop'; v_reason := 'recipient_daily_cap';
      elsif v_n60 + 1 > c_hold_h or v_n24 + 1 > c_hold_d then
        update public.outbound_breaker
           set global_hold_since = now(),
               reason = format('%s stranger emails in the last hour, %s in the last day', v_n60 + 1, v_n24 + 1),
               released_at = null, released_by = null
         where id = 1;
        v_state := 'hold'; v_reason := 'global_hold_tripped';
        perform public._hold_new_senders(c_new_h);
        if v_actor is not null and v_created > now() - make_interval(hours => c_new_h) then
          perform public._hold_sending(v_actor, 'a new account sending invitations when the outbound breaker tripped', 'breaker');
        end if;
        perform public.ops_alert_raise('breaker',
          'Outbound breaker tripped: invitation emails are on hold',
          format(E'%s emails to people outside the product in the last hour, %s in the last day.\nThe one that tripped it came from %s.\nEvery invitation, share and workspace email is now held until you release the breaker. New accounts that sent them were put on a sending hold.',
                 v_n60 + 1, v_n24 + 1, coalesce(v_email, 'the system')),
          true, 'breaker:tripped', interval '1 hour', v_actor);
      else
        if v_actor is not null then
          v_budget := case when v_created > now() - interval '24 hours' then 5 else 20 end;
          select count(*) into v_actor_n
            from public.outbound_ledger l
           where l.risk = 'stranger' and l.actor = v_actor and l.state in ('sent', 'released')
             and l.created_at > now() - interval '24 hours';
          if v_actor_n >= v_budget + c_slack then
            v_state := 'hold'; v_reason := 'sender_over_budget';
            perform public._hold_sending(v_actor,
              format('sent %s invitation emails in 24 hours against a budget of %s, so something got past the budget', v_actor_n + 1, v_budget),
              'breaker');
          elsif v_actor_n + 1 = v_budget then
            perform public.ops_alert_raise('budget',
              'An account used its whole invitation budget: ' || coalesce(v_email, v_actor::text),
              format('%s invitation emails in 24 hours: its whole budget.', v_budget),
              true, 'budget:' || v_actor, interval '24 hours', v_actor);
          end if;
        end if;
        if v_state = 'send' and v_n10 + 1 >= c_warn10 then
          perform public.ops_alert_raise('volume',
            format('%s invitation emails in 10 minutes', v_n10 + 1),
            format(E'Early warning: nothing is held yet. The breaker trips at %s in an hour.\nLatest sender: %s', c_hold_h, coalesce(v_email, 'the system')),
            true, 'volume:10min', interval '1 hour', v_actor);
        end if;
      end if;
    end if;

  elsif v_risk = 'member' then
    select u.id into v_recipient from auth.users u where lower(u.email) = lower(p_to) limit 1;
    if v_recipient is null
       or not exists (select 1 from public.user_presence pr where pr.user_id = v_recipient) then
      v_state := 'drop'; v_reason := 'recipient_never_opened_app';
    else
      select count(*) into v_actor_n
        from public.outbound_ledger l
       where l.risk = 'member' and l.actor = v_actor and l.state in ('sent', 'held', 'released')
         and l.created_at > now() - interval '1 hour';
      select count(*) into v_recip_n
        from public.outbound_ledger l
       where l.risk = 'member' and l.recipient_hash = v_key and l.state in ('sent', 'released')
         and l.created_at > now() - interval '24 hours';
      if v_actor is not null and v_actor_n >= c_mem_ah then
        v_state := 'hold'; v_reason := 'member_sender_hourly_cap';
        perform public.ops_alert_raise('member_volume',
          'One account sent ' || (v_actor_n + 1) || ' notification emails in an hour: ' || coalesce(v_email, v_actor::text),
          'Mentions, replies and schedule updates from this account are held. Release or drop them from the Security tab.',
          true, 'member:' || v_actor, interval '1 hour', v_actor);
      elsif v_recip_n >= c_mem_rd then
        v_state := 'hold'; v_reason := 'member_recipient_daily_cap';
        perform public.ops_alert_raise('member_volume',
          'One person was about to get more than ' || c_mem_rd || ' notification emails today',
          'Further mentions, replies and schedule updates to them are held. Latest sender: ' || coalesce(v_email, 'the system'),
          true, 'member_recipient:' || v_key, interval '6 hours', v_actor);
      end if;
    end if;
  end if;

  insert into public.outbound_ledger (actor, template, risk, recipient_hash, state, reason, payload)
  values (v_actor, p_template, v_risk, v_key,
          case v_state when 'hold' then 'held' when 'drop' then 'dropped' else 'sent' end,
          v_reason,
          case when v_state = 'hold'
               then jsonb_build_object('template', p_template, 'to', p_to, 'data', p_data, 'actor', v_actor)
          end);
  return v_state;
exception when others then
  -- Fail closed: hold it rather than send it or lose it.
  begin
    insert into public.outbound_ledger (actor, template, risk, recipient_hash, state, reason, payload)
    values (auth.uid(), p_template, 'system', md5(lower(coalesce(p_to, ''))), 'held',
            left('gate_error: ' || sqlerrm, 300),
            jsonb_build_object('template', p_template, 'to', p_to, 'data', p_data, 'actor', auth.uid()));
  exception when others then
    null;
  end;
  return 'hold';
end;
$$;


revoke execute on function public._outbound_gate(text, text, jsonb) from public, anon, authenticated;


-- ── The 0311 habit: prove the grants, don't trust them ─────────────────────
do $$
declare
  f text;
begin
  -- Signed-out readers keep the link preview / share page meta.
  if not has_function_privilege('anon', 'public.get_share_meta(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_share_meta(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.get_share_meta(uuid,uuid)', 'EXECUTE') then
    raise exception '0830: get_share_meta lost a grant';
  end if;

  foreach f in array array[
    'public.join_view_link(uuid)',
    'public.request_edit(uuid)',
    'public.answer_edit_request(uuid,boolean)',
    'public.list_edit_requests(uuid)',
    'public.list_board_shares(uuid)'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '0830: % is callable signed out', f;
    end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE')
       or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0830: % is missing a grant', f;
    end if;
  end loop;

  if has_function_privilege('anon', 'public._tg_share_notification_email()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._tg_share_notification_email()', 'EXECUTE') then
    raise exception '0830: _tg_share_notification_email is client-callable';
  end if;

  if has_function_privilege('anon', 'public._outbound_gate(text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._outbound_gate(text,text,jsonb)', 'EXECUTE') then
    raise exception '0830: _outbound_gate is client-callable';
  end if;

  if has_table_privilege('authenticated', 'public.edit_requests', 'INSERT')
     or has_table_privilege('authenticated', 'public.edit_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.edit_requests', 'DELETE')
     or has_table_privilege('anon', 'public.edit_requests', 'SELECT') then
    raise exception '0830: edit_requests is client-writable';
  end if;
end $$;
