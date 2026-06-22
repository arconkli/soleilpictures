-- 0147_editors_can_share.sql — let EDITORS share boards, not just the owner.
--
-- Until now every share RPC required the caller to be the workspace owner
-- (workspaces.created_by). This migration relaxes that so anyone who can
-- WRITE the board (can_write_board = workspace member OR per-board
-- role='editor' share) can also share it. The owner keeps full powers.
--
-- Policy (per product decision):
--   * Add / create  → owner OR editor. Editors may invite at viewer OR
--     editor, and may create public links.
--   * Manage (remove / change role / revoke link / toggle link options)
--     → owner may do anything; an editor may only touch invites/links they
--     created themselves (board_shares.invited_by / public_share_links.created_by).
--   * List (transparency) → owner OR editor sees the full roster.
--
-- DELIBERATELY UNCHANGED (still owner-only): invite_workspace_member,
-- remove_workspace_member, list_pending_invites_for_workspace,
-- transfer_workspace_ownership. A workspace-member invite grants access to
-- EVERY board in the workspace — too broad to delegate to a single-board
-- editor.
--
-- No table/RLS changes: board_shares.invited_by, pending_invites.invited_by,
-- and public_share_links.created_by already exist and are already populated
-- (every existing row was owner-created). All writes still flow exclusively
-- through these SECURITY DEFINER RPCs (the tables have no INSERT/UPDATE/DELETE
-- policy), so loosening the in-body guards is the whole change. can_write_board
-- is itself SECURITY DEFINER and reads auth.uid(), which is preserved across
-- the nested definer call. Owners pass via v_is_owner (an owner is not
-- necessarily a workspace_members row, so we never rely on can_write_board
-- for them).

-----------------------------------------------------------------------
-- share_board — add a person (owner or editor); editors may only CHANGE
-- the role of a share they created. Tier checks (waitlist / demo) still
-- gate the caller. Returns 'granted' | 'pending'.
-----------------------------------------------------------------------
create or replace function share_board(
  p_board_id uuid, p_email text, p_role text
) returns text
language plpgsql security definer
set search_path = public as $$
declare
  v_owner                uuid;
  v_is_owner             boolean;
  v_user                 uuid;
  v_workspace            uuid;
  v_my_tier              text;
  v_existing_invited_by  uuid;
  v_email_norm           text := lower(trim(p_email));
begin
  if p_role not in ('viewer','editor') then
    raise exception 'role must be viewer or editor' using errcode = '22023';
  end if;

  select coalesce(
    (select tier from public.profiles where user_id = auth.uid()),
    'demo'
  ) into v_my_tier;

  if v_my_tier = 'waitlist' then
    raise exception 'your account isn''t active yet' using errcode = '42501';
  end if;
  if v_my_tier = 'demo' and p_role = 'editor' then
    raise exception 'inviting editors is a paid feature; upgrade to invite editors'
      using errcode = '42501';
  end if;

  select b.workspace_id into v_workspace
  from boards b where b.id = p_board_id;
  if v_workspace is null then
    raise exception 'board % not found', p_board_id using errcode = '42704';
  end if;

  select w.created_by into v_owner from workspaces w where w.id = v_workspace;
  v_is_owner := coalesce(v_owner = auth.uid(), false);
  if not v_is_owner and not can_write_board(p_board_id) then
    raise exception 'you do not have permission to share this board'
      using errcode = '42501';
  end if;

  select id into v_user from auth.users where email = v_email_norm;

  if v_user is null then
    -- Pending path: the invitee has no account yet. Re-inviting/refreshing
    -- is an "add" action — allowed for owners and editors alike; the most
    -- recent inviter owns the (not-yet-claimed) pending row.
    insert into pending_invites (email, workspace_id, board_id, role, invited_by)
    values (v_email_norm, v_workspace, p_board_id, p_role, auth.uid())
    on conflict (lower(email), board_id) where claimed_at is null
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
  if FOUND and not v_is_owner and v_existing_invited_by is distinct from auth.uid() then
    raise exception 'you can only change the access of people you invited'
      using errcode = '42501';
  end if;

  insert into board_shares (board_id, user_id, role, invited_by)
  values (p_board_id, v_user, p_role, auth.uid())
  on conflict (board_id, user_id)
  do update set role = excluded.role,
                invited_by = auth.uid();

  insert into share_notifications (user_id, board_id, role, shared_by)
  values (v_user, p_board_id, p_role, auth.uid());

  return 'granted';
end;
$$;
revoke all on function share_board(uuid, text, text) from public;
grant execute on function share_board(uuid, text, text) to authenticated;

-----------------------------------------------------------------------
-- unshare_board — owner removes anyone; editor removes only people they
-- invited. (The owner is never a board_shares row, so an editor can never
-- remove the owner here.)
-----------------------------------------------------------------------
create or replace function unshare_board(
  p_board_id uuid, p_user_id uuid
) returns void
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

  if not v_is_owner then
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
$$;
revoke all on function unshare_board(uuid, uuid) from public;
grant execute on function unshare_board(uuid, uuid) to authenticated;

-----------------------------------------------------------------------
-- list_board_shares — owner OR editor may view the full per-board roster
-- (transparency); editors identify their own rows via invited_by.
-----------------------------------------------------------------------
create or replace function list_board_shares(p_board_id uuid)
returns table(user_id uuid, email text, role text,
              invited_by uuid, created_at timestamptz)
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
$$;
revoke all on function list_board_shares(uuid) from public;
grant execute on function list_board_shares(uuid) to authenticated;

-----------------------------------------------------------------------
-- revoke_pending_invite — owner revokes any; editor revokes only the
-- board-scoped pending invites they created. Workspace-level pending
-- invites (board_id is null) stay owner-only.
-----------------------------------------------------------------------
create or replace function revoke_pending_invite(p_id uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_owner      uuid;
  v_is_owner   boolean;
  v_board      uuid;
  v_invited_by uuid;
begin
  select w.created_by, pi.board_id, pi.invited_by
    into v_owner, v_board, v_invited_by
  from pending_invites pi
  join workspaces w on w.id = pi.workspace_id
  where pi.id = p_id;
  if v_owner is null then
    return;  -- already gone / not found — idempotent
  end if;

  v_is_owner := coalesce(v_owner = auth.uid(), false);
  if not v_is_owner then
    if v_board is null then
      raise exception 'only the workspace owner can revoke workspace invites'
        using errcode = '42501';
    end if;
    if not can_write_board(v_board) or v_invited_by is distinct from auth.uid() then
      raise exception 'you can only revoke invites you created'
        using errcode = '42501';
    end if;
  end if;

  delete from pending_invites where id = p_id;
end;
$$;
revoke all on function revoke_pending_invite(uuid) from public;
grant execute on function revoke_pending_invite(uuid) to authenticated;

-----------------------------------------------------------------------
-- list_pending_invites_for_board — owner OR editor.
-----------------------------------------------------------------------
create or replace function list_pending_invites_for_board(p_board_id uuid)
returns table(id uuid, email text, role text, invited_by uuid,
              expires_at timestamptz, created_at timestamptz)
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
$$;
revoke all on function list_pending_invites_for_board(uuid) from public;
grant execute on function list_pending_invites_for_board(uuid) to authenticated;

-----------------------------------------------------------------------
-- create_public_link — owner OR editor. created_by stamps the caller so
-- the manage RPCs below can enforce the own-link rule.
-----------------------------------------------------------------------
create or replace function create_public_link(
  p_board_id uuid,
  p_expires_at timestamptz default null,
  p_include_subboards boolean default false
) returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_owner    uuid;
  v_is_owner boolean;
  v_token    uuid;
begin
  select w.created_by into v_owner
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = p_board_id;
  v_is_owner := coalesce(v_owner = auth.uid(), false);
  if not v_is_owner and not can_write_board(p_board_id) then
    raise exception 'you do not have permission to create links for this board'
      using errcode = '42501';
  end if;

  insert into public_share_links (board_id, role, created_by, expires_at, include_subboards)
  values (p_board_id, 'viewer', auth.uid(), p_expires_at, coalesce(p_include_subboards, false))
  returning token into v_token;
  return v_token;
end;
$$;
revoke all on function create_public_link(uuid, timestamptz, boolean) from public;
grant execute on function create_public_link(uuid, timestamptz, boolean) to authenticated;

-----------------------------------------------------------------------
-- revoke_public_link — owner revokes any; editor revokes only links they
-- created (and only while they can still write the board).
-----------------------------------------------------------------------
create or replace function revoke_public_link(p_token uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_owner           uuid;
  v_is_owner        boolean;
  v_link_created_by uuid;
  v_board_id        uuid;
begin
  select w.created_by, l.created_by, l.board_id
    into v_owner, v_link_created_by, v_board_id
  from public_share_links l
  join boards b on b.id = l.board_id
  join workspaces w on w.id = b.workspace_id
  where l.token = p_token;
  v_is_owner := coalesce(v_owner = auth.uid(), false);
  if not v_is_owner and (v_link_created_by is distinct from auth.uid()
                          or not can_write_board(v_board_id)) then
    raise exception 'you can only manage links you created' using errcode = '42501';
  end if;

  update public_share_links set revoked_at = now() where token = p_token;
end;
$$;
revoke all on function revoke_public_link(uuid) from public;
grant execute on function revoke_public_link(uuid) to authenticated;

-----------------------------------------------------------------------
-- set_public_link_subboards — owner OR own-link editor.
-----------------------------------------------------------------------
create or replace function set_public_link_subboards(p_token uuid, p_include boolean)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_owner           uuid;
  v_is_owner        boolean;
  v_link_created_by uuid;
  v_board_id        uuid;
begin
  select w.created_by, l.created_by, l.board_id
    into v_owner, v_link_created_by, v_board_id
  from public_share_links l
  join boards b on b.id = l.board_id
  join workspaces w on w.id = b.workspace_id
  where l.token = p_token;
  v_is_owner := coalesce(v_owner = auth.uid(), false);
  if not v_is_owner and (v_link_created_by is distinct from auth.uid()
                          or not can_write_board(v_board_id)) then
    raise exception 'you can only manage links you created' using errcode = '42501';
  end if;

  update public_share_links set include_subboards = coalesce(p_include, false)
  where token = p_token;
end;
$$;
revoke all on function set_public_link_subboards(uuid, boolean) from public;
grant execute on function set_public_link_subboards(uuid, boolean) to authenticated;

-----------------------------------------------------------------------
-- set_public_link_indexing — owner OR own-link editor.
-----------------------------------------------------------------------
create or replace function set_public_link_indexing(p_token uuid, p_allow boolean)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_owner           uuid;
  v_is_owner        boolean;
  v_link_created_by uuid;
  v_board_id        uuid;
begin
  select w.created_by, l.created_by, l.board_id
    into v_owner, v_link_created_by, v_board_id
  from public_share_links l
  join boards b on b.id = l.board_id
  join workspaces w on w.id = b.workspace_id
  where l.token = p_token;
  v_is_owner := coalesce(v_owner = auth.uid(), false);
  if not v_is_owner and (v_link_created_by is distinct from auth.uid()
                          or not can_write_board(v_board_id)) then
    raise exception 'you can only manage links you created' using errcode = '42501';
  end if;

  update public_share_links set allow_indexing = coalesce(p_allow, false)
  where token = p_token;
end;
$$;
revoke all on function set_public_link_indexing(uuid, boolean) from public;
grant execute on function set_public_link_indexing(uuid, boolean) to authenticated;

-----------------------------------------------------------------------
-- list_public_links — owner OR editor (transparency); editors identify
-- their own links via created_by.
-----------------------------------------------------------------------
create or replace function list_public_links(p_board_id uuid)
returns table(
  token uuid, role text, created_by uuid,
  created_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
  include_subboards boolean, allow_indexing boolean
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
  select l.token, l.role, l.created_by, l.created_at, l.expires_at, l.revoked_at,
         l.include_subboards, l.allow_indexing
  from public_share_links l
  where l.board_id = p_board_id
  order by l.created_at desc;
end;
$$;
revoke all on function list_public_links(uuid) from public;
grant execute on function list_public_links(uuid) to authenticated;
