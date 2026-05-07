-- Allow per-board editors (granted via board_shares, not workspace
-- members) to create CHILD boards under any board they can write to.
-- Workspace members keep full insert rights; per-board editors gain
-- the ability to nest sub-boards under a shared board.
--
-- Root-board creation (parent_board_id is null) still requires
-- workspace membership — only members can spawn top-level boards
-- in a workspace.

drop policy if exists "boards insert by members" on boards;
create policy "boards insert by members or share editors" on boards for insert
  with check (
    is_workspace_member(workspace_id)
    or (
      parent_board_id is not null
      and can_write_board(parent_board_id)
    )
  );
