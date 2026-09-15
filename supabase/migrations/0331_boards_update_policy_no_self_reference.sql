-- 0331_boards_update_policy_no_self_reference.sql
--
-- Every client-side UPDATE on public.boards has been failing with
--   42P17 infinite recursion detected in policy for relation "boards"
-- — renames, background colour, cover, thumbnails, day types — surfacing as a
-- PostgREST 500 on PATCH /rest/v1/boards.
--
-- Cause: "boards update by members" (0118) checks the parent in its WITH CHECK
-- with a subquery over public.boards itself. Postgres expands the RLS policies
-- of that inner boards reference while boards is already being expanded, and
-- raises 42P17 whenever the inner policies contain a sublink. They did not
-- until the boards SELECT policy was rewritten to the InitPlan form
-- `ARRAY[id] && (SELECT my_readable_board_ids())` (boards_read_policy_initplan,
-- 2026-09-05): from then on every UPDATE by an RLS-subject role hit the check.
--
-- Fix: the same rule, with the parent test moved into the existing
-- SECURITY DEFINER helper _board_in_workspace(board, workspace) (0313), which
-- reads boards as its owner and so introduces no policy expansion. The helper
-- is executable by authenticated (the only role this policy applies to) and
-- not by anon. The rule is unchanged: the writer must be able to write the
-- workspace, and a non-null parent must be a board in the same workspace.
-- It no longer additionally requires the parent to be visible through the
-- caller's read set, which could only differ for a workspace creator with no
-- membership row — who can write the workspace and so should pass.

drop policy if exists "boards update by members" on public.boards;
create policy "boards update by members"
  on public.boards for update to authenticated
  using (public.can_write_workspace(workspace_id))
  with check (
    public.can_write_workspace(workspace_id)
    and (
      parent_board_id is null
      or public._board_in_workspace(parent_board_id, workspace_id)
    )
  );

-- ── Post-conditions ─────────────────────────────────────────────────────────
do $$
declare v_check text;
begin
  select with_check into v_check from pg_policies
   where schemaname = 'public' and tablename = 'boards' and policyname = 'boards update by members';
  if v_check is null then
    raise exception '0331: boards update policy missing';
  end if;
  if v_check ilike '%from boards%' or v_check ilike '%from public.boards%' then
    raise exception '0331: boards update policy still queries boards directly';
  end if;
  if v_check not ilike '%_board_in_workspace%' then
    raise exception '0331: boards update policy does not use _board_in_workspace';
  end if;
  if not has_function_privilege('authenticated', 'public._board_in_workspace(uuid, uuid)', 'execute') then
    raise exception '0331: authenticated cannot execute _board_in_workspace; every board update would fail';
  end if;
end $$;
