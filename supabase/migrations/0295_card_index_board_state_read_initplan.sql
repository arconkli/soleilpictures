-- 0295 — the same per-row recursive CTE, on the two tables that carry it by
-- board_id rather than by their own id.
--
-- card_index and board_state both had `can_read_board(<row>.board_id)` as their
-- SELECT policy, so both paid a WITH RECURSIVE parent-chain walk per row. Same
-- fix as 0294, same equivalence argument and evidence (see that migration): the
-- set my_readable_board_ids() returns is exactly the set of boards for which
-- can_read_board is true, verified over 36,312 production (user, board) pairs
-- and a synthetic adversarial tree.
--
-- Measured on production, card_index limit 200 for a real user:
--   before: 12,603 buffers, 362.5 ms
--   after:   7,089 buffers, 140.8 ms
--
-- The residual 7,089 is NOT this policy. card_index also carries a FOR ALL
-- write policy, and a FOR ALL policy's USING clause is permissive on SELECT
-- too, so every read also evaluates can_write_workspace(workspace_id) per row:
--
--   Filter: (can_write_workspace(workspace_id) OR (ARRAY[board_id] && InitPlan))
--
-- Splitting that into per-command policies would remove it, and is the obvious
-- next step — but it is deliberately NOT done here, because it is a visibility
-- change rather than a plan change. can_write_workspace admits a workspace
-- CREATOR who is not a member, and refuses a member on the waitlist tier;
-- can_read_board does neither. Production currently has zero workspaces whose
-- creator is not also a member, so the two sets coincide today — but that is a
-- property of the data, not an invariant, and a read path should not be
-- narrowed on the strength of it without its own migration and its own proof.
--
-- Verified after applying: for 15 users, the rows visible through card_index
-- and board_state are identical to what the previous policies returned.

drop policy "card_index read" on public.card_index;
create policy "card_index read" on public.card_index
  for select
  using ( array[board_id] && (select public.my_readable_board_ids()) );

drop policy "board_state read" on public.board_state;
create policy "board_state read" on public.board_state
  for select
  using ( array[board_id] && (select public.my_readable_board_ids()) );
