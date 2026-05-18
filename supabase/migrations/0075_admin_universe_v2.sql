-- 0075_admin_universe_v2.sql
-- Universe v2 follow-up:
--   1. Fix admin_universe_edges ambiguity bug (42702) — the function's
--      RETURNS TABLE columns shadow entity_links columns of the same
--      name inside the body. Project CTE columns under different names
--      and re-project to the declared names in the final select.
--   2. Add total_seconds_in_app counter + bump_seconds_in_app RPC so
--      the frontend heartbeat can credit a single counter row without
--      writing a new analytics_events row every 60s.
--   3. Add a tier-change trigger that writes 'tier_changed' events to
--      analytics_events whenever profiles.tier moves. Backfill
--      'inferred_first_paid' from existing paying subscriptions so the
--      Avg-time-to-paid stat is non-empty on day one.
--   4. New admin_avg_time_to_paid RPC for the Overview tab.

------------------------------------------------------------------
-- 1a. Fix admin_universe_edges (42702 ambiguity)
--
-- The body's `where source_id is not null` was ambiguous: source_id is
-- both a CTE column name AND a RETURNS TABLE column name (which Postgres
-- treats as a PL/pgSQL variable). Renaming the CTE columns disentangles
-- the reference.
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
      select h_src as source_id, h_tgt as target_id, h_kind as edge_kind, h_ts as created_at
        from hier
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

------------------------------------------------------------------
-- 1b. total_seconds_in_app counter + RPC
--
-- The frontend heartbeat calls bump_seconds_in_app(p_seconds) every
-- ~60s while the tab is visible. A single counter row is enough — we
-- don't need per-user attribution for the platform aggregate.
-- bump is exposed to anon so landing-page heartbeats also count.
------------------------------------------------------------------
insert into public.platform_counters (key, value) values ('total_seconds_in_app', 0)
on conflict (key) do nothing;

create or replace function public.bump_seconds_in_app(p_seconds int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_seconds is null then return; end if;
  p_seconds := greatest(1, least(p_seconds, 600));
  update public.platform_counters
     set value = value + p_seconds, updated_at = now()
   where key = 'total_seconds_in_app';
end $$;
revoke all on function public.bump_seconds_in_app(int) from public;
grant execute on function public.bump_seconds_in_app(int) to anon, authenticated;

------------------------------------------------------------------
-- 1c. Tier-change logging (for conversion-time analytics)
--
-- AFTER UPDATE OF tier writes one analytics_events row per real
-- transition. The trigger is silent on no-op updates and on initial
-- inserts (the seed migration sets tier='waitlist' by default; we
-- only care about *changes* over time).
------------------------------------------------------------------
create or replace function public._log_tier_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tier is distinct from old.tier then
    insert into public.analytics_events (user_id, event, props, occurred_at)
      values (new.user_id, 'tier_changed',
              jsonb_build_object('from', old.tier, 'to', new.tier),
              now());
  end if;
  return new;
end $$;

drop trigger if exists profiles_tier_change_log on public.profiles;
create trigger profiles_tier_change_log after update of tier on public.profiles
  for each row execute function public._log_tier_change();

-- Backfill: seed an inferred_first_paid event from any currently-paid
-- subscription so admin_avg_time_to_paid has data on day one. Idempotent
-- via WHERE NOT EXISTS guard (the table has no unique index suitable
-- for ON CONFLICT, so we use a not-exists check instead).
insert into public.analytics_events (user_id, event, props, occurred_at)
select s.user_id, 'inferred_first_paid',
       jsonb_build_object('source', 'subscriptions.updated_at_backfill',
                          'plan',   s.plan,
                          'status', s.status),
       s.updated_at
  from public.subscriptions s
 where s.status in ('active', 'trialing')
   and not exists (
     select 1 from public.analytics_events ev
      where ev.user_id = s.user_id and ev.event = 'inferred_first_paid'
   );

------------------------------------------------------------------
-- 1d. admin_avg_time_to_paid — aggregate stat for Overview tab
------------------------------------------------------------------
create or replace function public.admin_avg_time_to_paid()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  perform public._require_admin();
  with conv as (
    select u.id as user_id, u.created_at as signed_up_at,
           min(ev.occurred_at) as first_paid_at
      from auth.users u
      join public.analytics_events ev
        on ev.user_id = u.id
       and (
         ev.event = 'inferred_first_paid'
      or (ev.event = 'tier_changed' and ev.props->>'to' = 'paid')
       )
     group by u.id, u.created_at
  ),
  spans as (
    select extract(epoch from (first_paid_at - signed_up_at))::bigint as secs
      from conv
     where first_paid_at >= signed_up_at
  )
  select jsonb_build_object(
    'paid_users',     (select count(*) from spans),
    'avg_seconds',    (select coalesce(avg(secs), 0)::bigint from spans),
    'median_seconds', (select coalesce(
                              percentile_cont(0.5) within group (order by secs),
                              0)::bigint from spans)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.admin_avg_time_to_paid() from public;
grant execute on function public.admin_avg_time_to_paid() to authenticated;
