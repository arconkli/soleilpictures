-- 0393 — a workspace is made only by the functions that make it whole
-- (audit AC-1 and AC-18, following 0373, 0375 and 0391).
--
-- create_workspace_with_root refuses a suspended account (0373) and gives a
-- new account a handful of workspaces, not an endless supply (0375). Both
-- checks lived only in the function. The table itself still granted INSERT to
-- every signed-in user under "ws insert if creator matches", so a direct
-- POST to /rest/v1/workspaces made a workspace with neither check, and with
-- no root cluster, which every workspace must have. Nothing in the app, the
-- Worker, the MCP server or the edge functions inserts into the table:
-- every workspace comes from create_workspace_with_root or
-- get_or_create_personal_workspace, both SECURITY DEFINER and owned by
-- postgres, which bypasses RLS.
--
--   * Clients lose INSERT and DELETE on workspaces, and the INSERT policy
--     goes too, so a later blanket grant still finds no way in. There was no
--     DELETE policy; delete_workspace is the way to delete.
--   * Clients lose UPDATE on workspace_members. There is no UPDATE policy,
--     so nothing changes today. But since 0391, role = 'coowner' means
--     running the workspace, and a later "update your own row" policy must
--     not hand a member that column. set_workspace_member_role is the way.
--   * anon loses DELETE on workspace_members; it could never pass the policy.
--
-- Renaming is unchanged: "ws update by creator or co-owner" (0391) with the
-- 0317 column grant, update (name, settings). Leaving is unchanged too.

begin;

-- workspaces is read by nearly every request; give up rather than queue them.
set local lock_timeout = '5s';

revoke insert, delete on public.workspaces from public, anon, authenticated;
drop policy if exists "ws insert if creator matches" on public.workspaces;

revoke update on public.workspace_members from public, anon, authenticated;
revoke delete on public.workspace_members from public, anon;

do $$
begin
  if has_any_column_privilege('authenticated', 'public.workspaces', 'insert')
     or has_any_column_privilege('anon', 'public.workspaces', 'insert')
     or has_table_privilege('authenticated', 'public.workspaces', 'delete')
     or has_table_privilege('anon', 'public.workspaces', 'delete')
     or exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'workspaces' and cmd = 'INSERT')
     or has_any_column_privilege('authenticated', 'public.workspace_members', 'update')
     or has_any_column_privilege('anon', 'public.workspace_members', 'update')
     or has_table_privilege('anon', 'public.workspace_members', 'delete') then
    raise exception '0393: a client can still write what it should not';
  end if;
  -- What must keep working: renaming, leaving, and the two ways a workspace
  -- is made.
  if not has_column_privilege('authenticated', 'public.workspaces', 'name', 'update')
     or not has_column_privilege('authenticated', 'public.workspaces', 'settings', 'update')
     or not has_table_privilege('authenticated', 'public.workspace_members', 'delete')
     or not has_function_privilege('authenticated', 'public.create_workspace_with_root(text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_or_create_personal_workspace(uuid,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.leave_workspace(uuid)', 'execute') then
    raise exception '0393: removed more than it meant to';
  end if;
end $$;

commit;
