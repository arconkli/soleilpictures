-- Two fixes in this migration:
--  1. An atomic get-or-create RPC for a user's personal workspace, so the
--     React effect that fires twice on mount can't create duplicate
--     "Soleil" workspaces (we have several of these in prod).
--  2. A delete-workspace RPC that callers can use without worrying about
--     cascading order. Cascades are already declared on FKs.

-- ── get_or_create_personal_workspace ────────────────────────────────────
-- Serializes per-user with a transaction-scoped advisory lock keyed by
-- the user id. Returns the user's oldest existing workspace if one
-- exists, otherwise creates {workspace + member + Studio root board} and
-- returns the new workspace.
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

  -- Existing membership? Prefer the oldest workspace they're in (matches
  -- the previous getMyFirstWorkspace() ordering so users keep their
  -- existing primary).
  select w.* into v_ws
  from workspaces w
  join workspace_members m on m.workspace_id = w.id
  where m.user_id = p_user_id
  order by w.created_at asc
  limit 1;

  if found then
    return v_ws;
  end if;

  -- Otherwise create workspace + membership + Studio root board.
  insert into workspaces (name) values (p_name) returning * into v_ws;
  insert into workspace_members (workspace_id, user_id, role)
    values (v_ws.id, p_user_id, 'editor');
  insert into boards (workspace_id, parent_board_id, name, view, created_by)
    values (v_ws.id, null, 'Studio', 'canvas', p_user_id)
    returning id into v_root_id;

  return v_ws;
end;
$$;

revoke all on function get_or_create_personal_workspace(uuid, text) from public;
grant execute on function get_or_create_personal_workspace(uuid, text) to authenticated;

-- ── delete_workspace ─────────────────────────────────────────────────────
-- Caller must be a member of the workspace. Cascades remove boards,
-- board_state, members, messages, message_reads, card_index, images,
-- workspace_invites (all via on-delete-cascade FKs).
create or replace function delete_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid()
  ) then
    raise exception 'not a member of workspace %', p_workspace_id
      using errcode = '42501';
  end if;

  delete from workspaces where id = p_workspace_id;
end;
$$;

revoke all on function delete_workspace(uuid) from public;
grant execute on function delete_workspace(uuid) to authenticated;
