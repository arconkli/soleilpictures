-- Restore the real boards INSERT policy (replaced by a tmp_true
-- diagnostic policy during debugging). The actual policy:
-- workspace members can insert anything; per-board editors can
-- insert child boards under any board they can write to.
--
-- The "still failing" symptom turned out to be the INSERT…RETURNING
-- path, not the with_check itself: returning re-evaluates the SELECT
-- policy on the just-inserted row, and can_read_board's recursive
-- chain walk against the boards table can't see the new row in the
-- same MVCC snapshot. The fix lives client-side: createBoard now
-- generates the id locally and runs a follow-up SELECT instead of
-- using RETURNING.

drop policy if exists "boards insert tmp_true" on boards;
drop policy if exists "boards insert by members or share editors" on boards;
create policy "boards insert by members or share editors" on boards for insert
  with check (
    is_workspace_member(workspace_id)
    or (
      parent_board_id is not null
      and can_write_board(parent_board_id)
    )
  );
