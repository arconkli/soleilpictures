-- Universal linking, Phase 4: extend backlinks RPCs to handle the
-- 'tag' target kind, and add a dedicated `get_things_tagged` RPC
-- that joins entity_links rows back to entity_search so the tag
-- detail view can render thumbnails / titles in one round trip.

-- Replace get_entity_backlinks: add link_kind to the returned shape
-- so the UI can distinguish "tagged with X" from "mentioned X".
-- Keep the full existing surface (board / card / doc / docPos /
-- message / user / url) and add 'tag'.
create or replace function get_entity_backlinks(
  p_kind text,
  p_id uuid default null,
  p_board_id uuid default null,
  p_card_id text default null,
  p_doc_card_id uuid default null,
  p_url text default null,
  p_limit int default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rows jsonb;
begin
  with matched as (
    select el.*
      from entity_links el
     where el.target_kind = p_kind
       and (
         (p_kind = 'board'   and el.target_board_id = p_board_id)
      or (p_kind = 'card'    and el.target_board_id = p_board_id and el.target_card_id = p_card_id)
      or (p_kind in ('doc','docPos') and el.target_doc_card_id = p_doc_card_id)
      or (p_kind in ('message','user','tag') and el.target_id = p_id)
      or (p_kind = 'url'     and el.target_url = p_url)
       )
     order by el.created_at desc
     limit p_limit
  )
  select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into rows from matched m;
  return rows;
end $$;

-- get_things_tagged: list every source that's been tagged with the
-- given tag id (link_kind='applied'), joined to entity_search so the
-- caller gets title + meta in one trip. Powers the tag detail view.
--
-- Source resolution: entity_search id-format differs per kind, so we
-- look up by (kind, id-pattern) per-row. For cards we recombine
-- source_board_id + source_id into the entity_search composite id.
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
  -- Tags are workspace-scoped; pull workspace_id off the tag for filtering
  -- (helps keep the UNION query bounded).
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
    -- Cards (card_index): entity_search.id = boardId:cardId
    select a.created_at as applied_at, a.source as applied_source,
           es.id, es.kind, es.title, es.body, es.meta, es.board_id, es.card_id, es.updated_at
      from applied a
      join entity_search es
        on a.source_kind = es.kind
       and es.id = a.source_board_id::text || ':' || a.source_id
     where a.source_kind in ('card','note','image','link','palette','doc','schedule')

    union all

    -- Boards: entity_search.id = boardId
    select a.created_at as applied_at, a.source as applied_source,
           es.id, es.kind, es.title, es.body, es.meta, es.board_id, es.card_id, es.updated_at
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
