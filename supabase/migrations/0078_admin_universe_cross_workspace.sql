-- 0078_admin_universe_cross_workspace.sql
-- Make the universe feel like ONE scene instead of N disconnected
-- workspace islands by introducing the people and the spaces above
-- the per-workspace structure:
--
--   • user:<uuid>   — one node per signed-up user (with ≥1 workspace
--                     membership). Acts as the gravity well that
--                     workspaces orbit around.
--   • ws:<uuid>     — one node per workspace. Each workspace's top-
--                     level board cluster anchors here.
--
-- And the edges that string them together:
--
--   • membership    user:U → ws:W      (one per workspace_members row)
--   • wsroot        ws:W   → board:B   (each top-level board roots into its workspace)
--   • share         user:U → board:B   (one per board_shares row — pulls
--                                      shared boards across workspace lines)
--
-- Net effect: users with multiple workspaces become hubs that pull
-- their workspaces together; shared boards thread between users;
-- the force layout naturally collapses N islands into one web.

------------------------------------------------------------------
-- 1. Snapshot — add user and ws nodes
------------------------------------------------------------------
create or replace function public.admin_universe_snapshot(
  p_cursor timestamptz default null,
  p_limit  int         default 50000
)
returns table(
  node_id      text,
  kind         text,
  workspace_id uuid,
  created_at   timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  p_limit := greatest(1, least(p_limit, 100000));

  return query
  with src as (
    -- USERS: only those who actually appear in a workspace. Pure
    -- waitlist signups don't get a node yet; they have nothing to
    -- attach to. Switches to "all signed-up users" if we ever want
    -- to visualize the funnel from waitlist → workspace.
    select ('user:' || u.id::text) as node_id,
           'user'::text             as kind,
           null::uuid               as workspace_id,
           u.created_at             as created_at
      from auth.users u
     where exists (select 1 from public.workspace_members wm where wm.user_id = u.id)
       and (p_cursor is null or u.created_at > p_cursor)
    union all
    -- WORKSPACES
    select ('ws:' || w.id::text)    as node_id,
           'ws'::text                as kind,
           w.id                      as workspace_id,
           w.created_at              as created_at
      from public.workspaces w
     where (p_cursor is null or w.created_at > p_cursor)
    union all
    -- BOARDS (alive only)
    select ('board:' || b.id::text) as node_id,
           'board'::text             as kind,
           b.workspace_id            as workspace_id,
           b.created_at              as created_at
      from public.boards b
     where b.deleted_at is null
       and (p_cursor is null or b.created_at > p_cursor)
    union all
    -- CARDS
    select ('card:' || ci.board_id::text || ':' || ci.card_id) as node_id,
           ci.kind                                              as kind,
           ci.workspace_id                                      as workspace_id,
           ci.updated_at                                        as created_at
      from public.card_index ci
     where (p_cursor is null or ci.updated_at > p_cursor)
  )
  select s.node_id, s.kind, s.workspace_id, s.created_at
    from src s
   order by s.created_at asc
   limit p_limit;
end $$;
revoke all on function public.admin_universe_snapshot(timestamptz, int) from public;
grant execute on function public.admin_universe_snapshot(timestamptz, int) to authenticated;

------------------------------------------------------------------
-- 2. Edges — add membership / wsroot / share clauses
------------------------------------------------------------------
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
  ), wsroot as (
    -- Workspace anchor → its top-level boards. Gives each workspace
    -- a visible center of gravity so the force layout collapses the
    -- whole workspace tree around it.
    select ('ws:'    || b.workspace_id::text) as w_src,
           ('board:' || b.id::text)           as w_tgt,
           'wsroot'::text                     as w_kind,
           b.created_at                       as w_ts
      from public.boards b
     where b.parent_board_id is null
       and b.deleted_at is null
       and (p_cursor is null or b.created_at > p_cursor)
  ), membership as (
    -- User → every workspace they're a member of. Multi-workspace
    -- users become hubs; their workspaces cluster together.
    select ('user:' || wm.user_id::text)      as m_src,
           ('ws:'   || wm.workspace_id::text) as m_tgt,
           'membership'::text                 as m_kind,
           wm.created_at                      as m_ts
      from public.workspace_members wm
     where (p_cursor is null or wm.created_at > p_cursor)
  ), shares as (
    -- Board shares: user → shared board (across workspaces).
    select ('user:'  || bs.user_id::text)  as s_src,
           ('board:' || bs.board_id::text) as s_tgt,
           'share'::text                   as s_kind,
           bs.created_at                   as s_ts
      from public.board_shares bs
     where (p_cursor is null or bs.created_at > p_cursor)
  ), structural as (
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
      select m_src,  m_tgt,  m_kind,  m_ts  from membership
      union all
      select w_src,  w_tgt,  w_kind,  w_ts  from wsroot
      union all
      select s_src,  s_tgt,  s_kind,  s_ts  from shares
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
