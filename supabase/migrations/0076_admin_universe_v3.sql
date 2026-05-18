-- 0076_admin_universe_v3.sql
-- Universe v3 follow-ups:
--   1. Anti-abuse on bump_seconds_in_app — per-session 60s/minute cap.
--      The previous signature is fire-and-forget anon-callable with
--      no per-caller rate limit. We add a session_id parameter and a
--      lightweight tracking table.
--   2. Relax the inferred_first_paid backfill to include all
--      subscription statuses, not just active/trialing. Users who
--      paid-and-cancelled are real conversions and should count.
--      (Their dates are approximate — see comment below.)
--   3. Extend admin_universe_stats to include same-day counters so
--      the ticker can render "+N today" growth indicators.

------------------------------------------------------------------
-- 1. Per-session heartbeat rate limit
------------------------------------------------------------------
create table if not exists public.heartbeat_session (
  session_id     uuid primary key,
  window_start   timestamptz not null default now(),
  seconds_used   int         not null default 0,
  last_bumped_at timestamptz not null default now()
);
alter table public.heartbeat_session enable row level security;
-- Read/write only via SECURITY DEFINER below.

create index if not exists heartbeat_session_last_bumped_idx
  on public.heartbeat_session (last_bumped_at);

-- bump_seconds_in_app(p_seconds, p_session_id)
--
-- Returns the number of seconds actually credited (0 if the session
-- has already hit its 60s/minute cap). Without a session_id, the cap
-- is harder (5 seconds max per call) to limit anon abuse to
-- negligible influence on the ticker.
create or replace function public.bump_seconds_in_app(
  p_seconds    int,
  p_session_id uuid default null
)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_now    timestamptz := now();
  v_sess   record;
  v_credit int;
  v_age    interval;
begin
  if p_seconds is null or p_seconds <= 0 then return 0; end if;
  p_seconds := least(p_seconds, 60);

  if p_session_id is null then
    v_credit := least(p_seconds, 5);
  else
    insert into public.heartbeat_session (session_id, window_start, seconds_used, last_bumped_at)
      values (p_session_id, v_now, 0, v_now)
      on conflict (session_id) do nothing;
    select window_start, seconds_used into v_sess
      from public.heartbeat_session
     where session_id = p_session_id
     for update;
    v_age := v_now - v_sess.window_start;
    if v_age > interval '60 seconds' then
      v_credit := p_seconds;
      update public.heartbeat_session
         set window_start = v_now, seconds_used = v_credit, last_bumped_at = v_now
       where session_id = p_session_id;
    else
      v_credit := greatest(0, least(p_seconds, 60 - v_sess.seconds_used));
      if v_credit > 0 then
        update public.heartbeat_session
           set seconds_used = seconds_used + v_credit, last_bumped_at = v_now
         where session_id = p_session_id;
      end if;
    end if;
  end if;

  if v_credit > 0 then
    update public.platform_counters
       set value = value + v_credit, updated_at = v_now
     where key = 'total_seconds_in_app';
  end if;
  return v_credit;
end $$;
revoke all on function public.bump_seconds_in_app(int, uuid) from public;
grant execute on function public.bump_seconds_in_app(int, uuid) to anon, authenticated;
-- Drop the v2 single-arg signature so no caller silently bypasses the
-- new rate limit by calling the older overload.
do $$ begin
  perform 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bump_seconds_in_app'
      and pg_get_function_identity_arguments(p.oid) = 'p_seconds integer';
  if found then
    execute 'drop function public.bump_seconds_in_app(int)';
  end if;
exception when others then null; end $$;

-- Daily cleanup: rows older than 24h are useless. pg_cron job.
create or replace function public._purge_stale_heartbeat_sessions()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.heartbeat_session
   where last_bumped_at < now() - interval '24 hours';
end $$;

do $$ begin
  perform cron.unschedule('heartbeat_session_purge');
exception when others then null; end $$;
select cron.schedule(
  'heartbeat_session_purge',
  '17 * * * *',
  $$select public._purge_stale_heartbeat_sessions();$$
);

------------------------------------------------------------------
-- 2. Backfill churned converters
--
-- The v2 backfill only included subscriptions with status in
-- (active, trialing). That misses anyone who paid then cancelled,
-- and they're real conversions for the avg-time-to-paid stat.
-- Note: the date is the subscription's last updated_at, which for
-- cancelled users is the cancellation time — an upper bound, not
-- the true first-paid time. Accept the imprecision; the alternative
-- is a Stripe API replay which is out of scope for a SQL migration.
------------------------------------------------------------------
insert into public.analytics_events (user_id, event, props, occurred_at)
select s.user_id, 'inferred_first_paid',
       jsonb_build_object('source', 'subscriptions.updated_at_backfill_all',
                          'plan',   s.plan,
                          'status', s.status,
                          'approximate', s.status not in ('active', 'trialing')),
       s.updated_at
  from public.subscriptions s
 where s.plan is not null
   and not exists (
     select 1 from public.analytics_events ev
      where ev.user_id = s.user_id and ev.event = 'inferred_first_paid'
   );

------------------------------------------------------------------
-- 3. Today-counters for growth indicators
--
-- Cheap windowed scans on indexed created_at columns. The 1Hz ticker
-- already polls platform_counters which is O(1); these "today" values
-- run once per /stats SSE poll on the Worker side (every 1s). At
-- platform scale a single date-range count is sub-millisecond on
-- indexed timestamptz columns.
------------------------------------------------------------------
create or replace function public.admin_universe_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_counters jsonb;
  v_today    jsonb;
  v_midnight timestamptz := date_trunc('day', now());
begin
  perform public._require_admin();
  select jsonb_object_agg(key, value) into v_counters from public.platform_counters;
  v_today := jsonb_build_object(
    'users',      (select count(*) from auth.users     where created_at >= v_midnight),
    'workspaces', (select count(*) from public.workspaces where created_at >= v_midnight),
    'boards',     (select count(*) from public.boards  where created_at >= v_midnight and deleted_at is null),
    'cards',      (select count(*) from public.card_index where updated_at >= v_midnight),
    'links',      (
      (select count(*) from public.entity_links where created_at >= v_midnight)
    + (select count(*) from public.doc_backlinks where updated_at >= v_midnight)
    )
  );
  return coalesce(v_counters, '{}'::jsonb) || jsonb_build_object('today', v_today);
end $$;
revoke all on function public.admin_universe_stats() from public;
grant execute on function public.admin_universe_stats() to authenticated;
