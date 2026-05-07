-- Atomic workspace creation: workspace + workspace_member + root
-- board + empty board_state in one transaction. Eliminates the RLS
-- race where a separate boards INSERT after the workspace_members
-- insert could fail because is_workspace_member hadn't refreshed.

create or replace function create_workspace_with_root(
  p_name text,
  p_root_name text default 'Studio'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  ws_id uuid;
  brd_id uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'must be authenticated';
  end if;

  insert into workspaces (name, created_by)
    values (coalesce(nullif(trim(p_name), ''), 'Workspace'), uid)
    returning id into ws_id;

  insert into workspace_members (workspace_id, user_id, role)
    values (ws_id, uid, 'owner');

  insert into boards (workspace_id, parent_board_id, name, view, created_by)
    values (ws_id, null, coalesce(nullif(trim(p_root_name), ''), 'Studio'), 'canvas', uid)
    returning id into brd_id;

  insert into board_state (board_id, doc)
    values (brd_id, '');

  return jsonb_build_object(
    'workspace_id', ws_id,
    'root_board_id', brd_id
  );
end $$;

grant execute on function create_workspace_with_root(text, text) to authenticated;
