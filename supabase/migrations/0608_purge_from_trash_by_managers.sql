-- 0608_purge_from_trash_by_managers.sql
--
-- Removing a cluster for good is the owner's and co-owners' call, and only
-- from the trash: the boards DELETE policy requires can_manage_workspace and
-- deleted_at is not null. Editors and service accounts delete through
-- soft_delete_board, which puts a cluster in the trash where it can be
-- restored. Removing saved versions directly is likewise the owner's and
-- co-owners'; prune_board_versions (SECURITY DEFINER) keeps pruning as before.
-- The nightly purge of old trash runs as its owner and is unaffected.

alter policy "boards delete by members" on public.boards
  using (public.can_manage_workspace(workspace_id) and deleted_at is not null);

alter policy "bv delete by writers" on public.board_versions
  using (exists (select 1 from public.boards b
                  where b.id = board_versions.board_id
                    and public.can_manage_workspace(b.workspace_id)));

-- The 0311 habit: prove the policies, don't trust them.
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'boards'
                    and policyname = 'boards delete by members'
                    and qual like '%can_manage_workspace(workspace_id)%'
                    and qual like '%deleted_at IS NOT NULL%') then
    raise exception '0608: the boards delete policy is not the managers-from-trash one';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'board_versions'
                and cmd = 'DELETE' and qual not like '%can_manage_workspace%') then
    raise exception '0608: a board_versions delete policy lets non-managers in';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'boards'
                and cmd in ('DELETE', 'ALL') and policyname <> 'boards delete by members') then
    raise exception '0608: another policy allows deleting boards';
  end if;
  if not has_function_privilege('authenticated', 'public.can_manage_workspace(uuid)', 'EXECUTE') then
    raise exception '0608: can_manage_workspace lost its grant';
  end if;
end $$;
