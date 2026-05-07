-- get_things_tagged: fix the join.
--
-- Bug: entity_links stores source_kind='card' for every card-shaped
-- thing (notes, images, docs, palettes, schedules, link cards…),
-- but entity_search stores the *inner* card kind (e.g. 'note',
-- 'image', 'doc'). The original join keyed both on kind+id, which
-- meant the only card-row that joined was one whose inner kind
-- happened to be 'card' — every note / image / doc was filtered
-- out and therefore invisible in the tag detail view.
--
-- New approach: for card-shaped sources, join on the entity_search
-- composite id alone (boardId:cardId) and trust that to be unique
-- across kinds. We also explicitly skip rows whose es.kind = 'board'
-- to avoid colliding with the boards branch below.

create or replace function get_things_tagged(
  p_tag_id uuid,
  p_limit int default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
  rows jsonb;
begin
  select t.workspace_id into ws_id from tags t where t.id = p_tag_id;
  if ws_id is null then
    return '[]'::jsonb;
  end if;

  with applied as (
    select el.source_kind, el.source_id, el.source_board_id,
           el.source_workspace, el.source, el.created_at
      from entity_links el
     where el.target_kind = 'tag'
       and el.target_id   = p_tag_id
       and el.link_kind   = 'applied'
     order by el.created_at desc
     limit p_limit
  ),
  resolved as (
    -- Card-shaped sources: notes, images, docs, palettes, schedules,
    -- link cards, plain cards. Join by composite id only, ignoring
    -- the source_kind/es.kind mismatch that broke the v1 join.
    select a.created_at as applied_at, a.source as applied_source,
           es.id, es.kind, es.title, es.body, es.meta,
           es.board_id, es.card_id, es.updated_at
      from applied a
      join entity_search es
        on es.id = a.source_board_id::text || ':' || a.source_id
       and es.kind <> 'board'
     where a.source_kind = 'card'

    union all

    -- Boards: entity_search.id = boardId.
    select a.created_at as applied_at, a.source as applied_source,
           es.id, es.kind, es.title, es.body, es.meta,
           es.board_id, es.card_id, es.updated_at
      from applied a
      join entity_search es
        on es.kind = 'board'
       and es.id = a.source_id
     where a.source_kind = 'board'
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.applied_at desc), '[]'::jsonb)
    into rows
    from resolved r;

  return rows;
end $$;
