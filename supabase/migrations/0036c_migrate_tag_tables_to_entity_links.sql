-- Universal linking, Phase 4: migrate tag-applications into entity_links.
--
-- card_tags / board_tags rows become entity_links rows with
-- link_kind='applied'. The old tables are dropped and replaced
-- with read-only VIEWS so any external readers and historical
-- code paths still resolve. New writes go directly through
-- entity_links via tagsApi.
--
-- Source kind for an applied tag:
--   • source_kind='card',  source_id=card_id,  source_board_id=board_id
--   • source_kind='board', source_id=board_id, source_board_id=board_id
--
-- Target shape:
--   • target_kind='tag', target_id=tag_id (uuid)
--
-- The card_tags.source ('user'|'auto'|'ai') copies to the new
-- entity_links.source column.

-- 1. Backfill card_tags → entity_links.
insert into entity_links (
  source_kind, source_id, source_workspace, source_board_id,
  target_kind, target_id,
  link_kind, source, created_at, created_by
)
select
  'card',           ct.card_id::text,          ct.workspace_id, ct.board_id,
  'tag',            ct.tag_id,
  'applied',        coalesce(ct.source, 'user'),
  ct.created_at,    null
from card_tags ct
on conflict do nothing;

-- 2. Backfill board_tags → entity_links.
insert into entity_links (
  source_kind, source_id, source_workspace, source_board_id,
  target_kind, target_id,
  link_kind, source, created_at, created_by
)
select
  'board',          bt.board_id::text,         bt.workspace_id, bt.board_id,
  'tag',            bt.tag_id,
  'applied',        coalesce(bt.source, 'user'),
  bt.created_at,    null
from board_tags bt
on conflict do nothing;

-- 3. Drop the old tables. They're replaced with views that project
--    the same column shapes off entity_links so any lingering reads
--    keep working until callers migrate.
drop table if exists card_tags cascade;
drop table if exists board_tags cascade;

create view card_tags as
select
  el.source_workspace               as workspace_id,
  el.source_board_id                as board_id,
  el.source_id                      as card_id,
  el.target_id                      as tag_id,
  el.source                         as source,
  el.created_at                     as created_at
from entity_links el
where el.source_kind = 'card'
  and el.target_kind = 'tag'
  and el.link_kind   = 'applied';

create view board_tags as
select
  el.source_workspace               as workspace_id,
  el.source_board_id                as board_id,
  el.target_id                      as tag_id,
  el.source                         as source,
  el.created_at                     as created_at
from entity_links el
where el.source_kind = 'board'
  and el.target_kind = 'tag'
  and el.link_kind   = 'applied';

-- 4. Realtime: card_tags / board_tags drop out of the publication
--    automatically when their tables are dropped. Add entity_links
--    so peers see new applied/mention rows live (this is now the
--    backbone of every linking surface).
do $$ begin
  perform 1 from pg_publication_tables
   where pubname = 'supabase_realtime'
     and schemaname = 'public'
     and tablename = 'entity_links';
  if not found then
    execute 'alter publication supabase_realtime add table entity_links';
  end if;
end $$;
