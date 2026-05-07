-- Universal linking, Phase 4: link_kind + attribution on entity_links.
--
-- The same row format will hold three distinct relationships:
--   • mention   — auto-detected reference in source text (existing default)
--   • applied   — explicit user gesture ("this card is tagged with X",
--                 "this doc is attached to a project Y") — what
--                 card_tags / board_tags express today
--   • reply / attached — reserved for future relationship types
--
-- We also need to track WHO created the link so the renderer can
-- distinguish user-applied tags from autotagger-applied tags. That
-- mirrors the source column we already had on card_tags.

alter table entity_links
  add column if not exists link_kind text not null default 'mention'
    check (link_kind in ('mention','applied','reply','attached')),
  add column if not exists source text not null default 'user'
    check (source in ('user','auto','ai'));

-- Existing rows are mentions created by users — explicit defaults
-- already cover that, but make it explicit for clarity.
update entity_links set link_kind = 'mention', source = 'user'
 where link_kind is null or source is null;

-- Re-build the unique index to include link_kind so a card can both
-- be tagged with X (link_kind='applied') AND mention X in its body
-- (link_kind='mention') without colliding.
drop index if exists entity_links_unique;

create unique index entity_links_unique on entity_links (
  source_kind,
  source_id,
  coalesce(source_page_id, ''),
  coalesce(source_link_id, ''),
  link_kind,
  target_kind,
  coalesce(target_id::text,        ''),
  coalesce(target_board_id::text,  ''),
  coalesce(target_card_id,         ''),
  coalesce(target_doc_card_id::text, ''),
  coalesce(target_page_id,         ''),
  coalesce(target_url,             '')
);

-- Convenience indexes on the new columns. The "applied" path is by
-- far the dominant filter for tag UIs.
create index if not exists entity_links_link_kind_idx on entity_links (link_kind);
create index if not exists entity_links_applied_target_idx
  on entity_links (target_kind, target_id, link_kind)
  where link_kind = 'applied' and target_id is not null;

-- RLS: today entity_links allows insert/update for any workspace
-- member. Card-applied tags should also be writable by share-editors
-- (who don't have full workspace membership but do have
-- can_write_board(source_board_id)). Extend the policy.
drop policy if exists "entity_links read" on entity_links;
create policy "entity_links read" on entity_links for select
  using (
    is_workspace_member(source_workspace)
    or (source_board_id is not null and can_read_board(source_board_id))
  );

drop policy if exists "entity_links write" on entity_links;
create policy "entity_links write" on entity_links for all
  using (
    is_workspace_member(source_workspace)
    or (source_board_id is not null and can_write_board(source_board_id))
  )
  with check (
    is_workspace_member(source_workspace)
    or (source_board_id is not null and can_write_board(source_board_id))
  );
