-- Restore get_or_create_personal_workspace's original return type
-- (workspaces) so cached/old clients continue working, AND keep the
-- root-board ensure logic so orphan workspaces are healed on the
-- next call.
--
-- Also backfill: any workspace that currently has membership but no
-- boards (orphaned by the racy old createWorkspace + createBoard
-- flow) gets a Studio root + empty board_state row inserted now.

drop function if exists get_or_create_personal_workspace(uuid, text);

create or replace function get_or_create_personal_workspace(p_user_id uuid, p_name text default 'Soleil')
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

  return v_ws;
end;
$$;

grant execute on function get_or_create_personal_workspace(uuid, text) to authenticated;

-- One-time backfill of orphan workspaces.
insert into boards (workspace_id, parent_board_id, name, view, created_by)
select w.id, null, 'Studio', 'canvas', w.created_by
from workspaces w
where not exists (select 1 from boards b where b.workspace_id = w.id);

insert into board_state (board_id, doc)
select b.id, ''
from boards b
where parent_board_id is null
  and not exists (select 1 from board_state bs where bs.board_id = b.id)
on conflict (board_id) do nothing;
