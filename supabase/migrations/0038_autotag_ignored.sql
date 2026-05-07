-- Per-target dismissed-suggestions table.
--
-- When a user clicks "Don't suggest again" on an auto-suggested
-- tag chip we write a row here. The autotag worker reads this
-- table on warmup and filters its scoring output so dismissed
-- (target, tag) pairs never reappear.
--
-- Scoped to a specific target (a card, a doc page, a note) — not
-- workspace-wide. Dismissing on one card doesn't suppress the
-- tag everywhere; that's what tag deletion is for.

create table if not exists autotag_ignored (
  workspace_id   uuid not null references workspaces on delete cascade,
  target_kind    text not null,
  target_id      text not null,
  tag_id         uuid not null references tags on delete cascade,
  ignored_by     uuid references auth.users on delete set null,
  ignored_at     timestamptz not null default now(),
  primary key (workspace_id, target_kind, target_id, tag_id)
);

create index if not exists autotag_ignored_workspace_idx
  on autotag_ignored (workspace_id, tag_id);

alter table autotag_ignored enable row level security;

drop policy if exists "autotag_ignored read" on autotag_ignored;
create policy "autotag_ignored read" on autotag_ignored for select
  using (is_workspace_member(workspace_id));

drop policy if exists "autotag_ignored write" on autotag_ignored;
create policy "autotag_ignored write" on autotag_ignored for all
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));
