-- 0118 — Reparenting boards: the authoritative, validated, atomic write path
-- for "drop a board into another board" (nested-everywhere feature), plus a
-- defense-in-depth fix for the boards UPDATE policy.
--
-- Background:
--  * boards.parent_board_id is the source of truth for the sidebar/list tree.
--  * Until now it was only ever set at board creation; there was no safe way
--    to reparent an existing board.
--  * The boards UPDATE policy had USING(can_write_workspace(workspace_id)) and
--    NO explicit WITH CHECK, so Postgres reused USING as the check. That let a
--    member of workspace A point a board's parent_board_id at a board in
--    workspace B via raw PostgREST (cross-workspace escalation). We close that.

-- 1) Tighten the UPDATE policy: a board's parent must live in the SAME
--    workspace as the board. Preserves every currently-allowed update
--    (can_write_workspace), only blocks cross-workspace reparents. We do NOT
--    require can_write_board(parent) here: a demo/free editor who passes
--    can_write_workspace but isn't the workspace creator has
--    can_write_board=false, and adding that clause would break their normal
--    renames. The RPC below enforces can_write_board(target) for the feature.
drop policy if exists "boards update by members" on public.boards;
create policy "boards update by members" on public.boards
  for update to authenticated
  using (can_write_workspace(workspace_id))
  with check (
    can_write_workspace(workspace_id)
    and (
      parent_board_id is null
      or exists (
        select 1 from public.boards b2
        where b2.id = boards.parent_board_id
          and b2.workspace_id = boards.workspace_id
      )
    )
  );

-- 2) The single authoritative reparent path. SECURITY DEFINER so it can run a
--    validated atomic batch; it re-checks everything against committed state:
--    target exists/not-deleted + can_write_board(target); per child:
--    exists/not-deleted, can_write_board(child), same workspace as target,
--    not the target itself, not already a child of target, and NO CYCLE
--    (target must not be the child nor a descendant of the child). Offenders
--    are skipped with a reason rather than failing the batch; only target-level
--    problems (missing / no write) raise and abort. Returns
--    { moved: uuid[], skipped: [{id, reason}] }.
create or replace function public.move_boards_under(
  p_child_ids uuid[],
  p_target_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_target boards%rowtype;
  v_child  boards%rowtype;
  v_id     uuid;
  v_moved  uuid[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  v_seen   uuid[] := '{}';
  v_nil    uuid := '00000000-0000-0000-0000-000000000000';
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  -- Target (null = move to workspace root). Hard-fail if unwritable/missing.
  if p_target_id is not null then
    select * into v_target from boards where id = p_target_id;
    if not found or v_target.deleted_at is not null then
      raise exception 'target board not found';
    end if;
    if not can_write_board(p_target_id) then
      raise exception 'no write access to target board' using errcode = '42501';
    end if;
  end if;

  foreach v_id in array coalesce(p_child_ids, '{}'::uuid[])
  loop
    if v_id = any(v_seen) then continue; end if;          -- de-dupe
    v_seen := array_append(v_seen, v_id);

    select * into v_child from boards where id = v_id;
    if not found or v_child.deleted_at is not null then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'missing'); continue;
    end if;
    if p_target_id is not null and v_id = p_target_id then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'self'); continue;
    end if;
    if not can_write_board(v_id) then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'no-write'); continue;
    end if;
    if p_target_id is not null and v_target.workspace_id <> v_child.workspace_id then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'cross-workspace'); continue;
    end if;
    if coalesce(v_child.parent_board_id, v_nil) = coalesce(p_target_id, v_nil) then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'same-parent'); continue;
    end if;
    -- Cycle guard: walk UP from the target; if we reach the child, the target
    -- is the child or a descendant of it → would create a loop.
    if p_target_id is not null then
      if exists (
        with recursive up as (
          select p_target_id as id, 0 as depth
          union all
          select b.parent_board_id, up.depth + 1
          from boards b join up on b.id = up.id
          where b.parent_board_id is not null and up.depth < 1000
        )
        select 1 from up where id = v_id
      ) then
        v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'cycle'); continue;
      end if;
    end if;

    update boards set parent_board_id = p_target_id, updated_at = now() where id = v_id;
    v_moved := array_append(v_moved, v_id);
  end loop;

  return jsonb_build_object('moved', to_jsonb(v_moved), 'skipped', v_skipped);
end;
$fn$;

revoke all on function public.move_boards_under(uuid[], uuid) from public;
grant execute on function public.move_boards_under(uuid[], uuid) to authenticated;
