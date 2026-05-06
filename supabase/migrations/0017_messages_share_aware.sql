-- 0017_messages_share_aware.sql — let per-board-share viewers see
-- board chat for boards they have access to.
--
-- Today messages.read uses is_workspace_member(workspace_id), which
-- excludes per-board shares. We extend it to also accept
-- can_read_board(board_id) for board-channel messages (board_id is
-- non-null). DMs (board_id is null, dm_peer_id is set) still gate
-- strictly on workspace membership — we don't want shared-board
-- viewers reading workspace-internal DMs.
--
-- Insert/update/delete policies stay unchanged: viewers can read but
-- not post (matches the read-only model).

drop policy if exists "messages read" on messages;

create policy "messages read" on messages for select
  using (
    is_workspace_member(workspace_id)
    or (board_id is not null and can_read_board(board_id))
  );
