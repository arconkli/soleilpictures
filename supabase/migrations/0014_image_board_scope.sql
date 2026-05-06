-- 0014_image_board_scope.sql — track which board an image belongs to
-- so per-board shares cover image access too.
--
-- Today the `images` table only knows the workspace; RLS gates by
-- `is_workspace_member`. With per-board sharing (migration 0013), we
-- want a viewer of a single shared board to be able to fetch images
-- on that board without being a workspace member. Adding board_id +
-- using `can_read_board` for RLS is the cleanest way to make that
-- work; it also lets the upload worker presign read URLs purely off
-- RLS (no per-image permission code in the worker).

alter table images add column if not exists board_id uuid
  references boards(id) on delete set null;
create index if not exists images_board_idx on images(board_id);

-- Replace the existing read/write policies with ones that also accept
-- per-board shares. Workspace members keep their full access via the
-- first OR branch; viewer/editor shares of a board work via the
-- second OR branch (cascade handled by can_read_board / can_write_board).
drop policy if exists "images read by members"   on images;
drop policy if exists "images write by members"  on images;
drop policy if exists "images delete by members" on images;

create policy "images read" on images for select
  using (
    is_workspace_member(workspace_id)
    or (board_id is not null and can_read_board(board_id))
  );

create policy "images insert" on images for insert
  to authenticated with check (
    is_workspace_member(workspace_id)
    or (board_id is not null and can_write_board(board_id))
  );

create policy "images delete" on images for delete
  using (
    is_workspace_member(workspace_id)
    or (board_id is not null and can_write_board(board_id))
  );
