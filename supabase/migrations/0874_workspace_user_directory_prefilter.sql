-- 0874_workspace_user_directory_prefilter.sql
--
-- workspace_user_directory() (last written by 0530) took about a quarter of a
-- second a call, whoever asked, because it walked every membership row in the
-- database and asked is_workspace_member() of each one. Search (the people
-- branch of entity_search) and the app's member lists call it often.
--
-- The rows it may return are already known before the walk: only memberships
-- of a workspace the caller belongs to, by an explicit row or through a team.
-- So the walk now starts from those workspaces: the caller's own
-- workspace_members rows plus _my_org_workspace_ids(). That list is a superset
-- of what is_workspace_member() accepts (a team workspace the caller can reach
-- is either one where they are the team's owner or admin, or one the team can
-- see), and is_workspace_member() still decides each row exactly as before.
-- my_workspace_ids() is not used because it also asks _actor_active(), which
-- this function never did; adding it would change who gets rows.
--
-- Everything else is 0530's word for word: the columns, the name-not-address
-- rule for team workspaces, security definer, stable, search_path public,
-- auth. create or replace keeps the grants (authenticated and service_role,
-- nothing for anon); the block at the end proves them.
--
-- Checked on production before writing, as three real members (never
-- committed): the old and new bodies returned identical sorted rows, and the
-- new one answered in a few milliseconds where the old one took hundreds. A
-- caller with no user id gets no rows from either.

begin;
set local lock_timeout = '3s';

create or replace function public.workspace_user_directory()
returns table(
  user_id      uuid,
  workspace_id uuid,
  title        text,
  email        text,
  created_at   timestamptz
)
language sql
security definer
stable
set search_path = public, auth
as $$
  select
    wm.user_id,
    wm.workspace_id,
    case when w.org_id is null or wm.user_id = auth.uid() or public.can_manage_workspace(wm.workspace_id)
         then coalesce(u.raw_user_meta_data->>'full_name', u.email)
         -- 0530: in a team workspace a member reads names, never addresses.
         else coalesce(nullif(btrim(p.display_name), ''), u.raw_user_meta_data->>'full_name', 'Someone')
    end as title,
    case when w.org_id is null or wm.user_id = auth.uid() or public.can_manage_workspace(wm.workspace_id)
         then u.email end as email,
    u.created_at
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  join auth.users u on u.id = wm.user_id
  left join public.profiles p on p.user_id = wm.user_id
  -- 0874: only the caller's workspaces are walked; is_workspace_member still decides.
  where wm.workspace_id in (
          select m.workspace_id from public.workspace_members m where m.user_id = auth.uid()
          union all
          select unnest(public._my_org_workspace_ids()))
    and public.is_workspace_member(wm.workspace_id);
$$;

do $proof$
begin
  if has_function_privilege('anon', 'public.workspace_user_directory()', 'execute') then
    raise exception '0874: anon can read the workspace directory';
  end if;
  if not has_function_privilege('authenticated', 'public.workspace_user_directory()', 'execute')
     or not has_function_privilege('service_role', 'public.workspace_user_directory()', 'execute') then
    raise exception '0874: members can no longer read the workspace directory';
  end if;
  if not exists (select 1 from pg_proc
                  where oid = 'public.workspace_user_directory()'::regprocedure and prosecdef) then
    raise exception '0874: workspace_user_directory lost security definer';
  end if;
end $proof$;

commit;
