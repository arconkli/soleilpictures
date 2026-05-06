-- 0013_board_shares.sql — per-board sharing with viewer/editor roles.
--
-- A workspace owner can grant access to a single board (and its
-- descendant subtree) to a non-member at viewer or editor level.
-- Workspace members keep their existing full access; per-board shares
-- only ADD access (never demote). Cross-board links (boardlinks /
-- embedded board cards) do NOT cascade — the recipient must have
-- independent access to the linked target.

----------------------------------------------------------------------
-- TABLE
----------------------------------------------------------------------
create table if not exists board_shares (
  board_id   uuid not null references boards on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  role       text not null check (role in ('viewer','editor')),
  invited_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index if not exists board_shares_user_idx on board_shares(user_id);

alter table board_shares enable row level security;

-- Recipient sees their own share rows; workspace owner sees all
-- share rows for boards in their workspace. Insert/delete only via
-- the SECURITY DEFINER RPCs below, so no INSERT/DELETE policy
-- (default-deny on direct writes).
create policy "board_shares read own or owner" on board_shares
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from boards b
      join workspaces w on w.id = b.workspace_id
      where b.id = board_shares.board_id and w.created_by = auth.uid()
    )
  );

----------------------------------------------------------------------
-- HELPERS
----------------------------------------------------------------------

-- READ: caller can read this board if they're a workspace member of
-- this board OR ANY ancestor (cascade up the parent_board_id chain),
-- OR if any board in that chain has a board_share row for them.
create or replace function can_read_board(p_board_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  with recursive chain as (
    select id, workspace_id, parent_board_id
    from boards where id = p_board_id
    union all
    select b.id, b.workspace_id, b.parent_board_id
    from boards b join chain c on b.id = c.parent_board_id
  )
  select exists (
    select 1 from chain
    where is_workspace_member(chain.workspace_id)
       or exists (
         select 1 from board_shares s
         where s.board_id = chain.id and s.user_id = auth.uid()
       )
  );
$$;

-- WRITE: same chain walk, but the matching share has to be
-- role='editor' (workspace membership grants writes regardless).
create or replace function can_write_board(p_board_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  with recursive chain as (
    select id, workspace_id, parent_board_id
    from boards where id = p_board_id
    union all
    select b.id, b.workspace_id, b.parent_board_id
    from boards b join chain c on b.id = c.parent_board_id
  )
  select exists (
    select 1 from chain
    where is_workspace_member(chain.workspace_id)
       or exists (
         select 1 from board_shares s
         where s.board_id = chain.id
           and s.user_id = auth.uid()
           and s.role = 'editor'
       )
  );
$$;

revoke all on function can_read_board(uuid) from public;
grant execute on function can_read_board(uuid) to authenticated;
revoke all on function can_write_board(uuid) from public;
grant execute on function can_write_board(uuid) to authenticated;

----------------------------------------------------------------------
-- POLICY UPDATES (data tables)
----------------------------------------------------------------------

-- boards.SELECT — extend to include per-board shares (cascade aware).
-- INSERT/UPDATE/DELETE stay workspace-member-only (you can't rename
-- or delete a board you only have access to via a share).
drop policy if exists "boards read by members" on boards;
create policy "boards read" on boards for select
  using (can_read_board(id));

-- board_state — read-side cascades; write requires can_write_board.
drop policy if exists "board_state read by members"   on board_state;
drop policy if exists "board_state upsert by members" on board_state;
drop policy if exists "board_state update by members" on board_state;
drop policy if exists "board_state delete by members" on board_state;

create policy "board_state read"   on board_state for select
  using (can_read_board(board_id));
create policy "board_state insert" on board_state for insert
  to authenticated with check (can_write_board(board_id));
create policy "board_state update" on board_state for update
  using (can_write_board(board_id));
create policy "board_state delete" on board_state for delete
  using (can_write_board(board_id));

-- card_index — read uses can_read_board so viewers can search; write
-- stays workspace-only (only members create cards).
drop policy if exists "card_index member read" on card_index;
create policy "card_index read" on card_index for select
  using (can_read_board(board_id));

----------------------------------------------------------------------
-- POLICY UPDATES (realtime channels)
----------------------------------------------------------------------

-- board: presence channel — viewers + editors can subscribe AND
-- broadcast presence (so a viewer's cursor still appears for others).
drop policy if exists "realtime board: workspace members"        on realtime.messages;
drop policy if exists "realtime board: workspace members write"  on realtime.messages;

create policy "realtime board: readers" on realtime.messages
  for select to authenticated using (
    realtime.topic() like 'board:%'
    and can_read_board((substring(realtime.topic() from 7))::uuid)
  );
create policy "realtime board: readers write" on realtime.messages
  for insert to authenticated with check (
    realtime.topic() like 'board:%'
    and can_read_board((substring(realtime.topic() from 7))::uuid)
  );

-- y: Yjs sync channel — viewers can SUBSCRIBE (so they receive doc
-- updates and see the latest content), but only writers can BROADCAST
-- (so viewer edits never propagate via realtime).
drop policy if exists "realtime y: workspace members"        on realtime.messages;
drop policy if exists "realtime y: workspace members write"  on realtime.messages;

create policy "realtime y: readers" on realtime.messages
  for select to authenticated using (
    realtime.topic() like 'y:%'
    and can_read_board((substring(realtime.topic() from 3))::uuid)
  );
create policy "realtime y: writers" on realtime.messages
  for insert to authenticated with check (
    realtime.topic() like 'y:%'
    and can_write_board((substring(realtime.topic() from 3))::uuid)
  );

----------------------------------------------------------------------
-- RPCs (security definer)
----------------------------------------------------------------------

-- share_board: workspace owner adds a non-member by email. Upserts so
-- re-inviting at a different role updates the existing row.
create or replace function share_board(
  p_board_id uuid, p_email text, p_role text
) returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_owner     uuid;
  v_user      uuid;
  v_workspace uuid;
begin
  if p_role not in ('viewer','editor') then
    raise exception 'role must be viewer or editor' using errcode = '22023';
  end if;

  select b.workspace_id into v_workspace
  from boards b where b.id = p_board_id;
  if v_workspace is null then
    raise exception 'board % not found', p_board_id using errcode = '42704';
  end if;

  select w.created_by into v_owner
  from workspaces w where w.id = v_workspace;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can share boards'
      using errcode = '42501';
  end if;

  select id into v_user from auth.users where email = lower(trim(p_email));
  if v_user is null then
    raise exception 'no user with email %', p_email using errcode = 'P0002';
  end if;
  if v_user = auth.uid() then
    raise exception 'cannot share with yourself' using errcode = '22023';
  end if;

  insert into board_shares (board_id, user_id, role, invited_by)
  values (p_board_id, v_user, p_role, auth.uid())
  on conflict (board_id, user_id)
  do update set role = excluded.role,
                invited_by = auth.uid();
end;
$$;
revoke all on function share_board(uuid, text, text) from public;
grant execute on function share_board(uuid, text, text) to authenticated;

-- unshare_board: workspace owner drops a per-board share row.
create or replace function unshare_board(
  p_board_id uuid, p_user_id uuid
) returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_owner uuid;
begin
  select w.created_by into v_owner
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = p_board_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can unshare'
      using errcode = '42501';
  end if;

  delete from board_shares
  where board_id = p_board_id and user_id = p_user_id;
end;
$$;
revoke all on function unshare_board(uuid, uuid) from public;
grant execute on function unshare_board(uuid, uuid) to authenticated;

-- list_board_shares: owner lists per-board shares for a board with
-- the recipient's email.
create or replace function list_board_shares(p_board_id uuid)
returns table(user_id uuid, email text, role text,
              invited_by uuid, created_at timestamptz)
language plpgsql security definer
set search_path = public as $$
declare
  v_owner uuid;
begin
  select w.created_by into v_owner
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = p_board_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can list shares'
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

-- remove_workspace_member: owner removes any non-self member.
create or replace function remove_workspace_member(
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
end;
$$;
revoke all on function remove_workspace_member(uuid, uuid) from public;
grant execute on function remove_workspace_member(uuid, uuid) to authenticated;

-- list_shared_boards: boards the caller has access to via a per-board
-- share where they are NOT a workspace member of the source workspace.
-- Used by the sidebar's "Shared with me" section.
create or replace function list_shared_boards()
returns table(board_id uuid, board_name text, role text,
              source_workspace_id uuid, source_workspace_name text,
              parent_board_id uuid, board_view text, board_cover text,
              created_at timestamptz)
language sql stable security definer
set search_path = public as $$
  select b.id, b.name, s.role,
         w.id, w.name, b.parent_board_id,
         coalesce(b.view, 'canvas')::text,
         coalesce(b.cover, 'neutral')::text,
         s.created_at
  from board_shares s
  join boards b      on b.id = s.board_id
  join workspaces w  on w.id = b.workspace_id
  where s.user_id = auth.uid()
    and not is_workspace_member(b.workspace_id)
  order by w.name asc, b.name asc;
$$;
revoke all on function list_shared_boards() from public;
grant execute on function list_shared_boards() to authenticated;
