-- 0077_admin_universe_edges_v2.sql
-- Add structural board→card edges to admin_universe_edges so every
-- card_index row appears as connected to its parent board, matching
-- what assembleGraph does for the per-workspace HomeGraph
-- (boards/src/lib/graphData.js:153-157). Without this, cards load
-- but float disconnected and read as "not part of the graph".

create or replace function public.admin_universe_edges(
  p_cursor timestamptz default null,
  p_limit  int         default 100000
)
returns table(
  source_id  text,
  target_id  text,
  edge_kind  text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  p_limit := greatest(1, least(p_limit, 200000));

  return query
  with hier as (
    select ('board:' || b.parent_board_id::text) as h_src,
           ('board:' || b.id::text)              as h_tgt,
           'hierarchy'::text                     as h_kind,
           b.created_at                          as h_ts
      from public.boards b
     where b.parent_board_id is not null
       and b.deleted_at is null
       and (p_cursor is null or b.created_at > p_cursor)
  ), structural as (
    -- Implicit board→card edge for every card. card_index doesn't
    -- distinguish embedded-board cards in the schema, so the
    -- per-card link is always emitted; floating embeds in the
    -- HomeGraph are an aesthetic choice we don't need at admin scale.
    select ('board:' || ci.board_id::text)                          as st_src,
           ('card:'  || ci.board_id::text || ':' || ci.card_id)     as st_tgt,
           'structural'::text                                       as st_kind,
           ci.updated_at                                            as st_ts
      from public.card_index ci
     where (p_cursor is null or ci.updated_at > p_cursor)
  ), el as (
    select
      case el.source_kind
        when 'card'       then ('card:' || coalesce(el.source_board_id::text, '') || ':' || el.source_id)
        when 'card_title' then ('card:' || coalesce(el.source_board_id::text, '') || ':' || el.source_id)
        else null
      end as el_src,
      case el.target_kind
        when 'board' then ('board:' || coalesce(el.target_board_id::text, el.target_id::text))
        when 'card'  then ('card:'  || coalesce(el.target_board_id::text, '') || ':' || el.target_card_id)
        when 'doc'   then ('card:'  ||                          el.target_doc_card_id::text)
        else null
      end as el_tgt,
      el.target_kind as el_kind,
      el.created_at  as el_ts
    from public.entity_links el
   where (p_cursor is null or el.created_at > p_cursor)
  ), db as (
    select
      ('card:' || db.source_doc_card_id::text) as db_src,
      case db.target_kind
        when 'board' then ('board:' || db.target_board_id::text)
        when 'card'  then ('card:'  || coalesce(db.target_board_id::text, '') || ':' || db.target_card_id)
        when 'doc'   then ('card:'  || db.target_doc_card_id::text)
        else null
      end as db_tgt,
      ('doc_' || db.target_kind) as db_kind,
      db.updated_at              as db_ts
    from public.doc_backlinks db
   where (p_cursor is null or db.updated_at > p_cursor)
  )
  select x.source_id, x.target_id, x.edge_kind, x.created_at
    from (
      select h_src  as source_id, h_tgt  as target_id, h_kind  as edge_kind, h_ts  as created_at from hier
      union all
      select st_src, st_tgt, st_kind, st_ts from structural
      union all
      select el_src, el_tgt, el_kind, el_ts from el
       where el_src is not null and el_tgt is not null
      union all
      select db_src, db_tgt, db_kind, db_ts from db
       where db_tgt is not null
    ) x
   order by x.created_at asc
   limit p_limit;
end $$;
revoke all on function public.admin_universe_edges(timestamptz, int) from public;
grant execute on function public.admin_universe_edges(timestamptz, int) to authenticated;
