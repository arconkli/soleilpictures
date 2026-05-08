-- Board templates: UPDATE policy.
--
-- Migration 0033 added SELECT, INSERT, and DELETE policies on
-- board_templates but never an UPDATE policy. This blocked the
-- SettingsPanel "Templates" tab's rename action — RLS rejected
-- the update silently. Add an UPDATE policy that mirrors the DELETE
-- policy, plus opens up edits to workspace editors (matching the
-- broader Tier 3 stance that editors can modify shared workspace
-- artefacts, not just the workspace creator).

drop policy if exists "templates update" on public.board_templates;
create policy "templates update"
  on public.board_templates for update
  to authenticated
  using (
    -- Creator of the template can always rename their own.
    created_by = auth.uid()
    -- Workspace-scoped templates: any editor or owner of that
    -- workspace can rename or restamp the cover. Mirrors the
    -- Tier 3 settings policy.
    or (scope = 'workspace' and workspace_id is not null
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = board_templates.workspace_id
            and wm.user_id = auth.uid()
            and wm.role in ('editor', 'owner')
        ))
  )
  with check (
    created_by = auth.uid()
    or (scope = 'workspace' and workspace_id is not null
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = board_templates.workspace_id
            and wm.user_id = auth.uid()
            and wm.role in ('editor', 'owner')
        ))
  );
