-- Fixes:
--   (1) Creating a workspace failed under RLS because the .insert(...)
--       .select('*').single() call relies on the RETURNING row passing the
--       SELECT policy — but the creator isn't a member of the new workspace
--       yet, so "ws read by members" filtered it out. Add an explicit
--       "creator can read their workspace" policy.
--   (2) boards.view CHECK constraint only allowed 'canvas' | 'list', but the
--       app now also writes 'doc' for legacy doc-boards. Drop and replace.

-- (1) Workspace creator read access -------------------------------------------
drop policy if exists "ws read by creator" on workspaces;
create policy "ws read by creator" on workspaces for select
  using (created_by = auth.uid());

-- Also let the workspace creator update name (already had this, but make
-- sure both creators and members can read for consistency).
-- Existing "ws read by members" stays in place.

-- (2) Allow 'doc' in boards.view ---------------------------------------------
alter table boards drop constraint if exists boards_view_check;
alter table boards add constraint boards_view_check
  check (view in ('canvas', 'list', 'doc'));
