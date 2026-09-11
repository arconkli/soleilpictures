-- supabase/tests/phase0_rls_probe.sql
-- Run inside `begin; … rollback;` via the Supabase MCP. Read-only in effect.
-- Expected BEFORE 0317–0320: the assertions marked (AFTER) fail — that is the
-- point; keep the output as the "before" record. Expected AFTER: all pass.
do $$
declare
  u_owner  uuid := gen_random_uuid();
  u_editor uuid := gen_random_uuid();
  u_viewer uuid := gen_random_uuid();
  u_banned uuid := gen_random_uuid();
  u_out    uuid := gen_random_uuid();
  ws       uuid;
  b        uuid;
  b_child  uuid;
  ok       boolean;
  ids      uuid[];
  r        record;
begin
  -- fixture users (token columns '' per the GoTrue gotcha)
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         x.email, '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
         '', '', '', '', '', '', '', ''
  from (values (u_owner, 'probe-owner@example.invalid'), (u_editor, 'probe-editor@example.invalid'),
               (u_viewer, 'probe-viewer@example.invalid'), (u_banned, 'probe-banned@example.invalid'),
               (u_out, 'probe-out@example.invalid')) as x(id, email);
  insert into public.profiles (user_id, tier) values (u_owner,'demo'),(u_editor,'demo'),(u_viewer,'demo'),(u_banned,'demo'),(u_out,'demo')
  on conflict (user_id) do nothing;
  update public.profiles set banned_at = now() where user_id = u_banned;

  insert into public.workspaces (name, created_by) values ('probe', u_owner) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values
    (ws, u_owner, 'owner'), (ws, u_editor, 'editor'), (ws, u_viewer, 'viewer'), (ws, u_banned, 'editor');
  insert into public.boards (workspace_id, name, view, created_by) values (ws, 'root', 'canvas', u_owner) returning id into b;
  insert into public.board_state (board_id, doc) values (b, '');
  insert into public.boards (workspace_id, parent_board_id, name, view, created_by) values (ws, b, 'child', 'canvas', u_owner) returning id into b_child;
  insert into public.board_shares (board_id, user_id, role, invited_by) values (b_child, u_viewer, 'editor', u_owner);

  -- ── as the viewer ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_viewer, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.can_read_board(b) into ok;      if not ok then raise exception 'viewer cannot read the board'; end if;
  select public.can_write_board(b) into ok;     if ok then raise exception '(AFTER) viewer can still write the root board'; end if;
  select public.can_write_workspace(ws) into ok; if ok then raise exception '(AFTER) viewer can still write the workspace'; end if;
  select public.can_write_board(b_child) into ok; if not ok then raise exception 'viewer with an editor share cannot write the shared child'; end if;
  select public.can_comment_board(b) into ok;   if not ok then raise exception '(AFTER) viewer cannot comment'; end if;
  select allow into ok from public.authorize_upload(ws, 10); if ok then raise exception '(AFTER) viewer can open a multipart upload'; end if;
  select public.my_readable_board_ids() into ids; if not (ids @> array[b, b_child]) then raise exception 'viewer read set wrong'; end if;
  perform set_config('role', 'postgres', true);

  -- ── as the editor ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_editor, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.can_write_board(b) into ok; if not ok then raise exception 'editor lost write'; end if;
  select public.can_write_workspace(ws) into ok; if not ok then raise exception 'editor lost workspace write'; end if;
  -- (AFTER) column grants: an editor cannot take the workspace
  begin
    update public.workspaces set created_by = u_editor where id = ws;
    raise exception '(AFTER) editor rewrote workspaces.created_by';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.workspaces set name = 'renamed' where id = ws;
  exception when insufficient_privilege then raise exception 'editor lost the rename grant';
  end;
  perform set_config('role', 'postgres', true);

  -- ── as the banned member ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_banned, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.can_read_board(b) into ok; if ok then raise exception '(AFTER) banned member can read'; end if;
  select public.my_readable_board_ids() into ids; if coalesce(array_length(ids, 1), 0) <> 0 then raise exception '(AFTER) banned member read set not empty'; end if;
  select public.my_workspace_ids() into ids; if coalesce(array_length(ids, 1), 0) <> 0 then raise exception '(AFTER) banned member workspace set not empty'; end if;
  select public.can_write_board(b) into ok; if ok then raise exception '(AFTER) banned member can write'; end if;
  perform set_config('role', 'postgres', true);

  -- ── as an outsider and as anon ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_out, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.can_read_board(b) into ok; if ok then raise exception 'outsider can read'; end if;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  select public.can_read_board(b) into ok; if ok then raise exception 'anon can read'; end if;
  select public.my_readable_board_ids() into ids; if coalesce(array_length(ids, 1), 0) <> 0 then raise exception 'anon read set not empty'; end if;
  perform set_config('role', 'postgres', true);

  -- ── owner-side RPCs and the cascade ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.set_workspace_member_role(ws, u_viewer, 'editor');                        -- (AFTER)
  select role into r from public.workspace_members where workspace_id = ws and user_id = u_viewer;
  if r.role <> 'editor' then raise exception '(AFTER) set_workspace_member_role did not apply'; end if;
  perform public.remove_workspace_member(ws, u_viewer);
  if exists (select 1 from public.board_shares where user_id = u_viewer and board_id = b_child) then
    raise exception '(AFTER) removal did not cascade to board_shares';
  end if;
  perform set_config('role', 'postgres', true);

  -- ── grants and helpers ──
  if has_function_privilege('anon', 'public._actor_active()', 'execute') then raise exception '(AFTER) _actor_active anon-callable'; end if;
  if not has_function_privilege('anon', 'public.can_read_board(uuid)', 'execute') then raise exception 'can_read_board lost anon'; end if;
  if has_table_privilege('authenticated', 'public.public_share_links', 'update') then raise exception '(AFTER) public_share_links writable'; end if;
  if has_column_privilege('authenticated', 'public.boards', 'workspace_id', 'update') then raise exception '(AFTER) boards.workspace_id writable'; end if;
  -- the realtime policies still exist and still name the predicates
  if (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages'
        and (qual ilike '%can_read_board%' or qual ilike '%can_write_board%' or qual ilike '%is_workspace_member%'
             or with_check ilike '%can_write_board%' or with_check ilike '%is_workspace_member%')) < 4 then
    raise exception 'realtime.messages policies moved';
  end if;

  raise notice 'phase0 probe: all assertions passed';
end $$;
