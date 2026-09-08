-- 0303_personal_workspace_authz.sql
--
-- get_or_create_personal_workspace() takes a user id as a PARAMETER, is
-- SECURITY DEFINER, and `authenticated` holds EXECUTE on it -- but the body
-- never asserted that the caller is the user being acted on. So any signed-in
-- user could pass someone else's uuid and:
--
--   * get that user's workspace row back (id, name, created_by), and
--   * if that workspace had no live root board, have a 'Studio' board and a
--     board_state row CREATED inside a workspace they are not a member of.
--
-- That second half is a cross-tenant write. It is reachable because the 0275
-- root-heal path deliberately creates a root when one is missing -- exactly the
-- state an attacker can also detect by watching whether a board appears.
--
-- The parameter itself has to stay: the Scout identity path
-- (boards/src/lib/scoutIdentity.js) bootstraps a workspace for a shell user it
-- is provisioning, and legitimately passes an id that is not the caller's. It
-- reaches this function as service_role, where auth.uid() is NULL.
--
-- So the guard is "if there is a JWT, it must be this user's":
--   auth.uid() IS NULL            -> service_role / trusted server path, allow
--   auth.uid() = p_user_id        -> the normal self-bootstrap, allow
--   otherwise                     -> 42501
--
-- Verified callers, all already compatible:
--   boards/src/lib/boardsApi.js:44        p_user_id = session user
--   boards/src/worker-api.js:1872, :2022  p_user_id = auth.userId (userRpc)
--   boards/src/lib/scoutIdentity.js:93    service_role (scoutRpc)
-- No SQL function in the database calls it internally.
--
-- Body below is 0275's verbatim, plus the guard. The `deleted_at is null`
-- comment from 0275 is preserved because it documents a real prior incident.

create or replace function public.get_or_create_personal_workspace(
  p_user_id uuid,
  p_name text default 'Soleil'::text
)
returns workspaces
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lock_key bigint := hashtextextended('ws_bootstrap:' || p_user_id::text, 0);
  v_ws       workspaces%rowtype;
  v_root_id  uuid;
begin
  -- 0303: a JWT-bearing caller may only bootstrap its OWN workspace.
  -- auth.uid() is null under service_role, which is how the Scout shell-user
  -- provisioning path legitimately passes another user's id.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'not authorized to bootstrap a workspace for another user'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(v_lock_key);
  select w.* into v_ws from workspaces w
  join workspace_members m on m.workspace_id = w.id
  where m.user_id = p_user_id order by w.created_at asc limit 1;
  if not found then
    insert into workspaces (name, created_by) values (p_name, p_user_id) returning * into v_ws;
    insert into workspace_members (workspace_id, user_id, role) values (v_ws.id, p_user_id, 'owner');
  end if;
  -- 0275: `deleted_at is null` was missing here. Without it this found the
  -- tombstone of a deleted root and skipped the heal, which is the exact
  -- reason the heal never fired for the accounts it was written to rescue.
  select id into v_root_id from boards
  where workspace_id = v_ws.id and parent_board_id is null and deleted_at is null
  order by created_at asc limit 1;
  if v_root_id is null then
    insert into boards (workspace_id, parent_board_id, name, view, created_by)
      values (v_ws.id, null, 'Studio', 'canvas', p_user_id) returning id into v_root_id;
    insert into board_state (board_id, doc) values (v_root_id, '') on conflict (board_id) do nothing;
  end if;
  return v_ws;
end;
$function$;
