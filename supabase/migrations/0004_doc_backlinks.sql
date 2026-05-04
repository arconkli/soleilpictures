-- Workspace-scoped backlinks index. One row per (link, target) so that
-- "everything connected" surfaces (Referenced by …) can query in O(index).

create table if not exists doc_backlinks (
  id                  uuid primary key default gen_random_uuid(),
  source_workspace_id uuid not null,
  source_doc_card_id  uuid not null,
  source_page_id      uuid not null,
  source_link_id      uuid not null,
  target_kind         text not null,
  target_workspace_id uuid,
  target_board_id     uuid,
  target_card_id      text,
  target_doc_card_id  uuid,
  target_page_id      uuid,
  target_url          text,
  source_text         text,
  updated_at          timestamptz not null default now()
);

-- One row per (link, target). target_* columns can be null depending on
-- target_kind, so the unique constraint coalesces them into sentinel values.
create unique index if not exists doc_backlinks_unique on doc_backlinks (
  source_link_id,
  target_kind,
  coalesce(target_board_id,    '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(target_card_id,     ''),
  coalesce(target_doc_card_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(target_page_id,     '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(target_url,         '')
);

create index if not exists doc_backlinks_target_board on doc_backlinks (target_workspace_id, target_board_id) where target_board_id is not null;
create index if not exists doc_backlinks_target_doc   on doc_backlinks (target_workspace_id, target_doc_card_id) where target_doc_card_id is not null;
create index if not exists doc_backlinks_target_card  on doc_backlinks (target_workspace_id, target_board_id, target_card_id) where target_card_id is not null;
create index if not exists doc_backlinks_source       on doc_backlinks (source_doc_card_id, source_page_id);

alter table doc_backlinks enable row level security;
drop policy if exists "doc backlinks read" on doc_backlinks;
create policy "doc backlinks read" on doc_backlinks for select
  using (is_workspace_member(source_workspace_id) or (target_workspace_id is not null and is_workspace_member(target_workspace_id)));
drop policy if exists "doc backlinks write" on doc_backlinks;
create policy "doc backlinks write" on doc_backlinks for all
  using (is_workspace_member(source_workspace_id))
  with check (is_workspace_member(source_workspace_id));
