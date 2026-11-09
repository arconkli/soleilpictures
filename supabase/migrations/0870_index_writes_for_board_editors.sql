-- 0870_index_writes_for_board_editors.sql
--
-- Someone invited to edit one cluster (a board_shares row with role 'editor',
-- not a member of the cluster's workspace) could draw on it, but every save
-- then failed to mirror the cards and groups into card_index and group_index:
-- syncCardIndex and syncGroupIndex (lib/boardsApi.js) upsert with
-- onConflict (board_id, card_id) / (board_id, group_id) and delete orphan
-- rows, and every write policy on both tables asked can_write_workspace(),
-- which is membership only. Error reports showed those editors refused with
-- 42501 on both tables, so what they added never reached search, tags or the
-- card count.
--
-- 1. card_index insert / update / delete also pass when the caller can write
--    the board (can_write_board: membership, workspace creator, or an editor
--    share on the board or an ancestor) AND the board is in the row's
--    workspace. The membership test comes first in every OR, so a member is
--    decided exactly as before and never reaches can_write_board. The
--    _board_in_workspace() half of 0366 stays on every WITH CHECK.
--
-- 2. group_index: its single FOR ALL policy is split into insert / update /
--    delete with the same widening, and a read policy mirroring card_index's
--    ("group_index read", rows of clusters the caller can read) joins
--    "group_index member read", which is unchanged.
--    The read policy is required, not decoration. INSERT ... ON CONFLICT DO
--    UPDATE checks the new row and the existing one against the SELECT
--    policies too, and the app's orphan pass reads the board's group ids
--    before it deletes. Measured on a copy of the table with the widened write
--    policies but no read policy: the editor's upsert was refused 42501 for a
--    new group and for an existing one, and the orphan read returned nothing.
--    Splitting FOR ALL also takes can_write_workspace() off every group_index
--    read, as 0308 did for card_index. The only readers who could lose a row
--    are creators of a workspace they are not a member of; the four such
--    workspaces today have no creator (deleted accounts) and no groups.
--
-- Checked on production, on copies of both tables carrying the old and the
-- new policies, as a real invited editor on one of their shared clusters: the
-- old policies refused the upsert of a new row and of an existing row with
-- 42501 and the orphan delete removed nothing; the new ones passed all three.
-- A view-only person on a shared cluster and a stranger were still refused
-- (42501 on upserts, nothing deleted); a workspace member passed under both.
-- A member's 200-row upsert ran in the same time and buffers under old and new
-- card_index policies, and faster on group_index (the per-row
-- can_write_workspace on the FOR ALL policy is gone); a member's group_index
-- read returned the same rows under both.

begin;

-- Policy DDL locks each table outright until commit. Waiting behind a long
-- transaction would stall every save queued behind this one, so give up fast
-- and run it again instead.
set local lock_timeout = '2s';

-- ── 1. card_index ───────────────────────────────────────────────────────────

drop policy if exists "card_index insert" on public.card_index;
create policy "card_index insert" on public.card_index
  for insert to public
  with check (
    (can_write_workspace(workspace_id) or can_write_board(board_id))
    and _board_in_workspace(board_id, workspace_id)
  );

drop policy if exists "card_index update" on public.card_index;
create policy "card_index update" on public.card_index
  for update to public
  using (
    can_write_workspace(workspace_id)
    or (can_write_board(board_id) and _board_in_workspace(board_id, workspace_id))
  )
  with check (
    (can_write_workspace(workspace_id) or can_write_board(board_id))
    and _board_in_workspace(board_id, workspace_id)
  );

drop policy if exists "card_index delete" on public.card_index;
create policy "card_index delete" on public.card_index
  for delete to public
  using (
    can_write_workspace(workspace_id)
    or (can_write_board(board_id) and _board_in_workspace(board_id, workspace_id))
  );

-- ── 2. group_index ──────────────────────────────────────────────────────────

drop policy if exists "group_index write" on public.group_index;

drop policy if exists "group_index read" on public.group_index;
create policy "group_index read" on public.group_index
  for select to public
  using (ARRAY[board_id] && (select my_readable_board_ids()));

drop policy if exists "group_index insert" on public.group_index;
create policy "group_index insert" on public.group_index
  for insert to public
  with check (
    can_write_workspace(workspace_id)
    or (can_write_board(board_id) and _board_in_workspace(board_id, workspace_id))
  );

drop policy if exists "group_index update" on public.group_index;
create policy "group_index update" on public.group_index
  for update to public
  using (
    can_write_workspace(workspace_id)
    or (can_write_board(board_id) and _board_in_workspace(board_id, workspace_id))
  )
  with check (
    can_write_workspace(workspace_id)
    or (can_write_board(board_id) and _board_in_workspace(board_id, workspace_id))
  );

drop policy if exists "group_index delete" on public.group_index;
create policy "group_index delete" on public.group_index
  for delete to public
  using (
    can_write_workspace(workspace_id)
    or (can_write_board(board_id) and _board_in_workspace(board_id, workspace_id))
  );

-- ── Proofs ──────────────────────────────────────────────────────────────────

do $$
declare
  v_expect text[] := array[
    'card_index:card_index read:SELECT', 'card_index:card_index insert:INSERT',
    'card_index:card_index update:UPDATE', 'card_index:card_index delete:DELETE',
    'group_index:group_index member read:SELECT', 'group_index:group_index read:SELECT',
    'group_index:group_index insert:INSERT', 'group_index:group_index update:UPDATE',
    'group_index:group_index delete:DELETE'];
  v_have text[];
begin
  select array_agg(tablename || ':' || policyname || ':' || cmd
                   order by tablename || ':' || policyname || ':' || cmd)
    into v_have
    from pg_policies
   where schemaname = 'public' and tablename in ('card_index', 'group_index');
  if v_have is distinct from (select array_agg(x order by x) from unnest(v_expect) x) then
    raise exception '0870: card_index / group_index policies are not the expected set: %', v_have;
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename in ('card_index', 'group_index')
                and cmd in ('INSERT', 'UPDATE')
                and position('can_write_board' in coalesce(with_check, '')) = 0) then
    raise exception '0870: a write policy does not let board editors through';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename in ('card_index', 'group_index')
                and cmd in ('INSERT', 'UPDATE')
                and position('_board_in_workspace' in coalesce(with_check, '')) = 0) then
    raise exception '0870: a write policy lost the board-in-workspace check';
  end if;
end $$;

commit;
