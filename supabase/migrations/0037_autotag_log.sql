-- Autotag log: idempotence + audit for the homegrown matcher.
--
-- Each row is one (workspace, target) scoring run. content_hash is
-- a stable hash of the input text + workspace tag list — when the
-- same input would be scored again we can short-circuit and avoid
-- re-applying the same tags.
--
-- suggested_tag_ids = the full ranked list returned by the engine
-- applied_tag_ids   = the subset that actually got written as
--                     entity_links rows (i.e. those scoring above
--                     the workspace's HIGH threshold)

create table if not exists autotag_log (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces on delete cascade,
  target_kind     text not null,                -- 'card' | 'board' | 'doc' | 'note' | ...
  target_id       text not null,
  content_hash    text not null,
  suggested_tag_ids uuid[] not null default '{}',
  applied_tag_ids   uuid[] not null default '{}',
  run_at          timestamptz not null default now(),
  version         int not null default 1
);

create index if not exists autotag_log_workspace_idx
  on autotag_log (workspace_id, target_kind, target_id, run_at desc);

alter table autotag_log enable row level security;

drop policy if exists "autotag_log read" on autotag_log;
create policy "autotag_log read" on autotag_log for select
  using (is_workspace_member(workspace_id));

drop policy if exists "autotag_log write" on autotag_log;
create policy "autotag_log write" on autotag_log for all
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));
