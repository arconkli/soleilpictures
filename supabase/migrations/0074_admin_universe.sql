-- 0074_admin_universe.sql
-- Admin "Universe" home: an anonymous, platform-wide graph of every
-- node every user has created, with a ticker of headline counters.
--
-- Adds:
--   1. platform_counters table + AFTER triggers on workspaces, boards,
--      card_index, entity_links, doc_backlinks. count(*) over millions
--      is too slow for a 1Hz ticker; this is O(1).
--   2. SECURITY DEFINER RPCs gated on _require_admin() from 0070:
--        admin_universe_stats()    → ticker payload
--        admin_universe_snapshot() → node pages
--        admin_universe_edges()    → edge pages
--   3. A nightly pg_cron reconciler that recomputes counters from
--      ground truth so any trigger drift heals itself.
--
-- Privacy: snapshot/edges return only ids, kinds, workspace_id,
-- created_at. No title, body, image, or email leaves the database
-- through these RPCs even though the caller is an admin.

create extension if not exists pg_cron;

------------------------------------------------------------------
-- 1. platform_counters
------------------------------------------------------------------
create table if not exists public.platform_counters (
  key        text primary key,
  value      bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Counter rows are read through SECURITY DEFINER RPCs only.
alter table public.platform_counters enable row level security;
-- No policies → only postgres/service_role and SECURITY DEFINER
-- functions can read. RPCs explicitly bypass via security definer.

-- Seed all keys at 0 so RPCs can assume the row exists.
insert into public.platform_counters (key, value) values
  ('total_workspaces', 0),
  ('total_boards',     0),
  ('total_cards',      0),
  ('total_links',      0),
  ('total_users',      0),
  ('nodes_created_24h', 0)
on conflict (key) do nothing;

------------------------------------------------------------------
-- 2. Trigger helpers
--
-- One row-level update per insert/delete. Contention on a single
-- counter row is acceptable up to ~10k writes/s; if we ever push
-- past that the row can be sharded (multiple rows per key, sum on
-- read). Single counter row is the simplest correct thing today.
------------------------------------------------------------------
create or replace function public._bump_counter(p_key text, p_delta bigint)
returns void language plpgsql as $$
begin
  update public.platform_counters
     set value = value + p_delta, updated_at = now()
   where key = p_key;
end $$;

------------------------------------------------------------------
-- workspaces → total_workspaces
------------------------------------------------------------------
create or replace function public._counter_workspaces_ins()
returns trigger language plpgsql as $$
begin perform public._bump_counter('total_workspaces',  1); return new; end $$;

create or replace function public._counter_workspaces_del()
returns trigger language plpgsql as $$
begin perform public._bump_counter('total_workspaces', -1); return old; end $$;

drop trigger if exists workspaces_counter_ins on public.workspaces;
create trigger workspaces_counter_ins after insert on public.workspaces
  for each row execute function public._counter_workspaces_ins();

drop trigger if exists workspaces_counter_del on public.workspaces;
create trigger workspaces_counter_del after delete on public.workspaces
  for each row execute function public._counter_workspaces_del();

------------------------------------------------------------------
-- boards → total_boards
-- Soft-delete aware: alive = (deleted_at is null). Three transitions:
--   INSERT with deleted_at null     → +1
--   UPDATE null     → not-null      → -1   (soft delete)
--   UPDATE not-null → null          → +1   (restore)
--   DELETE row with deleted_at null → -1   (hard delete of an alive row)
-- Hard-deleting a row that was already soft-deleted is a no-op for
-- the alive count (it's already not counted).
------------------------------------------------------------------
create or replace function public._counter_boards_ins()
returns trigger language plpgsql as $$
begin
  if new.deleted_at is null then perform public._bump_counter('total_boards', 1); end if;
  return new;
end $$;

create or replace function public._counter_boards_upd()
returns trigger language plpgsql as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    perform public._bump_counter('total_boards', -1);
  elsif old.deleted_at is not null and new.deleted_at is null then
    perform public._bump_counter('total_boards',  1);
  end if;
  return new;
end $$;

create or replace function public._counter_boards_del()
returns trigger language plpgsql as $$
begin
  if old.deleted_at is null then perform public._bump_counter('total_boards', -1); end if;
  return old;
end $$;

drop trigger if exists boards_counter_ins on public.boards;
create trigger boards_counter_ins after insert on public.boards
  for each row execute function public._counter_boards_ins();

drop trigger if exists boards_counter_upd on public.boards;
create trigger boards_counter_upd after update of deleted_at on public.boards
  for each row execute function public._counter_boards_upd();

drop trigger if exists boards_counter_del on public.boards;
create trigger boards_counter_del after delete on public.boards
  for each row execute function public._counter_boards_del();

------------------------------------------------------------------
-- card_index → total_cards
------------------------------------------------------------------
create or replace function public._counter_cards_ins()
returns trigger language plpgsql as $$
begin perform public._bump_counter('total_cards',  1); return new; end $$;

create or replace function public._counter_cards_del()
returns trigger language plpgsql as $$
begin perform public._bump_counter('total_cards', -1); return old; end $$;

drop trigger if exists card_index_counter_ins on public.card_index;
create trigger card_index_counter_ins after insert on public.card_index
  for each row execute function public._counter_cards_ins();

drop trigger if exists card_index_counter_del on public.card_index;
create trigger card_index_counter_del after delete on public.card_index
  for each row execute function public._counter_cards_del();

------------------------------------------------------------------
-- entity_links + doc_backlinks → total_links
------------------------------------------------------------------
create or replace function public._counter_links_ins()
returns trigger language plpgsql as $$
begin perform public._bump_counter('total_links',  1); return new; end $$;

create or replace function public._counter_links_del()
returns trigger language plpgsql as $$
begin perform public._bump_counter('total_links', -1); return old; end $$;

drop trigger if exists entity_links_counter_ins on public.entity_links;
create trigger entity_links_counter_ins after insert on public.entity_links
  for each row execute function public._counter_links_ins();

drop trigger if exists entity_links_counter_del on public.entity_links;
create trigger entity_links_counter_del after delete on public.entity_links
  for each row execute function public._counter_links_del();

drop trigger if exists doc_backlinks_counter_ins on public.doc_backlinks;
create trigger doc_backlinks_counter_ins after insert on public.doc_backlinks
  for each row execute function public._counter_links_ins();

drop trigger if exists doc_backlinks_counter_del on public.doc_backlinks;
create trigger doc_backlinks_counter_del after delete on public.doc_backlinks
  for each row execute function public._counter_links_del();

------------------------------------------------------------------
-- auth.users → total_users (insert/delete are the only meaningful
-- transitions; tier changes don't affect the count).
------------------------------------------------------------------
create or replace function public._counter_users_ins()
returns trigger language plpgsql security definer as $$
begin perform public._bump_counter('total_users',  1); return new; end $$;

create or replace function public._counter_users_del()
returns trigger language plpgsql security definer as $$
begin perform public._bump_counter('total_users', -1); return old; end $$;

drop trigger if exists users_counter_ins on auth.users;
create trigger users_counter_ins after insert on auth.users
  for each row execute function public._counter_users_ins();

-- AFTER DELETE on auth.users may be restricted in hosted Supabase. The
-- nightly full reconcile catches drift either way; if the trigger is
-- accepted, the live count stays accurate without waiting for the cron.
do $$
begin
  drop trigger if exists users_counter_del on auth.users;
  create trigger users_counter_del after delete on auth.users
    for each row execute function public._counter_users_del();
exception when insufficient_privilege then
  raise notice 'users_counter_del trigger skipped (insufficient privilege); nightly reconcile will keep total_users accurate';
end $$;

------------------------------------------------------------------
-- 3. Initial backfill — set every counter to ground truth so the
-- triggers above start from a correct baseline.
------------------------------------------------------------------
update public.platform_counters set value = (select count(*) from public.workspaces)
  where key = 'total_workspaces';
update public.platform_counters set value = (select count(*) from public.boards where deleted_at is null)
  where key = 'total_boards';
update public.platform_counters set value = (select count(*) from public.card_index)
  where key = 'total_cards';
update public.platform_counters set value = (
    (select count(*) from public.entity_links)
  + (select count(*) from public.doc_backlinks)
  ) where key = 'total_links';
update public.platform_counters set value = (select count(*) from auth.users)
  where key = 'total_users';
update public.platform_counters set value = (
  (select count(*) from public.boards     where deleted_at is null and created_at >= now() - interval '24 hours')
+ (select count(*) from public.card_index where updated_at >= now() - interval '24 hours')
  ) where key = 'nodes_created_24h';

------------------------------------------------------------------
-- 4. RPCs — gated on _require_admin() from 0070
------------------------------------------------------------------

-- admin_universe_stats — one round trip for the ticker.
-- nodes_created_24h is recomputed every minute by the cron below;
-- between ticks it stays close enough for a live ticker (off by
-- one minute of throughput at worst).
create or replace function public.admin_universe_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  perform public._require_admin();
  select jsonb_object_agg(key, value) into v_out from public.platform_counters;
  return coalesce(v_out, '{}'::jsonb);
end $$;
revoke all on function public.admin_universe_stats() from public;
grant execute on function public.admin_universe_stats() to authenticated;

-- admin_universe_snapshot — paginated nodes ordered by created_at.
-- id is a stable string ('board:<uuid>' | 'card:<board_id>:<card_id>')
-- so client and edges RPC agree on endpoint identity.
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
    select ('board:' || b.id::text) as node_id,
           'board'::text             as kind,
           b.workspace_id            as workspace_id,
           b.created_at              as created_at
      from public.boards b
     where b.deleted_at is null
       and (p_cursor is null or b.created_at > p_cursor)
    union all
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

-- admin_universe_edges — paginated edges ordered by created_at.
-- Three sources unioned:
--   1. boards.parent_board_id (board hierarchy)
--   2. entity_links (universal targeting)
--   3. doc_backlinks (legacy; still actively written today)
-- Source/target ids are encoded the same way as the snapshot RPC so
-- the client just pairs strings — no per-edge join logic on the front.
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
    -- Board → parent board
    select ('board:' || b.parent_board_id::text) as source_id,
           ('board:' || b.id::text)              as target_id,
           'hierarchy'::text                     as edge_kind,
           b.created_at                          as created_at
      from public.boards b
     where b.parent_board_id is not null
       and b.deleted_at is null
       and (p_cursor is null or b.created_at > p_cursor)
  ), el as (
    -- entity_links: encode each end based on its target_kind. Unknown
    -- shapes are dropped (filtered by where target_id is not null).
    select
      case el.source_kind
        when 'card'  then ('card:' || coalesce(el.source_board_id::text, '') || ':' || el.source_id)
        when 'doc'   then null            -- doc-source rows don't map to a node id we render
        when 'note'  then null
        when 'message' then null
        when 'card_title' then ('card:' || coalesce(el.source_board_id::text, '') || ':' || el.source_id)
        else null
      end as source_id,
      case el.target_kind
        when 'board' then ('board:' || coalesce(el.target_board_id::text, el.target_id::text))
        when 'card'  then ('card:'  || coalesce(el.target_board_id::text, '') || ':' || el.target_card_id)
        when 'doc'   then ('card:'  ||                          el.target_doc_card_id::text)
        else null
      end as target_id,
      el.target_kind as edge_kind,
      el.created_at  as created_at
    from public.entity_links el
   where (p_cursor is null or el.created_at > p_cursor)
  ), db as (
    -- doc_backlinks: same encoding, smaller set of shapes.
    select
      ('card:' || db.source_doc_card_id::text) as source_id,
      case db.target_kind
        when 'board' then ('board:' || db.target_board_id::text)
        when 'card'  then ('card:'  || coalesce(db.target_board_id::text, '') || ':' || db.target_card_id)
        when 'doc'   then ('card:'  || db.target_doc_card_id::text)
        else null
      end as target_id,
      ('doc_' || db.target_kind) as edge_kind,
      db.updated_at as created_at
    from public.doc_backlinks db
   where (p_cursor is null or db.updated_at > p_cursor)
  )
  select x.source_id, x.target_id, x.edge_kind, x.created_at
    from (
      select * from hier
      union all select * from el where source_id is not null and target_id is not null
      union all select * from db where target_id is not null
    ) x
   order by x.created_at asc
   limit p_limit;
end $$;
revoke all on function public.admin_universe_edges(timestamptz, int) from public;
grant execute on function public.admin_universe_edges(timestamptz, int) to authenticated;

------------------------------------------------------------------
-- 5. Reconciler — keep nodes_created_24h fresh + heal counter drift
-- once a night. The 24h counter is cheap (windowed scan on indexed
-- created_at); the full-table counts are once per day so they're
-- acceptable even at scale (run during low-traffic hours).
------------------------------------------------------------------
create or replace function public._reconcile_universe_counters()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.platform_counters set value = (
    (select count(*) from public.boards     where deleted_at is null and created_at >= now() - interval '24 hours')
  + (select count(*) from public.card_index where updated_at >= now() - interval '24 hours')
  ), updated_at = now() where key = 'nodes_created_24h';
end $$;

create or replace function public._reconcile_universe_counters_full()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.platform_counters set value = (select count(*) from public.workspaces),                       updated_at = now() where key = 'total_workspaces';
  update public.platform_counters set value = (select count(*) from public.boards where deleted_at is null),  updated_at = now() where key = 'total_boards';
  update public.platform_counters set value = (select count(*) from public.card_index),                       updated_at = now() where key = 'total_cards';
  update public.platform_counters set value = (
    (select count(*) from public.entity_links) + (select count(*) from public.doc_backlinks)
  ), updated_at = now() where key = 'total_links';
  update public.platform_counters set value = (select count(*) from auth.users),                              updated_at = now() where key = 'total_users';
  perform public._reconcile_universe_counters();
end $$;

-- Cron: nodes_created_24h every minute, full reconcile nightly at 03:20.
do $$ begin
  perform cron.unschedule('universe_counters_minutely');
exception when others then null; end $$;
select cron.schedule(
  'universe_counters_minutely',
  '* * * * *',
  $$select public._reconcile_universe_counters();$$
);

do $$ begin
  perform cron.unschedule('universe_counters_nightly');
exception when others then null; end $$;
select cron.schedule(
  'universe_counters_nightly',
  '20 3 * * *',
  $$select public._reconcile_universe_counters_full();$$
);
