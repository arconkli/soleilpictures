-- 0246_universe_scale_pagination.sql
-- The admin universe could never show more than 1,000 nodes.
--
-- Why: admin_universe_snapshot / admin_universe_edges are set-returning
-- functions, so PostgREST truncates their responses at the project's
-- `max_rows` (Supabase default: 1000) no matter what p_limit asks for.
-- The Worker requested 50k, got 1k back, concluded "fewer than the
-- limit ⇒ done", and stopped after one page. Exactly 1,000 nodes,
-- every time, forever.
--
-- A second, quieter bug rode along: both RPCs paginate on a strict
-- `created_at > cursor`. Rows created in one transaction share now(),
-- and the live corpus already has 51 rows on a single timestamp. Once
-- any same-timestamp group crosses the page size, the rows past the
-- truncation point are unreachable — silently, permanently.
--
-- Fix, in one shape: _v2 twins of both RPCs that
--   1. return ONE jsonb row (jsonb_agg) — PostgREST max_rows counts
--      rows, and a one-row response is immune to it at any page size;
--   2. paginate on a compound keyset (created_at, id) so duplicate
--      timestamps order deterministically and nothing can be skipped;
--   3. report `done` from inside SQL, where LIMIT is actually enforced.
--
-- The v1 functions stay untouched so any still-deployed Worker keeps
-- working during rollout.
--
-- Scale note: each source is filtered per-branch with a sargable
-- `>= cursor_ts` leading predicate, so per-source created_at indexes
-- keep pages cheap when the corpus grows by orders of magnitude. The
-- final sort is bounded by the filtered remainder; revisit with
-- per-source MergeAppend indexes if pages ever near statement_timeout.

------------------------------------------------------------------
-- Nodes
------------------------------------------------------------------
create or replace function public.admin_universe_snapshot_v2(
  p_cursor_ts timestamptz default null,
  p_cursor_id text        default null,
  p_limit     int         default 50000
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_rows  jsonb;
  v_count int;
begin
  perform public._require_admin();
  p_limit := greatest(1, least(p_limit, 100000));
  p_cursor_id := coalesce(p_cursor_id, '');

  with src as (
    -- USERS with at least one workspace membership (matches v1).
    select ('user:' || u.id::text) as node_id,
           'user'::text            as kind,
           null::uuid              as workspace_id,
           u.created_at            as created_at
      from auth.users u
     where exists (select 1 from public.workspace_members wm where wm.user_id = u.id)
       and (p_cursor_ts is null or u.created_at >= p_cursor_ts)
    union all
    select ('ws:' || w.id::text), 'ws', w.id, w.created_at
      from public.workspaces w
     where (p_cursor_ts is null or w.created_at >= p_cursor_ts)
    union all
    select ('board:' || b.id::text), 'board', b.workspace_id, b.created_at
      from public.boards b
     where b.deleted_at is null
       and (p_cursor_ts is null or b.created_at >= p_cursor_ts)
    union all
    select ('card:' || ci.board_id::text || ':' || ci.card_id), ci.kind, ci.workspace_id, ci.updated_at
      from public.card_index ci
     where (p_cursor_ts is null or ci.updated_at >= p_cursor_ts)
  ), page as (
    select s.node_id, s.kind, s.workspace_id, s.created_at
      from src s
     where p_cursor_ts is null
        or (s.created_at, s.node_id) > (p_cursor_ts, p_cursor_id)
     order by s.created_at asc, s.node_id asc
     limit p_limit
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at, p.node_id), '[]'::jsonb),
         count(*)
    into v_rows, v_count
    from page p;

  return jsonb_build_object(
    'nodes',   v_rows,
    'next_ts', case when v_count > 0 then v_rows->-1->>'created_at' end,
    'next_id', case when v_count > 0 then v_rows->-1->>'node_id'    end,
    'done',    v_count < p_limit
  );
end $$;
revoke all on function public.admin_universe_snapshot_v2(timestamptz, text, int) from public;
grant execute on function public.admin_universe_snapshot_v2(timestamptz, text, int) to authenticated;

------------------------------------------------------------------
-- Edges
--
-- The keyset tiebreak is an opaque per-edge key:
--   source_id || chr(31) || target_id || chr(31) || edge_kind
-- chr(31) (unit separator) can't appear in node ids or kinds, so the
-- key is collision-free and orders deterministically.
------------------------------------------------------------------
create or replace function public.admin_universe_edges_v2(
  p_cursor_ts  timestamptz default null,
  p_cursor_key text        default null,
  p_limit      int         default 100000
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_rows     jsonb;
  v_count    int;
  v_last_ts  timestamptz;
  v_last_key text;
begin
  perform public._require_admin();
  p_limit := greatest(1, least(p_limit, 200000));
  p_cursor_key := coalesce(p_cursor_key, '');

  with hier as (
    select ('board:' || b.parent_board_id::text) as e_src,
           ('board:' || b.id::text)              as e_tgt,
           'hierarchy'::text                     as e_kind,
           b.created_at                          as e_ts
      from public.boards b
     where b.parent_board_id is not null
       and b.deleted_at is null
       and (p_cursor_ts is null or b.created_at >= p_cursor_ts)
  ), structural as (
    select ('board:' || ci.board_id::text),
           ('card:'  || ci.board_id::text || ':' || ci.card_id),
           'structural'::text,
           ci.updated_at
      from public.card_index ci
     where (p_cursor_ts is null or ci.updated_at >= p_cursor_ts)
  ), el as (
    select
      case el.source_kind
        when 'card'       then ('card:' || coalesce(el.source_board_id::text, '') || ':' || el.source_id)
        when 'card_title' then ('card:' || coalesce(el.source_board_id::text, '') || ':' || el.source_id)
        else null
      end as e_src,
      case el.target_kind
        when 'board' then ('board:' || coalesce(el.target_board_id::text, el.target_id::text))
        when 'card'  then ('card:'  || coalesce(el.target_board_id::text, '') || ':' || el.target_card_id)
        when 'doc'   then ('card:'  ||                          el.target_doc_card_id::text)
        else null
      end as e_tgt,
      el.target_kind as e_kind,
      el.created_at  as e_ts
    from public.entity_links el
   where (p_cursor_ts is null or el.created_at >= p_cursor_ts)
  ), db as (
    select
      ('card:' || db.source_doc_card_id::text) as e_src,
      case db.target_kind
        when 'board' then ('board:' || db.target_board_id::text)
        when 'card'  then ('card:'  || coalesce(db.target_board_id::text, '') || ':' || db.target_card_id)
        when 'doc'   then ('card:'  || db.target_doc_card_id::text)
        else null
      end as e_tgt,
      ('doc_' || db.target_kind) as e_kind,
      db.updated_at              as e_ts
    from public.doc_backlinks db
   where (p_cursor_ts is null or db.updated_at >= p_cursor_ts)
  ), membership as (
    select ('user:' || wm.user_id::text),
           ('ws:'   || wm.workspace_id::text),
           'membership'::text,
           wm.created_at
      from public.workspace_members wm
     where (p_cursor_ts is null or wm.created_at >= p_cursor_ts)
  ), wsroot as (
    select ('ws:'    || b.workspace_id::text),
           ('board:' || b.id::text),
           'wsroot'::text,
           b.created_at
      from public.boards b
     where b.parent_board_id is null
       and b.deleted_at is null
       and (p_cursor_ts is null or b.created_at >= p_cursor_ts)
  ), share as (
    select ('user:'  || bs.user_id::text),
           ('board:' || bs.board_id::text),
           'share'::text,
           bs.created_at
      from public.board_shares bs
     where (p_cursor_ts is null or bs.created_at >= p_cursor_ts)
  ), unioned as (
    select * from hier
    union all
    select * from structural
    union all
    select e_src, e_tgt, e_kind, e_ts from el where e_src is not null and e_tgt is not null
    union all
    select e_src, e_tgt, e_kind, e_ts from db where e_tgt is not null
    union all
    select * from membership
    union all
    select * from wsroot
    union all
    select * from share
  ), keyed as (
    select u.e_src  as source_id,
           u.e_tgt  as target_id,
           u.e_kind as edge_kind,
           u.e_ts   as created_at,
           (u.e_src || chr(31) || u.e_tgt || chr(31) || u.e_kind) as edge_key
      from unioned u
  ), page as (
    select k.source_id, k.target_id, k.edge_kind, k.created_at, k.edge_key
      from keyed k
     where p_cursor_ts is null
        or (k.created_at, k.edge_key) > (p_cursor_ts, p_cursor_key)
     order by k.created_at asc, k.edge_key asc
     limit p_limit
  )
  -- edge_key is stripped from the payload rows (it's derivable;
  -- ~90B × 100k rows saved) and surfaced once as the cursor, via
  -- ordered array_agg so everything happens in one statement.
  select coalesce(jsonb_agg((to_jsonb(p) - 'edge_key') order by p.created_at, p.edge_key), '[]'::jsonb),
         count(*),
         (array_agg(p.created_at order by p.created_at desc, p.edge_key desc))[1],
         (array_agg(p.edge_key   order by p.created_at desc, p.edge_key desc))[1]
    into v_rows, v_count, v_last_ts, v_last_key
    from page p;

  return jsonb_build_object(
    'edges',    v_rows,
    'next_ts',  v_last_ts,
    'next_key', v_last_key,
    'done',     v_count < p_limit
  );
end $$;
revoke all on function public.admin_universe_edges_v2(timestamptz, text, int) from public;
grant execute on function public.admin_universe_edges_v2(timestamptz, text, int) to authenticated;
