-- 0241_shared_board_descendants.sql — being shared a production must also share
-- the days inside it.
--
-- THE BUG. list_shared_boards() (0013) returns only rows that are literally in
-- board_shares:
--
--     from board_shares s join boards b on b.id = s.board_id
--     where s.user_id = auth.uid() and not is_workspace_member(b.workspace_id)
--
-- No descendant walk. RLS has never been the problem — can_read_board() walks
-- the parent chain, so a crew member shared into a production is *permitted* to
-- read every cluster inside it. Nothing ever fetched them. App.jsx says so out
-- loud: "their descendants (visible via boards map traversal) inherit but we
-- don't know them all here."
--
-- Until now that only meant a nested cluster's card rendered as an orphan and
-- got hidden. With the schedule work it means something much worse: a shoot-day
-- cluster is a CHILD of the production, so a crew member opening the shared
-- production sees a calendar with nothing on it. The owner sees twelve weeks of
-- work; the crew sees an empty grid. A film crew is share-based by definition,
-- so this is the load-bearing fix, not a nicety.
--
-- Return type gains columns, so this is a drop-and-create rather than a
-- replace. Atomic inside the migration.

drop function if exists public.list_shared_boards();

create or replace function public.list_shared_boards()
returns table (
  board_id              uuid,
  board_name            text,
  role                  text,
  source_workspace_id   uuid,
  source_workspace_name text,
  parent_board_id       uuid,
  board_view            text,
  board_cover           text,
  created_at            timestamptz,
  -- New: the calendar needs these on the CHILD clusters, and the normalizer in
  -- App.jsx drops anything this projection doesn't name.
  scheduled_date        date,
  scheduled_end         date,
  day_label             text,
  sched_status          text,
  sched_version         int,
  sched_published_at    timestamptz,
  updated_at            timestamptz,
  -- Lets the sidebar keep listing the shared ROOTS while the calendar draws the
  -- descendants, instead of dumping sixty shoot days into the shared tree.
  is_shared_root        boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with recursive roots as (
    select b.id, s.role, s.created_at
    from board_shares s
    join boards b on b.id = s.board_id
    where s.user_id = auth.uid()
      -- Pre-existing gap, fixed here rather than shipped onto the calendar: the
      -- original never filtered soft-deletes, so a deleted board stayed in the
      -- shared list. Deleted shoot days must not appear on a schedule.
      and b.deleted_at is null
      -- Unchanged: boards in your OWN workspace arrive via listBoards().
      -- Descendants live in the same workspace as their root (move_boards_under
      -- enforces it), so testing the root is sufficient.
      and not is_workspace_member(b.workspace_id)
  ),
  tree as (
    select r.id, r.role, r.created_at as share_created_at, true as is_root, 0 as depth
    from roots r
    union all
    select c.id, t.role, t.share_created_at, false, t.depth + 1
    from boards c
    join tree t on c.parent_board_id = t.id
    -- move_boards_under has a cycle guard, so a loop should be impossible; the
    -- depth bound is here because "should be impossible" and "hangs the shared
    -- board list forever" are a bad pair.
    where c.deleted_at is null and t.depth < 20
  ),
  dedup as (
    -- A user can hold a direct share on a board AND reach it as a descendant of
    -- another share. Collapse to one row, keeping the strongest role.
    select distinct on (t.id) t.id, t.role, t.share_created_at, t.is_root
    from tree t
    order by t.id, (t.role = 'editor') desc, t.is_root desc, t.depth asc
  )
  select b.id, b.name, d.role,
         w.id, w.name, b.parent_board_id,
         coalesce(b.view, 'canvas')::text,
         coalesce(b.cover, 'neutral')::text,
         d.share_created_at,
         b.scheduled_date, b.scheduled_end, b.day_label,
         b.sched_status, b.sched_version, b.sched_published_at,
         b.updated_at, d.is_root
  from dedup d
  join boards b     on b.id = d.id
  join workspaces w on w.id = b.workspace_id
  order by w.name asc, b.name asc;
$$;

revoke all on function public.list_shared_boards() from public, anon;
grant execute on function public.list_shared_boards() to authenticated;

comment on function public.list_shared_boards() is
  'Boards shared with the caller from other workspaces, PLUS every descendant of those boards (RLS already permitted the read; nothing fetched them). is_shared_root distinguishes the boards actually in board_shares from inherited descendants.';
