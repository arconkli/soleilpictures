-- 0391 — Workspace co-owner role ("manage, not destroy").
--
-- A workspace had exactly one manager: workspaces.created_by. Every
-- membership, sharing and settings path compared against it inline, so a team
-- could not hand anyone else the keys short of transferring ownership.
--
-- A co-owner (workspace_members.role = 'coowner') can now do what the owner
-- does to RUN the workspace:
--   * invite and remove members, change roles (including granting co-owner)
--   * list and revoke pending workspace invites
--   * see and manage every share, invite and public link on its clusters
--   * rename it, set its icon, edit card defaults
-- and cannot do what would DESTROY or TAKE it:
--   * delete_workspace, transfer_workspace_ownership — still created_by only
--   * remove or re-role the owner (created_by)
--   * service accounts, webhooks and workspace rewind stay owner-only; they
--     mint credentials or rewrite history, and the owner is the one billed.
-- Limits are unchanged: cards and storage still count against created_by
-- (_owner_card_count / _storage_quota_bytes), so a co-owner's work is charged
-- to the owner exactly as an editor's is.
--
-- `can_manage_workspace` is deliberately NOT `_`-prefixed: RLS policies call
-- it, and a policy runs as the querying user, so `authenticated` needs
-- EXECUTE. It only ever answers "can *I* manage this workspace".
--
-- Every function below is `create or replace` (never DROP + CREATE), so each
-- keeps its existing ACL; the block at the end proves the grants anyway.

begin;

-- ── 1. The role ─────────────────────────────────────────────────────────────
alter table public.workspace_members drop constraint workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check
  check (role in ('owner', 'coowner', 'admin', 'editor', 'viewer', 'service'));

-- ── 2. The predicate ────────────────────────────────────────────────────────
create or replace function public.can_manage_workspace(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and (
       exists (select 1 from public.workspaces w
                where w.id = ws and w.created_by = auth.uid())
       or exists (select 1 from public.workspace_members m
                   where m.workspace_id = ws and m.user_id = auth.uid()
                     and m.role = 'coowner')
     );
$$;
revoke all on function public.can_manage_workspace(uuid) from public, anon;
grant execute on function public.can_manage_workspace(uuid) to authenticated, service_role;

-- A co-owner writes.
create or replace function public._workspace_member_can_write(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public._workspace_member_role(ws) in ('owner', 'coowner', 'admin', 'editor', 'service'), false);
$$;

-- When the owner deletes their account, a co-owner inherits first.
create or replace function public._deletion_heir(p_workspace uuid, p_leaver uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id
    from public.workspace_members m
   where m.workspace_id = p_workspace
     and m.user_id <> p_leaver
     and m.role in ('owner', 'coowner', 'admin', 'editor')
     and not public._user_banned(m.user_id)
   order by (m.role = 'coowner') desc, m.created_at asc, m.user_id asc
   limit 1;
$$;

-- ── 3. Membership ───────────────────────────────────────────────────────────
create or replace function public.invite_workspace_member(p_workspace_id uuid, p_email text, p_role text default 'editor')
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user        uuid;
  v_my_tier     text;
  v_email_norm  text := lower(trim(p_email));
begin
  if p_role not in ('editor','viewer') then
    raise exception 'workspace member role must be editor or viewer'
      using errcode = '22023';
  end if;

  -- 0358: a banned account stops inviting at once.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select coalesce((select tier from public.profiles where user_id = auth.uid()), 'demo')
    into v_my_tier;
  if v_my_tier = 'waitlist' then
    raise exception 'your account isn''t active yet' using errcode = '42501';
  end if;

  -- 0391: the owner or a co-owner.
  if not public.can_manage_workspace(p_workspace_id) then
    raise exception 'only the workspace owner or a co-owner can add members'
      using errcode = '42501';
  end if;

  select id into v_user from auth.users where email = v_email_norm;

  if v_user is null then
    -- 0358: only a new pending row fires the invite email, so only it spends.
    if not exists (select 1 from pending_invites pi
                    where lower(pi.email) = v_email_norm
                      and pi.workspace_id = p_workspace_id
                      and pi.board_id is null
                      and pi.claimed_at is null) then
      perform public._invite_budget_take();
    end if;
    -- 0318: 'workspace' is what both claim paths turn into an editor membership;
    -- a viewer invite must stay 'viewer' or the claim promotes it.
    insert into pending_invites (email, workspace_id, board_id, role, invited_by)
    values (v_email_norm, p_workspace_id, null,
            case when p_role = 'viewer' then 'viewer' else 'workspace' end,
            auth.uid())
    on conflict (lower(email), workspace_id) where claimed_at is null and board_id is null
    do update set role       = case when p_role = 'viewer' then 'viewer' else 'workspace' end,
                  invited_by = auth.uid(),
                  expires_at = now() + interval '30 days';
    return 'pending';
  end if;

  if v_user = auth.uid() then
    raise exception 'cannot invite yourself' using errcode = '22023';
  end if;

  -- 0358: an existing member is told so without spending budget; a new one
  -- gets the `workspace_invite` email, so it spends.
  if exists (select 1 from workspace_members m
              where m.workspace_id = p_workspace_id and m.user_id = v_user) then
    return 'already_member';
  end if;
  perform public._invite_budget_take();

  begin
    insert into workspace_members (workspace_id, user_id, role)
    values (p_workspace_id, v_user, p_role);
  exception when unique_violation then
    return 'already_member';
  end;

  return 'granted';
end;
$function$;

create or replace function public.remove_workspace_member(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_owner uuid;
begin
  select created_by into v_owner from workspaces
  where id = p_workspace_id;
  if v_owner is null or not public.can_manage_workspace(p_workspace_id) then
    raise exception 'only the workspace owner or a co-owner can remove members'
      using errcode = '42501';
  end if;
  if p_user_id = v_owner then
    raise exception 'cannot remove the workspace owner'
      using errcode = '42501';
  end if;

  delete from workspace_members
  where workspace_id = p_workspace_id and user_id = p_user_id;

  -- 0318: a per-board share in this workspace survived removal before, so a
  -- removed person kept access to whatever had been shared to them directly.
  delete from board_shares
  where user_id = p_user_id
    and board_id in (select id from boards where workspace_id = p_workspace_id);
end;
$function$;

create or replace function public.set_workspace_member_role(p_workspace_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_owner uuid;
begin
  if p_role not in ('coowner', 'editor', 'viewer') then
    raise exception 'role must be coowner, editor or viewer' using errcode = '22023';
  end if;
  select created_by into v_owner from workspaces where id = p_workspace_id;
  if v_owner is null or not public.can_manage_workspace(p_workspace_id) then
    raise exception 'only the workspace owner or a co-owner can change roles' using errcode = '42501';
  end if;
  if p_user_id = v_owner then
    raise exception 'the owner''s role is ownership; transfer it instead' using errcode = '42501';
  end if;
  update workspace_members
     set role = p_role
   where workspace_id = p_workspace_id
     and user_id = p_user_id
     and role in ('coowner', 'editor', 'viewer');
  if not found then
    raise exception 'not a member with a changeable role' using errcode = 'P0002';
  end if;
end;
$function$;

create or replace function public.list_pending_invites_for_workspace(p_workspace_id uuid)
returns table(id uuid, email text, role text, board_id uuid, invited_by uuid, expires_at timestamp with time zone, created_at timestamp with time zone)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.can_manage_workspace(p_workspace_id) then
    raise exception 'only the workspace owner or a co-owner can list pending invites'
      using errcode = '42501';
  end if;

  return query
  select pi.id, pi.email, pi.role, pi.board_id, pi.invited_by, pi.expires_at, pi.created_at
  from pending_invites pi
  where pi.workspace_id = p_workspace_id
    and pi.claimed_at is null
    and pi.expires_at > now()
    and pi.board_id is null
  order by pi.created_at asc;
end;
$function$;

create or replace function public.revoke_pending_invite(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_workspace  uuid;
  v_is_owner   boolean;
  v_board      uuid;
  v_invited_by uuid;
begin
  select pi.workspace_id, pi.board_id, pi.invited_by
    into v_workspace, v_board, v_invited_by
  from pending_invites pi
  where pi.id = p_id;
  if v_workspace is null then
    return;  -- already gone / not found — idempotent
  end if;

  v_is_owner := public.can_manage_workspace(v_workspace);
  if not v_is_owner then
    if v_board is null then
      raise exception 'only the workspace owner or a co-owner can revoke workspace invites'
        using errcode = '42501';
    end if;
    if not can_write_board(v_board) or v_invited_by is distinct from auth.uid() then
      raise exception 'you can only revoke invites you created'
        using errcode = '42501';
    end if;
  end if;

  delete from pending_invites where id = p_id;
end;
$function$;

-- ── 4. Per-cluster access: managers see and manage everyone's ──────────────
create or replace function public.list_board_shares(p_board_id uuid)
returns table(user_id uuid, email text, role text, invited_by uuid, created_at timestamp with time zone)
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
  select s.user_id, u.email::text, s.role, s.invited_by, s.created_at
  from board_shares s
  join auth.users u on u.id = s.user_id
  where s.board_id = p_board_id
  order by s.created_at asc;
end;
$function$;

create or replace function public.list_pending_invites_for_board(p_board_id uuid)
returns table(id uuid, email text, role text, invited_by uuid, expires_at timestamp with time zone, created_at timestamp with time zone)
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
    raise exception 'you do not have permission to view this board''s pending invites'
      using errcode = '42501';
  end if;

  return query
  select pi.id, pi.email, pi.role, pi.invited_by, pi.expires_at, pi.created_at
  from pending_invites pi
  where pi.board_id = p_board_id
    and pi.claimed_at is null
    and pi.expires_at > now()
  order by pi.created_at asc;
end;
$function$;

create or replace function public.list_public_links(p_board_id uuid)
returns table(token uuid, role text, kind text, created_by uuid, created_at timestamp with time zone, expires_at timestamp with time zone, revoked_at timestamp with time zone, include_subboards boolean, allow_indexing boolean, joined_count integer)
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
$function$;

create or replace function public.revoke_public_link(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_is_owner        boolean;
  v_link_created_by uuid;
  v_board_id        uuid;
begin
  select public.can_manage_workspace(b.workspace_id), l.created_by, l.board_id
    into v_is_owner, v_link_created_by, v_board_id
  from public_share_links l
  join boards b on b.id = l.board_id
  where l.token = p_token;
  if not coalesce(v_is_owner, false) and (v_link_created_by is distinct from auth.uid()
                          or not can_write_board(v_board_id)) then
    raise exception 'you can only manage links you created' using errcode = '42501';
  end if;

  update public_share_links set revoked_at = now() where token = p_token;
end;
$function$;

create or replace function public.set_public_link_indexing(p_token uuid, p_allow boolean)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_is_owner        boolean;
  v_link_created_by uuid;
  v_board_id        uuid;
  v_kind            text;
begin
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  if coalesce(p_allow, false) and not public._actor_can_send() then
    raise exception 'sharing is paused on this account while we review unusual activity'
      using errcode = '42501';
  end if;
  -- 0375: and not in an account's first three days.
  if coalesce(p_allow, false) then
    perform public._refuse_if_new('Letting search engines index a link');
  end if;
  select public.can_manage_workspace(b.workspace_id), l.created_by, l.board_id, l.kind
    into v_is_owner, v_link_created_by, v_board_id, v_kind
  from public_share_links l
  join boards b on b.id = l.board_id
  where l.token = p_token;
  if not coalesce(v_is_owner, false) and (v_link_created_by is distinct from auth.uid()
                          or not can_write_board(v_board_id)) then
    raise exception 'you can only manage links you created' using errcode = '42501';
  end if;
  if v_kind = 'invite' and coalesce(p_allow, false) then
    raise exception 'invite links can''t be indexed' using errcode = '22023';
  end if;

  update public_share_links set allow_indexing = coalesce(p_allow, false)
  where token = p_token;
end;
$function$;

create or replace function public.set_public_link_subboards(p_token uuid, p_include boolean)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_is_owner        boolean;
  v_link_created_by uuid;
  v_board_id        uuid;
begin
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  select public.can_manage_workspace(b.workspace_id), l.created_by, l.board_id
    into v_is_owner, v_link_created_by, v_board_id
  from public_share_links l
  join boards b on b.id = l.board_id
  where l.token = p_token;
  if not coalesce(v_is_owner, false) and (v_link_created_by is distinct from auth.uid()
                          or not can_write_board(v_board_id)) then
    raise exception 'you can only manage links you created' using errcode = '42501';
  end if;

  update public_share_links set include_subboards = coalesce(p_include, false)
  where token = p_token;
end;
$function$;

create or replace function public.unshare_board(p_board_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_is_owner boolean;
begin
  select public.can_manage_workspace(b.workspace_id) into v_is_owner
  from boards b where b.id = p_board_id;

  if not coalesce(v_is_owner, false) then
    if not can_write_board(p_board_id) then
      raise exception 'you do not have permission to manage this board''s access'
        using errcode = '42501';
    end if;
    if not exists (
      select 1 from board_shares
      where board_id = p_board_id and user_id = p_user_id
        and invited_by = auth.uid()
    ) then
      raise exception 'you can only remove people you invited'
        using errcode = '42501';
    end if;
  end if;

  delete from board_shares
  where board_id = p_board_id and user_id = p_user_id;
end;
$function$;

create or replace function public.share_board(p_board_id uuid, p_email text, p_role text)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_owner                uuid;
  v_is_owner             boolean;
  v_user                 uuid;
  v_workspace            uuid;
  v_my_tier              text;
  v_existing_invited_by  uuid;
  v_email_norm           text := lower(trim(p_email));
  v_cap                  integer;
  v_editor_seats         integer;
begin
  if p_role not in ('viewer','editor') then
    raise exception 'role must be viewer or editor' using errcode = '22023';
  end if;

  -- 0358: a banned account stops inviting at once. Owners never reach
  -- can_write_board below, so they never met this check before.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select coalesce(
    (select tier from public.profiles where user_id = auth.uid()),
    'demo'
  ) into v_my_tier;

  if v_my_tier = 'waitlist' then
    raise exception 'your account isn''t active yet' using errcode = '42501';
  end if;
  -- (The 0147 "demo can only invite viewers" block was here. Editor
  -- collaboration is free now — owner-pays caps (0187) are the resource
  -- gate; the config brake below is the emergency lever.)

  select b.workspace_id into v_workspace
  from boards b where b.id = p_board_id;
  if v_workspace is null then
    raise exception 'board % not found', p_board_id using errcode = '42704';
  end if;

  select w.created_by into v_owner from workspaces w where w.id = v_workspace;
  -- 0391: a co-owner manages everyone's shares, like the owner.
  v_is_owner := public.can_manage_workspace(v_workspace);
  if not v_is_owner and not can_write_board(p_board_id) then
    raise exception 'you do not have permission to share this board'
      using errcode = '42501';
  end if;

  -- Dormant editor-seat brake: only bites when an admin sets a cap.
  if p_role = 'editor' then
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

  select id into v_user from auth.users where email = v_email_norm;

  if v_user is null then
    -- Pending path: invitee has no account yet. Re-inviting/refreshing is an
    -- "add" action — allowed for owners and editors; latest inviter owns the
    -- not-yet-claimed pending row.
    --
    -- 0358: only a NEW row fires the invite email (the trigger is AFTER
    -- INSERT), so only a new row spends budget; a refresh does not.
    if not exists (select 1 from pending_invites pi
                    where lower(pi.email) = v_email_norm
                      and pi.board_id = p_board_id
                      and pi.claimed_at is null) then
      perform public._invite_budget_take();
    end if;
    --
    -- The predicate must match pending_invites_board_unclaimed_uniq EXACTLY —
    -- including `board_id is not null`. Without it Postgres cannot infer the
    -- arbiter and every call raises 42P10 (see migration 0227's header).
    insert into pending_invites (email, workspace_id, board_id, role, invited_by)
    values (v_email_norm, v_workspace, p_board_id, p_role, auth.uid())
    on conflict (lower(email), board_id) where claimed_at is null and board_id is not null
    do update set role       = excluded.role,
                  invited_by = auth.uid(),
                  expires_at = now() + interval '30 days';
    return 'pending';
  end if;

  if v_user = auth.uid() then
    raise exception 'cannot share with yourself' using errcode = '22023';
  end if;

  -- Editors may add anyone, but may only CHANGE an existing share if they
  -- created it. A brand-new INSERT is always allowed (subject to tier/role).
  select invited_by into v_existing_invited_by
  from board_shares where board_id = p_board_id and user_id = v_user;
  if FOUND then
    if not v_is_owner and v_existing_invited_by is distinct from auth.uid() then
      raise exception 'you can only change the access of people you invited'
        using errcode = '42501';
    end if;
    -- 0360: they already have access, so this is a role change, not a new
    -- share. It sends no email and spends no budget; before, the panel's role
    -- picker re-sent "X shared Y with you" and used up an invite every time.
    update board_shares
       set role = p_role, invited_by = auth.uid()
     where board_id = p_board_id and user_id = v_user;
    return 'granted';
  end if;

  -- 0358: the share_notifications row below emails `board_shared`, so a new
  -- share spends budget.
  perform public._invite_budget_take();

  insert into board_shares (board_id, user_id, role, invited_by)
  values (p_board_id, v_user, p_role, auth.uid())
  on conflict (board_id, user_id)
  do update set role = excluded.role,
                invited_by = auth.uid();

  insert into share_notifications (user_id, board_id, role, shared_by)
  values (v_user, p_board_id, p_role, auth.uid());

  return 'granted';
end;
$function$;

-- ── 5. Settings ─────────────────────────────────────────────────────────────
-- Card defaults: any member who writes (0047 listed only editor + owner, so
-- the 0318 'admin' could not either).
create or replace function public.merge_workspace_settings(p_workspace_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_settings jsonb;
begin
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner', 'coowner', 'admin', 'editor')
  ) then
    raise exception 'Not authorised to update workspace settings.';
  end if;

  update public.workspaces
     set settings = settings || coalesce(p_patch, '{}'::jsonb)
   where id = p_workspace_id
   returning settings into v_settings;

  return v_settings;
end;
$function$;

-- ── 6. Policies ─────────────────────────────────────────────────────────────
-- Rename / icon. The column grant (0317: update (name, settings)) still keeps
-- created_by out of reach, so a co-owner can't make themselves the owner.
drop policy "ws update by creator" on public.workspaces;
create policy "ws update by creator or co-owner" on public.workspaces
  for update
  using (created_by = auth.uid() or public.can_manage_workspace(id));

drop policy "ws update settings by editor" on public.workspaces;
create policy "ws update settings by editor" on public.workspaces
  for update to authenticated
  using (exists (select 1 from public.workspace_members wm
                  where wm.workspace_id = workspaces.id and wm.user_id = auth.uid()
                    and wm.role in ('owner', 'coowner', 'editor')))
  with check (exists (select 1 from public.workspace_members wm
                       where wm.workspace_id = workspaces.id and wm.user_id = auth.uid()
                         and wm.role in ('owner', 'coowner', 'editor')));

drop policy "public_links read by owner" on public.public_share_links;
create policy "public_links read by owner" on public.public_share_links
  for select
  using (exists (select 1 from public.boards b
                  where b.id = public_share_links.board_id
                    and public.can_manage_workspace(b.workspace_id)));

drop policy "pending_invites read by owner or inviter" on public.pending_invites;
create policy "pending_invites read by owner or inviter" on public.pending_invites
  for select
  using (invited_by = auth.uid() or public.can_manage_workspace(workspace_id));

drop policy "board_shares read own or owner" on public.board_shares;
create policy "board_shares read own or owner" on public.board_shares
  for select
  using (user_id = auth.uid()
         or exists (select 1 from public.boards b
                     where b.id = board_shares.board_id
                       and public.can_manage_workspace(b.workspace_id)));

-- ── 7. Prove it ─────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.can_manage_workspace(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.can_manage_workspace(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._workspace_member_can_write(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._deletion_heir(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.set_workspace_member_role(uuid,uuid,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_workspace_member_role(uuid,uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.invite_workspace_member(uuid,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.invite_workspace_member(uuid,text,text)', 'execute')
     or has_function_privilege('anon', 'public.remove_workspace_member(uuid,uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.share_board(uuid,text,text)', 'execute') then
    raise exception '0391: grants are wrong';
  end if;
end $$;

commit;
