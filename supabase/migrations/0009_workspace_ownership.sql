-- Tighten workspace lifecycle:
-- 1. get_or_create_personal_workspace now also sets created_by, so the
--    owner is well-defined for downstream policies.
-- 2. delete_workspace now requires ownership (was: any member).
-- 3. New leave_workspace lets non-owners drop their own membership.

create or replace function get_or_create_personal_workspace(
  p_user_id uuid,
  p_name    text default 'Soleil'
)
returns workspaces
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

  if found then
    return v_ws;
  end if;

  insert into workspaces (name, created_by) values (p_name, p_user_id) returning * into v_ws;
  insert into workspace_members (workspace_id, user_id, role)
    values (v_ws.id, p_user_id, 'owner');
  insert into boards (workspace_id, parent_board_id, name, view, created_by)
    values (v_ws.id, null, 'Studio', 'canvas', p_user_id)
    returning id into v_root_id;

  return v_ws;
end;
$$;

revoke all on function get_or_create_personal_workspace(uuid, text) from public;
grant execute on function get_or_create_personal_workspace(uuid, text) to authenticated;

create or replace function delete_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select created_by into v_owner from workspaces where id = p_workspace_id;

  if v_owner is null then
    raise exception 'workspace % not found', p_workspace_id using errcode = '42704';
  end if;

  if v_owner <> auth.uid() then
    raise exception 'only the workspace owner can delete it'
      using errcode = '42501';
  end if;

  delete from workspaces where id = p_workspace_id;
end;
$$;

revoke all on function delete_workspace(uuid) from public;
grant execute on function delete_workspace(uuid) to authenticated;

create or replace function leave_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select created_by into v_owner from workspaces where id = p_workspace_id;

  if v_owner = auth.uid() then
    raise exception 'workspace owner cannot leave — delete the workspace instead'
      using errcode = '42501';
  end if;

  delete from workspace_members
  where workspace_id = p_workspace_id and user_id = auth.uid();
end;
$$;

revoke all on function leave_workspace(uuid) from public;
grant execute on function leave_workspace(uuid) to authenticated;
