-- Workspace + profile settings columns.
--
-- Adds a `settings jsonb` blob to both workspaces and profiles so the
-- new SettingsPanel UI has a place to persist:
--   • Workspace defaults (note bgColor, board cover, doc font, etc.)
--     editable by editors AND owners — so any teammate with edit
--     access can adjust house style.
--   • Per-user defaults that override workspace defaults for the
--     individual (lets a user say "I always want my notes warm grey
--     even if the workspace default is yellow").
--   • Per-user UI preferences (theme, accent, hideChrome, font choice)
--     — these never live at workspace scope.
--
-- Atomic merge RPCs let two clients patch different keys at once
-- without trampling each other (`settings || patch`).

-- ── Columns ─────────────────────────────────────────────────────────
alter table public.workspaces
  add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.profiles
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- ── Workspace settings update policy ────────────────────────────────
-- The existing "ws update by creator" policy only lets owners change
-- workspaces. For settings we want any editor to participate. Add a
-- second permissive policy that opens UPDATE to editors too. (PG
-- evaluates UPDATE policies as OR — adding this one is additive.)
drop policy if exists "ws update settings by editor" on public.workspaces;
create policy "ws update settings by editor"
  on public.workspaces for update
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspaces.id
        and wm.user_id = auth.uid()
        and wm.role in ('editor', 'owner')
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspaces.id
        and wm.user_id = auth.uid()
        and wm.role in ('editor', 'owner')
    )
  );

-- ── Atomic merge RPCs ───────────────────────────────────────────────
-- `settings || p_patch` does a one-level deep merge: top-level keys in
-- p_patch overwrite their counterparts, missing keys keep their old
-- values. That's the right granularity for our settings shape — each
-- top-level key (note, board, doc, ui, etc.) is itself a jsonb blob
-- that the client always sends in full.

create or replace function public.merge_workspace_settings(
  p_workspace_id uuid,
  p_patch        jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
begin
  -- Permission: must be a workspace editor or owner. This mirrors the
  -- RLS policy above so callers get a clear error instead of a silent
  -- "0 rows updated".
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('editor', 'owner')
  ) then
    raise exception 'Not authorised to update workspace settings.';
  end if;

  update public.workspaces
     set settings = settings || coalesce(p_patch, '{}'::jsonb)
   where id = p_workspace_id
   returning settings into v_settings;

  return v_settings;
end;
$$;

create or replace function public.merge_profile_settings(
  p_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
begin
  -- Self only — no auth check needed beyond auth.uid() being present,
  -- which RLS on profiles already enforces.
  insert into public.profiles (user_id, settings)
       values (auth.uid(), coalesce(p_patch, '{}'::jsonb))
  on conflict (user_id)
       do update set settings = public.profiles.settings || coalesce(p_patch, '{}'::jsonb)
  returning settings into v_settings;

  return v_settings;
end;
$$;

grant execute on function public.merge_workspace_settings(uuid, jsonb) to authenticated;
grant execute on function public.merge_profile_settings(jsonb)         to authenticated;
