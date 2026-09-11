-- 0318_workspace_roles_real.sql
--
-- workspace_members.role has been decorative since 0001: it is unconstrained
-- text, defaults to 'editor', and is read by exactly two policies (0047, 0048).
-- Every authorization predicate reaches membership through the role-blind
-- is_workspace_member(), so a workspace "viewer" has full write access to every
-- board in the workspace, there is no RPC to change a member's role, the
-- ShareModal can only ever invite 'editor' (ShareModal.jsx:449-452), and
-- invite_workspace_member's pending path stores 'workspace' whatever role was
-- asked for (0086:208-213) — so an invited viewer becomes an editor on claim.
--
-- The organization layer (Phase 1) needs real workspace roles under it. This
-- migration makes them real with the smallest possible change to each body:
--
--   * a CHECK on the column, pre-asserted against live values, which are
--     owner / editor / viewer / service (0222 writes 'service' for service
--     accounts) — 'admin' is reserved for Phase 1;
--   * ONE statement of who may write through membership,
--     _workspace_member_can_write(ws) := role in (owner, admin, editor, service),
--     used by BOTH write predicates. 'service' MUST be in that set or every
--     service account loses /api/v1 writes;
--   * can_write_workspace / can_write_board re-emitted from 0188 with
--     is_workspace_member → _workspace_member_can_write, plus _actor_active()
--     (banned users lose writes at the RLS layer, not at token expiry);
--   * authorize_upload re-emitted from 0221 WITHOUT `or is_workspace_member`,
--     which otherwise lets a viewer open multipart uploads after the change;
--   * remove_workspace_member / leave_workspace cascade to board_shares in that
--     workspace, so "removing someone removes them" becomes a true sentence;
--   * set_workspace_member_role, owner-only, editor|viewer;
--   * invite_workspace_member stores 'viewer' when asked for viewer (both claim
--     paths already map 'viewer' → viewer and anything else → editor);
--   * comments insert goes through can_comment_board(), defined as
--     can_read_board() — share viewers can comment today (0031:50-55) and
--     narrowing that would be a live regression; the docs are corrected instead.
--
-- Reads are untouched here (0319). is_workspace_member stays role-blind.
--
-- Behaviour change for real accounts: any existing workspace_members row with
-- role = 'viewer' loses board_state / card_index writes, and an open PartyKit
-- socket flips to readOnly within the 10-second auth cache; banned accounts
-- (profiles.banned_at is not null) lose writes immediately at the RLS layer
-- instead of at token expiry; and waitlist-tier members (profiles.tier =
-- 'waitlist') lose multipart uploads, since authorize_upload no longer
-- re-admits them through the removed is_workspace_member OR. The pre-flight
-- below counts all three so the owners can be told before this applies.

-- ── 0. Pre-flight: live values and the viewer count ─────────────────────────
do $$
declare v_bad int; v_viewers int; v_banned int; v_waitlist int;
begin
  select count(*) into v_bad from public.workspace_members
   where role not in ('owner','admin','editor','viewer','service');
  if v_bad > 0 then
    raise exception 'workspace_members holds % rows with a role outside owner/admin/editor/viewer/service — inspect before adding the CHECK', v_bad;
  end if;
  select count(*) into v_viewers from public.workspace_members where role = 'viewer';
  raise notice '0318: % workspace member rows currently hold role=viewer and will become read-only', v_viewers;
  select count(*) into v_banned from public.workspace_members wm
    join public.profiles p on p.user_id = wm.user_id where p.banned_at is not null;
  raise notice '0318: % workspace member rows belong to banned accounts and lose writes immediately (was: until token expiry)', v_banned;
  select count(*) into v_waitlist from public.workspace_members wm
    join public.profiles p on p.user_id = wm.user_id where p.tier = 'waitlist';
  raise notice '0318: % workspace member rows belong to waitlist-tier accounts and lose multipart uploads', v_waitlist;
end $$;

alter table public.workspace_members
  drop constraint if exists workspace_members_role_check;
alter table public.workspace_members
  add constraint workspace_members_role_check
  check (role in ('owner','admin','editor','viewer','service'));

-- ── 1. The suspend gate and the one writer set ──────────────────────────────
-- anon (auth.uid() null) has no profile row and is "active": the read
-- predicates decide anon on membership, which anon never has.
create or replace function public._actor_active()
returns boolean
language sql stable security definer
set search_path = public as $$
  select coalesce(
    (select p.banned_at is null from public.profiles p where p.user_id = auth.uid()),
    true
  );
$$;
revoke all on function public._actor_active() from public, anon, authenticated;

create or replace function public._workspace_member_role(ws uuid)
returns text
language sql stable security definer
set search_path = public as $$
  select wm.role from public.workspace_members wm
  where wm.workspace_id = ws and wm.user_id = auth.uid()
  limit 1;
$$;
revoke all on function public._workspace_member_role(uuid) from public, anon, authenticated;

create or replace function public._workspace_member_can_write(ws uuid)
returns boolean
language sql stable security definer
set search_path = public as $$
  select coalesce(public._workspace_member_role(ws) in ('owner', 'admin', 'editor', 'service'), false);
$$;
revoke all on function public._workspace_member_can_write(uuid) from public, anon, authenticated;

-- ── 2. can_write_workspace — 0188:108-127 with two edits ─────────────────────
create or replace function public.can_write_workspace(ws uuid)
returns boolean
language sql stable security definer
set search_path = public as $$
  with t as (
    select coalesce(
      (select tier from public.profiles where user_id = auth.uid()),
      'demo'
    ) as tier
  )
  select case
    when (select tier from t) = 'waitlist' then false
    when not public._actor_active() then false
    else public._workspace_member_can_write(ws)
      or exists (
        select 1 from public.workspaces w
        where w.id = ws and w.created_by = auth.uid()
      )
  end;
$$;

-- ── 3. can_write_board — 0188:68-102 with the same two edits ────────────────
create or replace function public.can_write_board(p_board_id uuid)
returns boolean
language sql stable security definer
set search_path = public as $$
  with recursive t as (
    select coalesce(
      (select tier from public.profiles where user_id = auth.uid()),
      'demo'
    ) as tier
  ),
  chain as (
    select id, workspace_id, parent_board_id
    from public.boards where id = p_board_id
    union all
    select b.id, b.workspace_id, b.parent_board_id
    from public.boards b
    join chain c on b.id = c.parent_board_id
  )
  select case
    when (select tier from t) = 'waitlist' then false
    when not public._actor_active() then false
    else exists (
      select 1 from chain
      where public._workspace_member_can_write(chain.workspace_id)
         or exists (
           select 1 from public.workspaces w
           where w.id = chain.workspace_id and w.created_by = auth.uid()
         )
         or exists (
           select 1 from public.board_shares s
           where s.board_id = chain.id
             and s.user_id  = auth.uid()
             and s.role     = 'editor'
         )
    )
  end;
$$;

-- ── 3b. Say the grants, do not inherit them ─────────────────────────────────
-- The post-condition below asserts anon EXECUTE on both write predicates, but
-- no migration ever issued it: 0013:92-93, 0065:168-169 and 0083:65-66 grant
-- authenticated only, and the anon grant that is live came from the schema
-- default at creation, which `revoke … from public` does not touch. State it
-- the 0319 way so this file proves what it asserts. Zero behavioural change.
revoke all on function public.can_write_workspace(uuid) from public;
grant execute on function public.can_write_workspace(uuid) to anon, authenticated, service_role;
revoke all on function public.can_write_board(uuid) from public;
grant execute on function public.can_write_board(uuid) to anon, authenticated, service_role;

-- ── 4. authorize_upload — 0221:261-295 minus the membership OR ──────────────
create or replace function public.authorize_upload(p_workspace_id uuid, p_bytes bigint)
returns table(allow boolean, used bigint, quota bigint, remaining bigint, reason text)
language plpgsql stable security definer
set search_path = public as $$
declare
  v_owner uuid;
  v_owner_tier text;
  v_quota bigint;
  v_used bigint;
  v_bytes bigint := greatest(0, coalesce(p_bytes, 0));
begin
  select created_by into v_owner from public.workspaces where id = p_workspace_id;
  if v_owner is null then
    return query select false, 0::bigint, 0::bigint, 0::bigint, 'no_workspace'::text; return;
  end if;

  if not public.can_write_workspace(p_workspace_id) then
    return query select false, 0::bigint, 0::bigint, 0::bigint, 'not_writer'::text; return;
  end if;

  v_quota := public._storage_quota_bytes(v_owner);

  select coalesce(tier, 'demo') into v_owner_tier from public.profiles where user_id = v_owner;
  if coalesce(v_owner_tier, 'demo') not in ('paid', 'admin') then
    return query select false, 0::bigint, v_quota, 0::bigint, 'owner_not_paid'::text; return;
  end if;

  v_used := public._storage_used_bytes(v_owner);

  return query select (v_used + v_bytes <= v_quota), v_used, v_quota,
                      greatest(0, v_quota - v_used),
                      (case when (v_used + v_bytes <= v_quota) then 'ok' else 'over_quota' end)::text;
end $$;

-- ── 5. Removal cascades to board shares in that workspace ───────────────────
create or replace function public.remove_workspace_member(
  p_workspace_id uuid, p_user_id uuid
) returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_owner uuid;
begin
  select created_by into v_owner from workspaces
  where id = p_workspace_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can remove members'
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
$$;

create or replace function public.leave_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select created_by into v_owner from workspaces where id = p_workspace_id;

  if v_owner = auth.uid() then
    raise exception 'workspace owner cannot leave — delete the workspace instead'
      using errcode = '42501';
  end if;

  delete from workspace_members
  where workspace_id = p_workspace_id and user_id = auth.uid();

  -- 0318: same cascade as remove_workspace_member.
  delete from board_shares
  where user_id = auth.uid()
    and board_id in (select id from boards where workspace_id = p_workspace_id);
end;
$$;

-- ── 6. Owner changes a member's role ────────────────────────────────────────
create or replace function public.set_workspace_member_role(
  p_workspace_id uuid, p_user_id uuid, p_role text
) returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_owner uuid;
begin
  if p_role not in ('editor', 'viewer') then
    raise exception 'role must be editor or viewer' using errcode = '22023';
  end if;
  select created_by into v_owner from workspaces where id = p_workspace_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can change roles' using errcode = '42501';
  end if;
  if p_user_id = v_owner then
    raise exception 'the owner''s role is ownership; transfer it instead' using errcode = '42501';
  end if;
  update workspace_members
     set role = p_role
   where workspace_id = p_workspace_id
     and user_id = p_user_id
     and role in ('editor', 'viewer');
  if not found then
    raise exception 'not a member with a changeable role' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.set_workspace_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_workspace_member_role(uuid, uuid, text) to authenticated;

-- ── 7. invite_workspace_member — 0086:177-232, pending role honours viewer ──
create or replace function public.invite_workspace_member(
  p_workspace_id uuid, p_email text, p_role text default 'editor'
) returns text
language plpgsql security definer
set search_path = public as $$
declare
  v_owner       uuid;
  v_user        uuid;
  v_my_tier     text;
  v_email_norm  text := lower(trim(p_email));
begin
  if p_role not in ('editor','viewer') then
    raise exception 'workspace member role must be editor or viewer'
      using errcode = '22023';
  end if;

  select coalesce((select tier from public.profiles where user_id = auth.uid()), 'demo')
    into v_my_tier;
  if v_my_tier = 'waitlist' then
    raise exception 'your account isn''t active yet' using errcode = '42501';
  end if;

  select created_by into v_owner from workspaces where id = p_workspace_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can add members'
      using errcode = '42501';
  end if;

  select id into v_user from auth.users where email = v_email_norm;

  if v_user is null then
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

  begin
    insert into workspace_members (workspace_id, user_id, role)
    values (p_workspace_id, v_user, p_role);
  exception when unique_violation then
    return 'already_member';
  end;

  return 'granted';
end;
$$;

-- ── 8. Commenting is a read-level right today; say so in one function ───────
create or replace function public.can_comment_board(p_board_id uuid)
returns boolean
language sql stable security definer
set search_path = public as $$
  select public.can_read_board(p_board_id);
$$;
revoke all on function public.can_comment_board(uuid) from public;
grant execute on function public.can_comment_board(uuid) to anon, authenticated, service_role;

drop policy if exists "comments insert" on public.comments;
create policy "comments insert"
  on public.comments for insert
  with check (
    author = auth.uid()
    and public.can_comment_board(board_id)
  );

-- ── Post-conditions ─────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public._actor_active()', 'execute')
     or has_function_privilege('authenticated', 'public._actor_active()', 'execute')
     or has_function_privilege('anon', 'public._workspace_member_role(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._workspace_member_role(uuid)', 'execute')
     or has_function_privilege('anon', 'public._workspace_member_can_write(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._workspace_member_can_write(uuid)', 'execute') then
    raise exception 'an internal helper is client-callable';
  end if;
  -- RLS helpers must stay anon-callable (0311 rationale: a policy evaluated for
  -- an anon SELECT must be able to call them).
  if not has_function_privilege('anon', 'public.can_write_board(uuid)', 'execute')
     or not has_function_privilege('anon', 'public.can_write_workspace(uuid)', 'execute')
     or not has_function_privilege('anon', 'public.can_comment_board(uuid)', 'execute') then
    raise exception 'an RLS helper lost its anon EXECUTE';
  end if;
  if has_function_privilege('anon', 'public.set_workspace_member_role(uuid, uuid, text)', 'execute') then
    raise exception 'set_workspace_member_role is anon-callable';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'workspace_members_role_check'
  ) then
    raise exception 'role CHECK missing';
  end if;
end $$;
