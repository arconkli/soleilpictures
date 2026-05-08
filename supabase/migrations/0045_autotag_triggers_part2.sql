-- Round two of server-side autotag triggers — close the remaining
-- gaps so tags update instantly no matter what.
--
-- 1. Doc pages: typing "pricing" inside a doc page should tag the
--    parent doc card. The doc itself is just a card row in
--    card_index (kind='doc'), and its body usually doesn't include
--    the page text — so the autotag_card_index trigger from 0044
--    misses it. We add a trigger on doc_page_index.
--
-- 2. Tag rename: if the slug changes, every matching board/group/
--    card in the workspace should re-evaluate against the new
--    slug. We re-run the backfill logic from migration 0043.

-- doc_page_index changes → score the parent doc card.
create or replace function autotag_on_doc_page_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parent_board uuid;
  parent_card  text;
  ws           uuid;
begin
  -- Resolve the doc card's location. doc_card_id in doc_page_index
  -- is the card_id used in card_index — but doc cards are stored
  -- with text card_ids, so we need the board too.
  select ci.workspace_id, ci.board_id, ci.card_id
    into ws, parent_board, parent_card
    from card_index ci
   where ci.card_id = NEW.doc_card_id::text
     and ci.kind in ('doc')
   limit 1;
  if ws is null or parent_board is null or parent_card is null then
    return NEW;
  end if;
  insert into entity_links (
    source_kind, source_id, source_workspace, source_board_id,
    target_kind, target_id, link_kind, source
  )
  select 'card', parent_card, ws, parent_board,
         'tag', t.id, 'applied', 'auto'
    from tags t
   where t.workspace_id = ws
     and (
       (NEW.page_title is not null and lower(NEW.page_title) ~ _tag_slug_word_re(t.slug))
    or (NEW.page_text  is not null and lower(NEW.page_text)  ~ _tag_slug_word_re(t.slug))
     )
  on conflict do nothing;
  return NEW;
end $$;

drop trigger if exists autotag_doc_page_index on doc_page_index;
create trigger autotag_doc_page_index
after insert or update of page_title, page_text on doc_page_index
for each row execute function autotag_on_doc_page_change();

-- Tag slug change → re-evaluate every board/group/card in the
-- workspace against the new slug. Calls into the backfill logic
-- inline (we can't call backfill_tag_applications because the
-- trigger isn't acting as a workspace-member auth context).
create or replace function autotag_on_tag_slug_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  word_re text;
begin
  if NEW.slug is null or NEW.slug = OLD.slug then
    return NEW;
  end if;
  word_re := _tag_slug_word_re(NEW.slug);

  -- Boards.
  insert into entity_links (
    source_kind, source_id, source_workspace, source_board_id,
    target_kind, target_id, link_kind, source
  )
  select 'board', b.id::text, b.workspace_id, b.id,
         'tag', NEW.id, 'applied', 'auto'
    from boards b
   where b.workspace_id = NEW.workspace_id
     and b.name is not null
     and lower(b.name) ~ word_re
  on conflict do nothing;

  -- Groups.
  insert into entity_links (
    source_kind, source_id, source_workspace, source_board_id,
    target_kind, target_id, link_kind, source
  )
  select 'group', gi.group_id, b.workspace_id, gi.board_id,
         'tag', NEW.id, 'applied', 'auto'
    from group_index gi
    join boards b on b.id = gi.board_id
   where b.workspace_id = NEW.workspace_id
     and gi.name is not null
     and lower(gi.name) ~ word_re
  on conflict do nothing;

  -- Cards.
  insert into entity_links (
    source_kind, source_id, source_workspace, source_board_id,
    target_kind, target_id, link_kind, source
  )
  select 'card', ci.card_id, ci.workspace_id, ci.board_id,
         'tag', NEW.id, 'applied', 'auto'
    from card_index ci
   where ci.workspace_id = NEW.workspace_id
     and (
       (ci.title is not null and lower(ci.title) ~ word_re)
    or (ci.body  is not null and lower(ci.body)  ~ word_re)
     )
  on conflict do nothing;

  return NEW;
end $$;

drop trigger if exists autotag_tags_slug on tags;
create trigger autotag_tags_slug
after update of slug on tags
for each row execute function autotag_on_tag_slug_change();
