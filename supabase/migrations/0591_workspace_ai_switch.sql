-- 0591 — The owner can turn a workspace's AI suggestions off.
--
-- workspaces.ai_tagger_enabled has existed since the AI tagger shipped, and
-- the docs say AI suggestions "can be switched off in settings", but nothing
-- could write the column: authenticated has column-level UPDATE on name and
-- settings only. Settings → Workspace now carries the switch, so the column
-- joins them. Which rows a caller may update is still the existing policy
-- ("ws update by creator or co-owner"); this grant only lets that update
-- name this column.
--
-- Off means no card or doc text goes to a model for that workspace: the
-- client paths ask hooks/useWorkspaceAiEnabled.js first, and /api/tags/embed,
-- /api/tags/apply and /api/ai/candidates refuse it as a backstop.

begin;

grant update (ai_tagger_enabled) on public.workspaces to authenticated;

do $proof$
begin
  if not has_column_privilege('authenticated', 'public.workspaces', 'ai_tagger_enabled', 'UPDATE') then
    raise exception '0591: authenticated cannot update ai_tagger_enabled';
  end if;
  if has_column_privilege('anon', 'public.workspaces', 'ai_tagger_enabled', 'UPDATE') then
    raise exception '0591: anon can update ai_tagger_enabled';
  end if;
  if not exists (select 1 from pg_policy
                  where polrelid = 'public.workspaces'::regclass
                    and polname = 'ws update by creator or co-owner'
                    and pg_get_expr(polqual, polrelid) like '%can_manage_workspace(id)%') then
    raise exception '0591: the update policy that scopes this grant has changed';
  end if;
end $proof$;

commit;
