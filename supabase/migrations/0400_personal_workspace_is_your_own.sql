-- 0400 — Your personal workspace is one you own (audit DB-03).
--
-- get_or_create_personal_workspace returned the oldest workspace the user was
-- a MEMBER of. Someone who signs up from a workspace invite has the invite
-- claimed inside the signup trigger (_claim_pending_invites_for_user), so by
-- their first boot that membership already exists: the bootstrap found the
-- INVITER's workspace, never created one, and the app labelled the inviter's
-- workspace "Personal". Everything the invitee made landed in, and counted
-- against, someone else's workspace; "Copy to my workspace" refused because
-- the cluster was "already in your workspace". Handing your oldest workspace
-- to someone else produced the same state.
--
-- Now "personal" is the oldest workspace the user OWNS, created when there is
-- none. Nothing is moved: an existing invitee keeps every membership and all
-- their content where it is, and simply gets a workspace of their own on their
-- next boot. The client opens a brand-new invitee in the workspace they were
-- invited to (lib/startWorkspace.js), so nobody lands on an empty canvas
-- instead of the work they came for.
--
-- Same signature, so create or replace keeps the ACL; the block proves it.
--
-- APPLY AT SHIP TIME, not before: production runs the old client, which opens
-- the "personal" workspace first. Until the client with lib/startWorkspace.js is
-- in production, applying this would open brand-new invitees on an empty
-- workspace of their own. Dry-run verified 2026-10-11 (rolled back).

begin;

create or replace function public.get_or_create_personal_workspace(p_user_id uuid, p_name text default 'Soleil')
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
  -- 0400: a workspace you own, never one you were invited into.
  select w.* into v_ws from workspaces w
   where w.created_by = p_user_id
   order by w.created_at asc limit 1;
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

do $$
begin
  if has_function_privilege('anon', 'public.get_or_create_personal_workspace(uuid,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_or_create_personal_workspace(uuid,text)', 'execute') then
    raise exception '0400: grants are wrong';
  end if;
end $$;

commit;
