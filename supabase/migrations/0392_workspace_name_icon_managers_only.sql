-- 0392 — Only the owner or a co-owner renames a workspace or changes its icon.
--
-- The UI and the public docs have always said naming and the icon are the
-- owner's; the database never agreed. 0047 added a second permissive UPDATE
-- policy, "ws update settings by editor", and 0317 granted update (name,
-- settings) — so any editor could rename a workspace with a direct table
-- write, and merge_workspace_settings let any editor set `icon_url`. With a
-- co-owner role (0391) the line between people who RUN a workspace and people
-- who WORK in it is now explicit, so draw it here too:
--
--   * drop "ws update settings by editor". Nothing needs it: every settings
--     write goes through merge_workspace_settings (SECURITY DEFINER, owned by
--     postgres, which has BYPASSRLS), and the only direct table write left in
--     any client is renameWorkspace — owner / co-owner, covered by
--     "ws update by creator or co-owner" (0391).
--   * merge_workspace_settings refuses an `icon_url` key from anyone who
--     can't manage the workspace. Card defaults stay editable by every writer.

begin;

drop policy if exists "ws update settings by editor" on public.workspaces;

create or replace function public.merge_workspace_settings(p_workspace_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_settings jsonb;
begin
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner', 'coowner', 'admin', 'editor')
  ) then
    raise exception 'Not authorised to update workspace settings.';
  end if;

  -- 0392: the icon is identity, like the name — the owner's or a co-owner's.
  if coalesce(p_patch, '{}'::jsonb) ? 'icon_url'
     and not public.can_manage_workspace(p_workspace_id) then
    raise exception 'only the workspace owner or a co-owner can change the icon'
      using errcode = '42501';
  end if;

  update public.workspaces
     set settings = settings || coalesce(p_patch, '{}'::jsonb)
   where id = p_workspace_id
   returning settings into v_settings;

  return v_settings;
end;
$function$;

do $$
begin
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'workspaces'
                and policyname = 'ws update settings by editor') then
    raise exception '0392: the editor update policy is still there';
  end if;
  if has_function_privilege('anon', 'public.merge_workspace_settings(uuid,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.merge_workspace_settings(uuid,jsonb)', 'execute') then
    raise exception '0392: grants are wrong';
  end if;
end $$;

commit;
