-- User-saved board templates. A template captures a board's display
-- name + cover + Y.Doc snapshot at save-time; spawning from a template
-- creates a fresh board and applies the snapshot as the initial cards.
--
-- Scope:
--  • 'user'      — visible only to the creator across any workspace
--  • 'workspace' — visible to all members of `workspace_id`
--
-- We deliberately don't model "marketplace" / "public" yet — that's a
-- separate brainstorm (publishing flow, moderation, payments).

create table if not exists public.board_templates (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces on delete cascade,
  name         text not null,
  cover        text,
  scope        text not null default 'user' check (scope in ('user','workspace')),
  doc          bytea not null,
  created_by   uuid not null references auth.users,
  created_at   timestamptz default now()
);

create index if not exists board_templates_workspace_idx on public.board_templates (workspace_id);
create index if not exists board_templates_creator_idx on public.board_templates (created_by);

alter table public.board_templates enable row level security;

drop policy if exists "templates select" on public.board_templates;
create policy "templates select"
  on public.board_templates for select
  using (
    -- Self-scope: creator only
    (scope = 'user' and created_by = auth.uid())
    -- Workspace-scope: any member of the workspace
    or (scope = 'workspace' and workspace_id is not null
        and public.is_workspace_member(workspace_id))
  );

drop policy if exists "templates insert" on public.board_templates;
create policy "templates insert"
  on public.board_templates for insert
  with check (
    created_by = auth.uid()
    and (
      scope = 'user'
      or (scope = 'workspace' and workspace_id is not null
          and public.is_workspace_member(workspace_id))
    )
  );

drop policy if exists "templates delete" on public.board_templates;
create policy "templates delete"
  on public.board_templates for delete
  using (
    created_by = auth.uid()
    or (scope = 'workspace' and workspace_id is not null
        and exists (select 1 from public.workspaces w
                    where w.id = workspace_id and w.created_by = auth.uid()))
  );

alter publication supabase_realtime add table public.board_templates;
