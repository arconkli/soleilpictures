-- 0151: get_things_tagged — add a doc-page branch.
--
-- 0146 hardened RLS but only resolves card/board/group sources. Directly
-- tagged DOC pages (source_kind='doc' — e.g. a "Pricing"/"Topic" tag pinned
-- to doc ranges) were invisible to the cross-board collection (TagDetailView)
-- and only surfaced in its secondary "Mentioned in" strip. Add a 4th union
-- branch so tagged docs are first-class items.
--
-- Only INDEXED pages appear (INNER join doc_page_index) so unsynced ghost
-- docs don't add "Untitled doc" noise — a page lights up once its text syncs.
-- Multiple ranges on the same page collapse to one row via GROUP BY. The RLS
-- gate in `applied` already covers doc rows (is_member OR
-- can_read_board(source_board_id)). Branches 1-3 are unchanged from 0146 —
-- the only additions are el.source_page_id in the CTE and the doc branch, so
-- there is no risk to existing card/board/group resolution.
--
-- Applied to prod via MCP (apply_migration "get_things_tagged_docs"); the
-- union types were dry-run against live data for the "Pricing Plans" tag
-- (19 notes + 4 groups + 1 board resolve; doc rows 0 until docs are indexed).

create or replace function public.get_things_tagged(p_tag_id uuid, p_limit integer default 200)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  ws_id uuid;
  is_member boolean;
  rows jsonb;
begin
  select t.workspace_id into ws_id from tags t where t.id = p_tag_id;
  if ws_id is null then
    return '[]'::jsonb;
  end if;

  is_member := is_workspace_member(ws_id);

  with applied as (
    select el.source_kind, el.source_id, el.source_board_id,
           el.source_workspace, el.source, el.created_at, el.source_page_id
      from entity_links el
     where el.target_kind = 'tag'
       and el.target_id   = p_tag_id
       and el.link_kind   = 'applied'
       and (
         is_member
         or can_read_board(
              case when el.source_kind = 'board'
                   then el.source_id::uuid
                   else el.source_board_id
              end)
       )
     order by el.created_at desc
     limit p_limit
  ),
  resolved as (
    -- Card-shaped sources.
    select a.created_at as applied_at, a.source as applied_source,
           es.id, es.kind, es.title, es.body, es.meta,
           es.board_id, es.card_id, es.updated_at,
           b.name as board_name,
           coalesce(ci.meta->>'groupName', '') as group_name,
           coalesce(ci.meta->>'groupId', '') as group_id,
           ci.body as card_body,
           null::int as member_count
      from applied a
      join entity_search es
        on es.id = a.source_board_id::text || ':' || a.source_id
       and es.kind <> 'board'
       and es.kind <> 'group'
      left join card_index ci
        on ci.board_id = a.source_board_id and ci.card_id = a.source_id
      left join boards b on b.id = a.source_board_id
     where a.source_kind = 'card'

    union all

    -- Boards.
    select a.created_at as applied_at, a.source as applied_source,
           es.id, es.kind, es.title, es.body, es.meta,
           es.board_id, es.card_id, es.updated_at,
           es.title as board_name,
           '' as group_name,
           '' as group_id,
           null as card_body,
           null::int as member_count
      from applied a
      join entity_search es
        on es.kind = 'board'
       and es.id = a.source_id
     where a.source_kind = 'board'

    union all

    -- Groups. entity_search id = "{board_uuid}:g:{group_id}".
    select a.created_at as applied_at, a.source as applied_source,
           es.id, es.kind, es.title, es.body, es.meta,
           es.board_id, es.card_id, es.updated_at,
           b.name as board_name,
           '' as group_name,
           a.source_id as group_id,
           null as card_body,
           gi.member_count
      from applied a
      join entity_search es
        on es.kind = 'group'
       and es.id = a.source_board_id::text || ':g:' || a.source_id
      left join group_index gi
        on gi.board_id = a.source_board_id and gi.group_id = a.source_id
      left join boards b on b.id = a.source_board_id
     where a.source_kind = 'group'

    union all

    -- Doc pages tagged directly (range/page applies). INNER join so only
    -- indexed pages (real title/snippet) appear; multiple ranges on a page
    -- collapse to one row via GROUP BY.
    select max(a.created_at) as applied_at,
           max(a.source) as applied_source,
           (a.source_id || ':' || coalesce(a.source_page_id, '')) as id,
           'doc'::text as kind,
           coalesce(nullif(max(dp.page_title), ''), 'Untitled doc') as title,
           left(coalesce(max(dp.page_text), ''), 200) as body,
           null::jsonb as meta,
           a.source_board_id as board_id,
           a.source_id as card_id,
           max(dp.updated_at) as updated_at,
           coalesce(max(b.name), '') as board_name,
           '' as group_name,
           '' as group_id,
           null as card_body,
           null::int as member_count
      from applied a
      join doc_page_index dp
        on dp.doc_card_id = a.source_id and dp.page_id = a.source_page_id
      left join boards b on b.id = a.source_board_id
     where a.source_kind = 'doc'
     group by a.source_id, a.source_page_id, a.source_board_id
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.applied_at desc), '[]'::jsonb)
    into rows
    from resolved r;

  return rows;
end $function$;
