-- 0294 — the boards SELECT policy ran a recursive CTE once per row, and seven
-- other tables' policies inherited it.
--
-- `boards read` was `can_read_board(id)`. Because the argument is the row's own
-- id, it can never be hoisted: Postgres evaluates it as a per-row Filter, and
-- each evaluation runs a WITH RECURSIVE walk up the parent chain, re-checking
-- workspace_members and board_shares at every level. That is the engine behind
-- board_shares' 5.6M sequential scans on a 12-row table.
--
-- It also nests. Every policy shaped `exists (select 1 from boards b where
-- b.id = <table>.board_id ...)` — board_ops, board_versions, board_state,
-- board_state_version, board_snapshots, board_tx, board_op_batches,
-- board_restore_events — pays a full recursive CTE it never asked for.
--
-- Replaced with the 0272 pattern: a scalar subselect the planner evaluates ONCE
-- as an InitPlan.
--
-- Measured on production, listing a real user's boards (50 of 712):
--   before: 5,638 buffers, 137.1 ms   (Filter: can_read_board(id), 658 rows)
--   after:    453 buffers,   4.8 ms   (InitPlan evaluated once)
--
-- EQUIVALENCE. can_read_board walks UP from the row; my_readable_board_ids
-- walks DOWN from roots. Those are the same relation read in opposite
-- directions — both answer "does X have an ancestor (or is X itself) that is
-- directly readable" — but that is an argument, so it was also tested:
--
--   • 36,312 (user, board) pairs across every workspace member and every
--     board_share holder on production: 0 mismatches.
--   • A synthetic adversarial tree, since production data is thin on shares:
--     a board shared DIRECTLY to a non-member whose parent is unreadable.
--     shared child -> both true; its unreadable parent -> both false; the root
--     above that -> both false; a descendant of the shared child -> both true;
--     an unshared sibling -> both false.
--
-- Neither function filters deleted_at, so that behaviour is unchanged too.
--
-- After applying: all 328 workspace members still resolve a live root cluster,
-- which is the invariant that turns into a permanent loading spinner when it
-- breaks.
--
-- Only SELECT changes. The INSERT/UPDATE/DELETE policies still use
-- can_write_workspace / can_write_board and are untouched.

drop policy "boards read" on public.boards;

create policy "boards read" on public.boards
  for select
  using ( array[id] && (select public.my_readable_board_ids()) );
