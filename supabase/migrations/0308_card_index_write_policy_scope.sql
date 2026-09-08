-- 0308_card_index_write_policy_scope.sql
--
-- Finishes the item 0295 wrote down and deliberately deferred.
--
-- card_index carries two permissive policies:
--
--   "card_index read"   FOR SELECT  using (ARRAY[board_id] && (select my_readable_board_ids()))
--   "card_index write"  FOR ALL     using (can_write_workspace(workspace_id))
--
-- 0294/0295 rewrote the read one into the InitPlan form, so the set is computed
-- once per statement instead of once per row (measured there: 12,603 buffers /
-- 362.5 ms -> 7,089 buffers / 140.8 ms on `card_index limit 200`).
--
-- But FOR ALL means that policy's USING clause also applies to SELECT, and
-- permissive policies are ORed — so every read still evaluated
-- can_write_workspace(workspace_id) per row on top of the optimised one.
-- can_write_workspace is not cheap: it reads profiles for the tier, then
-- is_workspace_member, then a workspaces lookup. 0295's header says this out
-- loud and leaves it for later. This is later.
--
-- The fix is scope, not rewriting: restrict the write policy to the commands it
-- is actually for. Reads then consult only the read policy.
--
-- WHY THIS DOES NOT CHANGE WHO CAN SEE WHAT
-- The two predicates are not identical, so this needed checking rather than
-- assuming. can_write_workspace(ws) is true when the caller is a member OR is
-- workspaces.created_by; my_readable_board_ids() is built from
-- workspace_members plus board_shares plus descendants. So the only row that
-- could lose SELECT is one in a workspace whose CREATOR IS NOT A MEMBER of it.
--
-- Checked both ways before applying:
--   * in the data: workspaces with a non-member creator = 0, and card_index
--     rows belonging to such a workspace = 0.
--   * by construction: both functions that ever insert into workspaces --
--     get_or_create_personal_workspace and create_workspace_with_root --
--     insert the workspace_members row in the same statement block. A creator
--     without membership is not a state either path can produce.
--
-- The waitlist case goes the other way and is also fine: a waitlist-tier member
-- gets false from can_write_workspace but is still in my_readable_board_ids, so
-- they could already read and still can. This only ever removes a redundant
-- second grant, never the only one.
--
-- USING and WITH CHECK are carried over verbatim so write authorization is
-- byte-for-byte what it was.
--
-- MEASURED, as the signed-in user, `card_index where workspace_id = ? limit 200`
--
--   before  Filter: (can_write_workspace(workspace_id) OR (ARRAY[board_id] && (InitPlan 1).col1))
--           InitPlan 1 -> Result (never executed)
--           Buffers: shared hit=1665      Execution Time: 59.199 ms
--
--   after   Filter: (ARRAY[board_id] && (InitPlan 1).col1)
--           InitPlan 1 -> Result (actual rows=1 loops=1)
--           Buffers: shared hit=723       Execution Time: 8.510 ms
--
-- Note the "never executed" in the before plan. Postgres evaluates the OR left
-- to right and can_write_workspace came first, so the InitPlan 0295 built was
-- short-circuited past on every row and never ran once. The optimisation was
-- present and inert. That is why this policy's scope mattered more than its
-- expression, and it is worth remembering the next time an InitPlan rewrite
-- appears not to have helped: check whether something cheaper-looking is being
-- evaluated ahead of it.
--
-- Same 200 rows out. Sampled eight real members across different workspaces
-- afterwards; every one still sees a non-empty card_index.

drop policy if exists "card_index write" on public.card_index;

create policy "card_index insert" on public.card_index
  for insert with check (can_write_workspace(workspace_id));

create policy "card_index update" on public.card_index
  for update using (can_write_workspace(workspace_id))
          with check (can_write_workspace(workspace_id));

create policy "card_index delete" on public.card_index
  for delete using (can_write_workspace(workspace_id));
