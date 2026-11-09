-- 0872_rename_board.sql
--
-- Someone invited to edit a shared cluster may rename it; the owner decided
-- so. They could not: renameBoard (lib/boardsApi.js) PATCHes boards directly,
-- and "boards update by members" asks can_write_workspace(), which is
-- membership only, so the rename was refused with 42501 (seen in production
-- error reports) and the history row logMetaChanges had already written
-- described a change that never happened.
--
-- rename_board(p_board_id, p_name) renames a cluster for anyone
-- can_write_board() admits (members who can write, the workspace's creator,
-- and editor shares on the cluster or an ancestor), and nothing else of the
-- row can be changed through it, so the boards UPDATE policy stays as it is.
--
--   * signed in, or 42501;
--   * the cluster exists and is not in the Trash, or P0002 'cluster not found';
--   * can_write_board(p_board_id), or 42501 'not allowed to rename this cluster';
--   * the name is trimmed; an empty one is 22023. boards.name carries no other
--     rule (NOT NULL, no check constraint, no length limit, no trigger that
--     refuses), so none is added here;
--   * an unchanged name returns without writing anything;
--   * otherwise name and updated_at change, and the board_meta_history row
--     logMetaChanges writes for a rename (field 'name', {"v": old} ->
--     {"v": new}, changed_by the caller) is written here in the same
--     transaction, so the app can stop writing it for renames.
--
-- SECURITY DEFINER leaves auth.uid() as the caller, so the AFTER UPDATE
-- triggers on boards (autotag_boards_rename, boards_webhook_upd) see the same
-- row they would for a member's PATCH. Execute: authenticated and
-- service_role only.
--
-- Checked on production in a transaction that was rolled back: a member who
-- can write and an invited editor renamed a shared cluster, each with one
-- history row naming them; a view-only person and a stranger got 42501; an
-- unchanged name wrote nothing; blank names got 22023; a cluster in the Trash
-- and an unknown id got P0002; no session got 42501.

begin;

create or replace function public.rename_board(p_board_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(p_name);
  v_old  text;
  v_ws   uuid;
begin
  if v_uid is null then
    raise exception 'sign in to rename a cluster' using errcode = '42501';
  end if;

  if not exists (select 1 from public.boards
                  where id = p_board_id and deleted_at is null) then
    raise exception 'cluster not found' using errcode = 'P0002';
  end if;

  if not public.can_write_board(p_board_id) then
    raise exception 'not allowed to rename this cluster' using errcode = '42501';
  end if;

  if v_name is null or v_name = '' then
    raise exception 'a cluster needs a name' using errcode = '22023';
  end if;

  select name, workspace_id into v_old, v_ws
    from public.boards
   where id = p_board_id and deleted_at is null
   for update;
  if not found then
    raise exception 'cluster not found' using errcode = 'P0002';
  end if;

  if v_old is not distinct from v_name then
    return;
  end if;

  update public.boards
     set name = v_name, updated_at = now()
   where id = p_board_id;

  insert into public.board_meta_history
    (board_id, workspace_id, field, before_value, after_value, changed_by)
  values
    (p_board_id, v_ws, 'name',
     case when v_old is null then null else jsonb_build_object('v', v_old) end,
     jsonb_build_object('v', v_name),
     v_uid);
end;
$$;

revoke execute on function public.rename_board(uuid, text) from public, anon;
grant execute on function public.rename_board(uuid, text) to authenticated, service_role;

-- Proofs. A REVOKE reporting success proves nothing, so check the state.
do $$
begin
  if has_function_privilege('anon', 'public.rename_board(uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.rename_board(uuid, text)', 'execute')
     or not has_function_privilege('service_role', 'public.rename_board(uuid, text)', 'execute') then
    raise exception '0872: rename_board grants are wrong';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.rename_board(uuid, text)'::regprocedure) then
    raise exception '0872: rename_board is not SECURITY DEFINER';
  end if;
end $$;

commit;
