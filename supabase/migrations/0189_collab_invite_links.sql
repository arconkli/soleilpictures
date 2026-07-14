-- 0189_collab_invite_links.sql — role-bearing INVITE LINKS + the "X joined
-- your board" payoff loop.
--
-- Users share links, not emails (prod: 9 users made view links vs 2 who used
-- email sharing), but the only link was anonymous view-only. This migration
-- makes public_share_links role-bearing:
--
--   kind='view'    — today's anonymous view link, unchanged.
--   kind='invite'  — a claimable link: anyone opening it sees the existing
--                    /share preview plus a "Join as editor/viewer" confirm
--                    card; claim_collab_link() (auth required, never on GET)
--                    inserts the board_shares row. Multi-use, revocable,
--                    default 30-day expiry, never indexable.
--
-- The claim also closes the loop that made inviting feel dead:
--   * share_notifications kind='joined' row for the link creator (in-app
--     toast) + an invite_accepted email via _tg_share_notification_email —
--     and the SAME payoff now fires when classic email invites are claimed
--     (claim_pending_invite / the signup backstop trigger).
--   * new users (account < 7 days old) claimed by a link feed the referral
--     ledger as source='collab' — the +25/+25 loop (0163) applies verbatim.
--
-- Also fixes a latent bug: _tg_share_notification_email fired the
-- board_shared email for EVERY share_notifications insert; explore_approved /
-- explore_rejected rows (0171) now return early (in-app only).

-----------------------------------------------------------------------
-- 1. Schema.
-----------------------------------------------------------------------
alter table public.public_share_links drop constraint public_share_links_role_check;
alter table public.public_share_links
  add constraint public_share_links_role_check check (role in ('viewer','editor'));

alter table public.public_share_links
  add column if not exists kind text not null default 'view';
alter table public.public_share_links
  add constraint public_share_links_kind_check check (kind in ('view','invite'));

-- Which link a share came through — powers per-link joined counts, the admin
-- k-factor widget, and the audit trail. invited_by stays the link CREATOR
-- (fits 0147's editors-manage-what-they-created scoping).
alter table public.board_shares
  add column if not exists via_link_token uuid
  references public.public_share_links(token) on delete set null;
create index if not exists board_shares_via_link_idx
  on public.board_shares(via_link_token) where via_link_token is not null;

-----------------------------------------------------------------------
-- 2. create_collab_link — mint (or reuse) an invite link. Writer-guarded
--    like create_public_link (0147). Invite links always include the
--    subtree in the preview (the claimed share cascades there anyway) and
--    are never indexable.
-----------------------------------------------------------------------
create or replace function public.create_collab_link(
  p_board_id uuid,
  p_role text default 'editor',
  p_expires_at timestamptz default (now() + interval '30 days')
) returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_owner    uuid;
  v_is_owner boolean;
  v_token    uuid;
begin
  if p_role not in ('viewer','editor') then
    raise exception 'role must be viewer or editor' using errcode = '22023';
  end if;

  select w.created_by into v_owner
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = p_board_id;
  if v_owner is null then
    raise exception 'board % not found', p_board_id using errcode = '42704';
  end if;
  v_is_owner := coalesce(v_owner = auth.uid(), false);
  if not v_is_owner and not can_write_board(p_board_id) then
    raise exception 'you do not have permission to create links for this board'
      using errcode = '42501';
  end if;

  -- Reuse-before-mint: the caller's own live link for the same board+role.
  select l.token into v_token
  from public_share_links l
  where l.board_id = p_board_id
    and l.kind = 'invite'
    and l.role = p_role
    and l.created_by = auth.uid()
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now())
  order by l.created_at desc
  limit 1;
  if v_token is not null then
    return v_token;
  end if;

  insert into public_share_links
    (board_id, role, kind, created_by, expires_at, include_subboards, allow_indexing)
  values
    (p_board_id, p_role, 'invite', auth.uid(), p_expires_at, true, false)
  returning token into v_token;
  return v_token;
end;
$$;
revoke all on function public.create_collab_link(uuid, text, timestamptz) from public;
grant execute on function public.create_collab_link(uuid, text, timestamptz) to authenticated;

-----------------------------------------------------------------------
-- 3. claim_collab_link — the confirm-card's "Join" action. Auth required;
--    a bare GET of the link never calls this. Idempotent; upgrades
--    viewer→editor, never downgrades. Respects the dormant editor-seat
--    brake (0188). Fresh joins notify the link creator and (for new
--    accounts) feed the referral ledger as source='collab'.
-----------------------------------------------------------------------
create or replace function public.claim_collab_link(p_token uuid)
returns table(workspace_id uuid, board_id uuid, role text, status text)
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_link         public_share_links%rowtype;
  v_workspace    uuid;
  v_owner        uuid;
  v_existing     board_shares%rowtype;
  v_cap          integer;
  v_editor_seats integer;
  v_joiner_name  text;
  v_status       text := 'joined';
  v_is_new_user  boolean;
  v_has_card     boolean;
  v_ref_ins      int := 0;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to join' using errcode = '42501';
  end if;

  select * into v_link from public_share_links where token = p_token;
  if not found or v_link.kind is distinct from 'invite' then
    raise exception 'invite link not found' using errcode = 'P0002';
  end if;
  if v_link.revoked_at is not null then
    raise exception 'this invite link was turned off' using errcode = '22023';
  end if;
  if v_link.expires_at is not null and v_link.expires_at <= now() then
    raise exception 'this invite link has expired' using errcode = '22023';
  end if;

  select b.workspace_id, w.created_by into v_workspace, v_owner
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = v_link.board_id and b.deleted_at is null;
  if v_workspace is null then
    raise exception 'board no longer exists' using errcode = 'P0002';
  end if;

  -- Already the owner / a workspace member — nothing to grant.
  if v_owner = auth.uid() or is_workspace_member(v_workspace) then
    return query select v_workspace, v_link.board_id, 'owner'::text, 'noop'::text;
    return;
  end if;

  select * into v_existing
  from board_shares bs
  where bs.board_id = v_link.board_id and bs.user_id = auth.uid();
  if found then
    if v_existing.role = 'viewer' and v_link.role = 'editor' then
      update board_shares bs
         set role = 'editor', via_link_token = coalesce(bs.via_link_token, v_link.token)
       where bs.board_id = v_link.board_id and bs.user_id = auth.uid();
      return query select v_workspace, v_link.board_id, 'editor'::text, 'upgraded'::text;
    else
      return query select v_workspace, v_link.board_id, v_existing.role, 'already'::text;
    end if;
    return;
  end if;

  -- Dormant editor-seat brake (0188): only bites when an admin sets a cap.
  if v_link.role = 'editor' then
    v_cap := public._collab_editor_cap();
    if v_cap is not null then
      select count(distinct bs.user_id) into v_editor_seats
      from board_shares bs
      join boards b     on b.id = bs.board_id
      join workspaces w on w.id = b.workspace_id
      where w.created_by = v_owner and bs.role = 'editor';
      if v_editor_seats >= v_cap then
        raise exception 'this workspace has reached its free editor limit'
          using errcode = '42501';
      end if;
    end if;
  end if;

  insert into board_shares (board_id, user_id, role, invited_by, via_link_token)
  values (v_link.board_id, auth.uid(), v_link.role, v_link.created_by, v_link.token)
  on conflict (board_id, user_id) do nothing;

  -- Payoff notification to the link creator (in-app toast + email via the
  -- share_notifications trigger). Never let it break the claim.
  begin
    if v_link.created_by is not null and v_link.created_by <> auth.uid() then
      select coalesce(nullif(p.display_name, ''), u.email, 'Someone')
        into v_joiner_name
      from auth.users u
      left join public.profiles p on p.user_id = u.id
      where u.id = auth.uid();
      insert into share_notifications (user_id, board_id, role, shared_by, kind, detail)
      values (v_link.created_by, v_link.board_id, v_link.role, auth.uid(), 'joined', v_joiner_name);
    end if;
  exception when others then
    raise warning 'claim_collab_link: joined notification failed: %', sqlerrm;
  end;

  -- Referral ledger (0163 parity): a NEW account (< 7 days) joining via a
  -- collab link credits the link creator, source='collab'. If the referee
  -- already placed their first card, grant the referrer reward immediately
  -- (the _stamp_first_card trigger has already fired and won't again).
  begin
    select (u.created_at > now() - interval '7 days') into v_is_new_user
    from auth.users u where u.id = auth.uid();
    if coalesce(v_is_new_user, false)
       and v_link.created_by is not null
       and v_link.created_by <> auth.uid() then
      insert into public.referrals (referrer_id, referee_id, source, status, meta)
      values (v_link.created_by, auth.uid(), 'collab', 'pending',
              jsonb_build_object('via', 'invite_link', 'token', v_link.token::text))
      on conflict (referee_id) do nothing;
      get diagnostics v_ref_ins = row_count;
      if v_ref_ins > 0 then
        update public.profiles
           set bonus_card_credits = coalesce(bonus_card_credits, 0) + 25
         where user_id = auth.uid();
        insert into public.analytics_events (user_id, event, props)
        values (auth.uid(), 'referral_signup',
                jsonb_build_object('source', 'collab', 'via', 'invite_link'));
        select (first_card_at is not null) into v_has_card
        from public.profiles where user_id = auth.uid();
        if coalesce(v_has_card, false) then
          perform public.grant_referral_reward(auth.uid());
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'claim_collab_link: referral block failed: %', sqlerrm;
  end;

  -- Server-fired analytics (mirrors referral_signup's pattern).
  begin
    insert into public.analytics_events (user_id, event, props)
    values (auth.uid(), 'invite_link_claimed',
            jsonb_build_object('board_id', v_link.board_id, 'role', v_link.role, 'status', v_status));
  exception when others then null;
  end;

  return query select v_workspace, v_link.board_id, v_link.role, v_status;
end;
$$;
revoke all on function public.claim_collab_link(uuid) from public;
grant execute on function public.claim_collab_link(uuid) to authenticated;

-----------------------------------------------------------------------
-- 4. get_share_bundle — expose a `join` descriptor for invite links so the
--    /share viewer renders the confirm card. Body otherwise verbatim from
--    the live version. (View links get join=null — no behavior change.)
-----------------------------------------------------------------------
create or replace function public.get_share_bundle(p_token uuid, p_board_id uuid default null::uuid)
returns json
language plpgsql security definer
set search_path = public as $$
declare
  v_root_id    uuid;
  v_include    boolean;
  v_target     uuid;
  v_board      record;
  v_snapshot   text;
  v_image_keys text[];
  v_image_meta json;
  v_nav        json;
  v_join       json;
begin
  select t.root_id, t.target_id, t.include_subboards
    into v_root_id, v_target, v_include
  from public._resolve_share_target(p_token, p_board_id) t;

  select b.id, b.name, b.view, b.cover, b.bg_color into v_board
  from boards b where b.id = v_target;

  select doc into v_snapshot from board_state where board_id = v_target;

  select coalesce(array_agg(distinct k), '{}'::text[]) into v_image_keys
  from (
    select storage_path as k from images
     where storage_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
    union
    select preview_path as k from images
     where preview_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
    union
    select preview_sm_path as k from images
     where preview_sm_path is not null
       and (board_id = v_target or v_target = any(referenced_in_board_ids))
  ) s;

  select coalesce(
           jsonb_object_agg(storage_path, jsonb_build_object(
             'blur', blur_hash,
             'preview', preview_path,
             'preview_w', preview_w,
             'preview_h', preview_h,
             'preview_sm', preview_sm_path,
             'preview_sm_w', preview_sm_w,
             'preview_sm_h', preview_sm_h
           )),
           '{}'::jsonb
         )::json
    into v_image_meta
  from images
  where storage_path is not null
    and (board_id = v_target or v_target = any(referenced_in_board_ids))
    and (blur_hash is not null or preview_path is not null);

  if coalesce(v_include, false) then
    select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name)), '[]'::json)
      into v_nav
    from (
      with recursive sub as (
        select id, name from boards where id = v_root_id
        union all
        select b.id, b.name
        from boards b join sub s on b.parent_board_id = s.id
        where b.deleted_at is null
      )
      select id, name from sub
    ) t;
  else
    select json_build_array(json_build_object('id', b.id, 'name', b.name))
      into v_nav
    from boards b where b.id = v_root_id;
  end if;

  -- Invite links carry a join descriptor; view links stay null.
  select case when l.kind = 'invite'
              then json_build_object('role', l.role, 'kind', l.kind)
              else null end
    into v_join
  from public_share_links l where l.token = p_token;

  return json_build_object(
    'board', json_build_object(
      'id', v_board.id,
      'name', v_board.name,
      'view', v_board.view,
      'cover', v_board.cover,
      'bg_color', v_board.bg_color
    ),
    'snapshot', v_snapshot,
    'image_keys', v_image_keys,
    'image_meta', v_image_meta,
    'role', 'viewer',
    'root_id', v_root_id,
    'include_subboards', coalesce(v_include, false),
    'nav_boards', v_nav,
    'join', v_join
  );
end;
$$;

-----------------------------------------------------------------------
-- 5. list_public_links — RETURNS shape grows (kind + joined_count), so
--    drop/recreate + re-grant.
-----------------------------------------------------------------------
drop function if exists public.list_public_links(uuid);
create function public.list_public_links(p_board_id uuid)
returns table(
  token uuid, role text, kind text, created_by uuid,
  created_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
  include_subboards boolean, allow_indexing boolean, joined_count integer
)
language plpgsql security definer
set search_path = public as $$
declare
  v_owner    uuid;
  v_is_owner boolean;
begin
  select w.created_by into v_owner
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = p_board_id;
  v_is_owner := coalesce(v_owner = auth.uid(), false);
  if not v_is_owner and not can_write_board(p_board_id) then
    raise exception 'you do not have permission to view this board''s links'
      using errcode = '42501';
  end if;

  return query
  select l.token, l.role, l.kind, l.created_by, l.created_at, l.expires_at, l.revoked_at,
         l.include_subboards, l.allow_indexing,
         (select count(*)::integer from board_shares bs where bs.via_link_token = l.token)
  from public_share_links l
  where l.board_id = p_board_id
  order by l.created_at desc;
end;
$$;
revoke all on function public.list_public_links(uuid) from public;
grant execute on function public.list_public_links(uuid) to authenticated;

-----------------------------------------------------------------------
-- 6. set_public_link_indexing — invite links can never opt into indexing.
--    Body otherwise verbatim from live (0147).
-----------------------------------------------------------------------
create or replace function public.set_public_link_indexing(p_token uuid, p_allow boolean)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_owner           uuid;
  v_is_owner        boolean;
  v_link_created_by uuid;
  v_board_id        uuid;
  v_kind            text;
begin
  select w.created_by, l.created_by, l.board_id, l.kind
    into v_owner, v_link_created_by, v_board_id, v_kind
  from public_share_links l
  join boards b on b.id = l.board_id
  join workspaces w on w.id = b.workspace_id
  where l.token = p_token;
  v_is_owner := coalesce(v_owner = auth.uid(), false);
  if not v_is_owner and (v_link_created_by is distinct from auth.uid()
                          or not can_write_board(v_board_id)) then
    raise exception 'you can only manage links you created' using errcode = '42501';
  end if;
  if v_kind = 'invite' and coalesce(p_allow, false) then
    raise exception 'invite links can''t be indexed' using errcode = '22023';
  end if;

  update public_share_links set allow_indexing = coalesce(p_allow, false)
  where token = p_token;
end;
$$;

-----------------------------------------------------------------------
-- 7. Email-invite claims fire the same joined payoff. Both claim paths
--    re-created from live bodies + a guarded notification insert.
-----------------------------------------------------------------------
create or replace function public._joined_notification(
  p_inviter uuid, p_board_id uuid, p_workspace_id uuid, p_role text, p_joiner uuid
) returns void
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_board  uuid := p_board_id;
  v_name   text;
begin
  if p_inviter is null or p_joiner is null or p_inviter = p_joiner then return; end if;
  -- Workspace-level invites anchor on the workspace's root board (the
  -- notification row + email deep-link need a board). Skip if none.
  if v_board is null then
    select id into v_board from boards
    where workspace_id = p_workspace_id and parent_board_id is null and deleted_at is null
    order by created_at asc limit 1;
  end if;
  if v_board is null then return; end if;

  select coalesce(nullif(p.display_name, ''), u.email, 'Someone')
    into v_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = p_joiner;

  insert into share_notifications (user_id, board_id, role, shared_by, kind, detail)
  values (p_inviter, v_board,
          case when p_role = 'editor' then 'editor' else 'viewer' end,
          p_joiner, 'joined', v_name);
exception when others then
  raise warning '_joined_notification failed: %', sqlerrm;
end;
$$;
revoke all on function public._joined_notification(uuid, uuid, uuid, text, uuid) from public;

create or replace function public.claim_pending_invite(p_token uuid)
returns table(workspace_id uuid, board_id uuid)
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_row           pending_invites%rowtype;
  v_caller_email  text;
  v_fresh         boolean := false;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to claim invite' using errcode = '42501';
  end if;

  select email into v_caller_email from auth.users where id = auth.uid();

  select * into v_row from pending_invites where token = p_token;
  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  if v_row.expires_at <= now() then
    raise exception 'invite has expired' using errcode = '22023';
  end if;

  if lower(v_row.email) <> lower(coalesce(v_caller_email, '')) then
    raise exception 'this invite is for a different email' using errcode = '42501';
  end if;

  if v_row.claimed_at is not null and v_row.claimed_by is distinct from auth.uid() then
    raise exception 'invite already claimed' using errcode = '22023';
  end if;

  v_fresh := v_row.claimed_at is null;

  if v_row.board_id is not null then
    insert into board_shares (board_id, user_id, role, invited_by)
    values (v_row.board_id, auth.uid(),
            case when v_row.role = 'editor' then 'editor' else 'viewer' end,
            v_row.invited_by)
    on conflict (board_id, user_id) do nothing;
  else
    insert into workspace_members (workspace_id, user_id, role)
    values (v_row.workspace_id, auth.uid(),
            case when v_row.role = 'viewer' then 'viewer' else 'editor' end)
    on conflict (workspace_id, user_id) do nothing;
  end if;

  update pending_invites
     set claimed_at = coalesce(claimed_at, now()),
         claimed_by = coalesce(claimed_by, auth.uid())
   where id = v_row.id;

  if v_fresh then
    perform public._joined_notification(
      v_row.invited_by, v_row.board_id, v_row.workspace_id, v_row.role, auth.uid());
  end if;

  return query select v_row.workspace_id, v_row.board_id;
end;
$$;

create or replace function public._claim_pending_invites_for_user(p_user_id uuid, p_email text)
returns integer
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_row    pending_invites%rowtype;
  v_count  integer := 0;
  v_email_norm text := lower(trim(coalesce(p_email, '')));
begin
  if v_email_norm = '' or p_user_id is null then
    return 0;
  end if;

  for v_row in
    select * from pending_invites
    where lower(email) = v_email_norm
      and claimed_at is null
      and expires_at > now()
  loop
    begin
      if v_row.board_id is not null then
        insert into board_shares (board_id, user_id, role, invited_by)
        values (v_row.board_id, p_user_id,
                case when v_row.role = 'editor' then 'editor' else 'viewer' end,
                v_row.invited_by)
        on conflict (board_id, user_id) do nothing;
      else
        insert into workspace_members (workspace_id, user_id, role)
        values (v_row.workspace_id, p_user_id,
                case when v_row.role = 'viewer' then 'viewer' else 'editor' end)
        on conflict (workspace_id, user_id) do nothing;
      end if;

      update pending_invites
         set claimed_at = now(),
             claimed_by = p_user_id
       where id = v_row.id;

      perform public._joined_notification(
        v_row.invited_by, v_row.board_id, v_row.workspace_id, v_row.role, p_user_id);

      v_count := v_count + 1;
    exception when others then
      raise warning '_claim_pending_invites_for_user: claim id=% failed: %', v_row.id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

-----------------------------------------------------------------------
-- 8. _tg_share_notification_email — branch on kind:
--      'share'  → existing board_shared email (verbatim live behavior)
--      'joined' → invite_accepted payoff email to the inviter (skipped when
--                 they're in-app — the toast covers it — or opted out)
--      other    → in-app only (fixes the explore_* bogus-email bug)
-----------------------------------------------------------------------
create or replace function public._tg_share_notification_email()
returns trigger
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_kind            text := coalesce(new.kind, 'share');
  v_recipient_email text;
  v_board_name      text;
  v_workspace_id    uuid;
  v_peer_name       text;
begin
  if new.shared_by is null or new.shared_by = new.user_id then
    return new;
  end if;

  if v_kind = 'joined' then
    if public._is_user_online(new.user_id) then return new; end if;
    if not public._email_pref_enabled(new.user_id, 'email_invite_accepted') then return new; end if;
  elsif v_kind = 'share' then
    if not public._email_pref_enabled(new.user_id, 'email_board_shared') then return new; end if;
  else
    return new;  -- explore_* & future kinds: in-app only
  end if;

  select email into v_recipient_email
  from auth.users where id = new.user_id;
  if v_recipient_email is null then return new; end if;

  select name, workspace_id into v_board_name, v_workspace_id
  from public.boards where id = new.board_id;

  -- 'share': the sharer; 'joined': the joiner.
  select coalesce(nullif(p.display_name, ''), u.email, 'Someone on Clusters')
  into v_peer_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = new.shared_by;

  if v_kind = 'joined' then
    perform public._notify_email(
      'invite_accepted',
      v_recipient_email,
      jsonb_build_object(
        'boardName',   coalesce(v_board_name, 'a board'),
        'joinerName',  coalesce(nullif(new.detail, ''), v_peer_name, 'Someone'),
        'role',        coalesce(new.role, 'viewer'),
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
$$;
