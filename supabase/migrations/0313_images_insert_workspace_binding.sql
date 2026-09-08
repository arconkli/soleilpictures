-- 0313_images_insert_workspace_binding.sql
--
-- An images row could name ANY workspace, as long as the caller could write
-- the board it also named.
--
-- The INSERT policy was
--   can_write_workspace(workspace_id) OR (board_id IS NOT NULL AND can_write_board(board_id))
-- and nothing related the two columns. So an editor on board X in workspace A
-- could insert {workspace_id: B, board_id: X} for a workspace B they have no
-- relationship with. Two things then happen to B:
--   * storage_usage_trg bills the bytes to B's owner (_image_owner resolves the
--     owner FROM images.workspace_id), so B's quota can be exhausted from
--     outside; and
--   * B's members see the row through "images read"
--     (ARRAY[workspace_id] && my_workspace_ids()), so content can be injected
--     into another tenant's image table.
-- The PartyKit single-PUT path made this trivial to reach: its key prefix is
-- this.room.id, a URL segment the client picks, and it only checked
-- can_write_board(boardId). That half is fixed in boards/party/upload.ts.
--
-- What this must NOT break, checked against the data first:
-- 177 existing rows have board_id in a different workspace than the row. For
-- 159 of them the uploader is a member of the row's workspace — share editors
-- uploading to someone else's board and filing the image under their OWN
-- workspace. Those pass the FIRST branch (can_write_workspace of their own
-- workspace) and are untouched by this change. The remaining 18 are exactly the
-- shape being closed: a non-member filing under a foreign workspace. Existing
-- rows are not re-checked; only new inserts are.
--
-- The rule, stated once: if you are not a member of the workspace you are
-- filing under, the image must live in the board's own workspace.

create or replace function public._board_in_workspace(p_board_id uuid, p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board_id and b.workspace_id = p_workspace_id
  );
$$;

-- Evaluated inside the policy for authenticated inserts; nobody else needs it.
revoke all on function public._board_in_workspace(uuid, uuid) from public, anon;
grant execute on function public._board_in_workspace(uuid, uuid) to authenticated, service_role;

drop policy if exists "images insert" on public.images;
create policy "images insert" on public.images
  for insert to authenticated
  with check (
    can_write_workspace(workspace_id)
    or (
      board_id is not null
      and can_write_board(board_id)
      and _board_in_workspace(board_id, workspace_id)
    )
  );
