-- 0272 — make the `images` read policy cost O(1) function calls, not O(rows).
--
-- The policy called can_read_board() — a recursive CTE walking the board parent
-- chain — once PER ROW, plus once per element of referenced_in_board_ids:
--
--   is_workspace_member(workspace_id)
--   OR (board_id IS NOT NULL AND can_read_board(board_id))
--   OR EXISTS (SELECT 1 FROM unnest(images.referenced_in_board_ids) b(bid)
--              WHERE can_read_board(b.bid))
--
-- Opening a board runs
--   ...WHERE board_id = $1 OR referenced_in_board_ids @> $2
-- and RLS quals are evaluated BEFORE the user's predicate (the helpers are not
-- leakproof, so the planner is not allowed to reorder them — raising procost
-- does nothing; I measured it). So every board open paid the policy for every
-- row in the table, including other people's:
--
--   Seq Scan on images  (actual time=42.979..2678.051 rows=1951)
--     Rows Removed by Filter: 7059
--     Buffers: shared hit=120646
--     SubPlan 1 -> Function Scan on unnest b  (loops=7058)
--   Execution Time: 2680.197 ms
--
-- In production that query averaged 3,779 ms and peaked at 7,946 ms against the
-- 8s `authenticated` statement_timeout — i.e. it was already failing outright
-- for some users, and the cost grew with TOTAL table size rather than with the
-- user's own data.
--
-- Fix: compute the two id sets ONCE per query. An uncorrelated `(select f())`
-- becomes an InitPlan, so the per-row work drops to array membership, which the
-- existing images_boards_gin index can also serve.
--
--   Seq Scan on images  (actual time=32.726..52.215 rows=1951)
--     Buffers: shared hit=4229
--   Execution Time: 52.632 ms
--
-- EQUIVALENCE (this is a security boundary, so it was proven, not assumed):
--   * readable-board sets compared for ALL 276 users with any grant, across all
--     612 boards → 276/276 identical, 0 mismatches, 750 readable boards each way.
--   * the full policy predicate compared row-by-row over all 9,010 images for a
--     workspace owner, a second owner, a share-only collaborator, a user with no
--     grants, and anon (NULL uid) → 0 mismatches (1952/1004/2706/0/0 visible).

-- All boards whose workspace the caller belongs to, or that are shared to them,
-- plus every descendant of those. Equivalent to can_read_board() by construction:
-- can_read_board walks UP and asks "is any ancestor member-or-shared", which is
-- the same relation as "is this board in the downward closure of the
-- member-or-shared set".
--
-- `union` rather than `union all` so a parent_board_id cycle terminates instead
-- of spinning — can_read_board's `union all` would not.
create or replace function public.my_readable_board_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  with recursive roots as (
    select b.id, b.parent_board_id
    from boards b
    where b.workspace_id in (
            select wm.workspace_id from workspace_members wm where wm.user_id = auth.uid()
          )
       or exists (
            select 1 from board_shares s where s.board_id = b.id and s.user_id = auth.uid()
          )
    union
    select c.id, c.parent_board_id
    from boards c join roots r on c.parent_board_id = r.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) from roots;
$$;

comment on function public.my_readable_board_ids() is
  'Every board the caller can read, as one array. Call it as (select my_readable_board_ids()) inside an RLS policy so the planner makes it an InitPlan — evaluated once per query rather than once per row. Set-equivalent to can_read_board() per board.';

-- The caller's workspaces. Inlines is_workspace_member so the membership test
-- also becomes array membership against a once-computed set.
create or replace function public.my_workspace_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(wm.workspace_id), '{}'::uuid[])
  from workspace_members wm
  where wm.user_id = auth.uid();
$$;

comment on function public.my_workspace_ids() is
  'Every workspace the caller belongs to, as one array. Same InitPlan trick as my_readable_board_ids().';

-- Match can_read_board's grants exactly. `revoke from public` does NOT cover
-- anon or authenticated, so they are granted explicitly — and they must be:
-- the images read policy applies to role `public`, so an anon request evaluates
-- these functions too (and gets '{}' back, since auth.uid() is null).
revoke all on function public.my_readable_board_ids() from public;
revoke all on function public.my_workspace_ids()      from public;
grant execute on function public.my_readable_board_ids() to anon, authenticated, service_role;
grant execute on function public.my_workspace_ids()      to anon, authenticated, service_role;

-- The rewrite. array[x] && arr rather than x = any(arr) because `= any (select …)`
-- parses as a subquery comparison, not an array one. NULL behaviour is preserved:
-- array[NULL] && arr is false, matching is_workspace_member(NULL) = false and the
-- old explicit `board_id IS NOT NULL` guard; NULL && arr is NULL, which fails a
-- policy exactly as the old EXISTS-over-empty-unnest returned false.
drop policy if exists "images read" on public.images;
create policy "images read" on public.images
for select
using (
  array[workspace_id] && (select public.my_workspace_ids())
  or array[board_id] && (select public.my_readable_board_ids())
  or referenced_in_board_ids && (select public.my_readable_board_ids())
);
