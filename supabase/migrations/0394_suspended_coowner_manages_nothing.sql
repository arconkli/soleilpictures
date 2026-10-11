-- 0394 — A suspended account manages no workspace (review finding on 0391).
--
-- Before 0391 the membership RPCs were created_by-only, so the worst a banned
-- owner could do in the hour their access token outlives the ban was act on
-- their OWN workspace. 0391 let co-owners in, and set_workspace_member_role /
-- remove_workspace_member (and the unshare / revoke paths) never called
-- _actor_active() — so a banned co-owner could remove members or grant
-- co-owner in someone else's workspace until the token expired. 0371/0373's
-- rule is that a suspended account acts on nothing.
--
-- Rather than patch each caller, the gate goes where the decision is made:
-- can_manage_workspace now requires an active actor. That covers every RPC
-- that asks it (membership, roles, pending invites, shares, links), the rename
-- policy "ws update by creator or co-owner", and the three read policies —
-- consistent with 0319, which already gates every read predicate the same way.
-- A suspended OWNER is gated too, as 0371 intends.
--
-- create or replace keeps the existing ACL (authenticated + service_role, not
-- anon); the block at the end proves it.

begin;

create or replace function public.can_manage_workspace(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and public._actor_active()
     and (
       exists (select 1 from public.workspaces w
                where w.id = ws and w.created_by = auth.uid())
       or exists (select 1 from public.workspace_members m
                   where m.workspace_id = ws and m.user_id = auth.uid()
                     and m.role = 'coowner')
     );
$$;

do $$
begin
  if has_function_privilege('anon', 'public.can_manage_workspace(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.can_manage_workspace(uuid)', 'execute') then
    raise exception '0394: grants are wrong';
  end if;
end $$;

commit;
