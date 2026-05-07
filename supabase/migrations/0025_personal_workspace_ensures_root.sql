-- Personal-workspace bootstrap RPC: also guarantee a root board.
--
-- The previous version returned the workspace row and ASSUMED
-- callers would handle the case where a workspace existed without
-- a root (orphaned by an earlier failed insert). Callers fell back
-- to a separate boards INSERT, which intermittently hit the same
-- RLS race the workspace-create flow had ("new row violates RLS
-- policy for table boards").
--
-- New shape: returns jsonb { workspace, root_board_id } and creates
-- whichever piece is missing inside the same security-definer
-- transaction so the policy check never sees a half-state.

drop function if exists get_or_create_personal_workspace(uuid, text);

create or replace function get_or_create_personal_workspace(p_user_id uuid, p_name text default 'Soleil')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key bigint := hashtextextended('ws_bootstrap:' || p_user_id::text, 0);
  v_ws       workspaces%rowtype;
  v_root_id  uuid;
begin
  perform pg_advisory_xact_lock(v_lock_key);

  select w.* into v_ws
  from workspaces w
  join workspace_members m on m.workspace_id = w.id
  where m.user_id = p_user_id
  order by w.created_at asc
  limit 1;

  if not found then
    insert into workspaces (name, created_by) values (p_name, p_user_id) returning * into v_ws;
    insert into workspace_members (workspace_id, user_id, role)
      values (v_ws.id, p_user_id, 'owner');
  end if;

  select id into v_root_id
  from boards
  where workspace_id = v_ws.id and parent_board_id is null
  order by created_at asc
  limit 1;

  if v_root_id is null then
    insert into boards (workspace_id, parent_board_id, name, view, created_by)
      values (v_ws.id, null, 'Studio', 'canvas', p_user_id)
      returning id into v_root_id;
    insert into board_state (board_id, doc) values (v_root_id, '')
      on conflict (board_id) do nothing;
  end if;

  return jsonb_build_object(
    'workspace', to_jsonb(v_ws),
    'root_board_id', v_root_id
  );
end;
$$;

grant execute on function get_or_create_personal_workspace(uuid, text) to authenticated;
