-- Tag detail: surface body excerpt + parent board name + group
-- name on every row so the UI can render meaningful labels for
-- title-less notes and aggregate cards by their group.

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
    select a.created_at as applied_at, a.source as applied_source,
           es.id, es.kind, es.title, es.body, es.meta,
           es.board_id, es.card_id, es.updated_at,
           b.name as board_name,
           coalesce(ci.meta->>'groupName', '') as group_name,
           coalesce(ci.meta->>'groupId', '') as group_id,
           ci.body as card_body
      from applied a
      join entity_search es
        on es.id = a.source_board_id::text || ':' || a.source_id
       and es.kind <> 'board'
      left join card_index ci
        on ci.board_id = a.source_board_id and ci.card_id = a.source_id
      left join boards b on b.id = a.source_board_id
     where a.source_kind = 'card'

    union all

    select a.created_at as applied_at, a.source as applied_source,
           es.id, es.kind, es.title, es.body, es.meta,
           es.board_id, es.card_id, es.updated_at,
           es.title as board_name,
           '' as group_name,
           '' as group_id,
           null as card_body
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
