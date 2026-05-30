-- 0101_admin_metrics_history.sql
--
-- Daily KPI snapshots powering the Universe "Command Center" dashboard's trend
-- lines, plus a live "active users now" count.
--
-- admin_stats() is a live snapshot with no history, so there's nothing to draw a
-- revenue/growth TREND from. This adds a metrics_daily table that pg_cron fills
-- once a day (and that an admin opening the dashboard tops up opportunistically),
-- so MRR / users / paid / signups / active-users trends build forward from today.
-- No backfill — the series starts sparse and grows daily.

------------------------------------------------------------------
-- 0. Snapshot table (locked down; reached only via SECURITY DEFINER RPCs + cron)
------------------------------------------------------------------
create table if not exists public.metrics_daily (
  day             date primary key,
  mrr_cents       integer,
  total_users     integer,
  paid_users      integer,
  demo_users      integer,
  waitlist_users  integer,
  admin_users     integer,
  signups         integer,
  active_users    integer,
  captured_at     timestamptz not null default now()
);
alter table public.metrics_daily enable row level security;  -- no policies: deny direct API access

------------------------------------------------------------------
-- 1. capture_metrics_daily — upsert today's snapshot (idempotent; last run wins)
--    MRR uses the same net expression as admin_stats (0099): real captured
--    amount with a list-price fallback for rows not yet refreshed.
------------------------------------------------------------------
create or replace function public.capture_metrics_daily()
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.metrics_daily (
    day, mrr_cents, total_users, paid_users, demo_users, waitlist_users,
    admin_users, signups, active_users, captured_at
  )
  select
    current_date,
    coalesce((
      select sum(coalesce(monthly_amount_cents,
               case when plan = 'monthly' then 2500
                    when plan = 'annual'  then 2000
                    else 0 end))::int
      from public.subscriptions where status in ('active', 'trialing')
    ), 0),
    (select count(*) from auth.users)::int,
    (select count(*) from public.profiles where tier = 'paid')::int,
    (select count(*) from public.profiles where tier = 'demo')::int,
    (select count(*) from public.profiles where tier = 'waitlist')::int,
    (select count(*) from public.profiles where tier = 'admin')::int,
    (select count(*) from auth.users where created_at >= current_date)::int,
    (select count(*) from public.user_presence where last_seen_at >= current_date)::int,
    now()
  on conflict (day) do update set
    mrr_cents      = excluded.mrr_cents,
    total_users    = excluded.total_users,
    paid_users     = excluded.paid_users,
    demo_users     = excluded.demo_users,
    waitlist_users = excluded.waitlist_users,
    admin_users    = excluded.admin_users,
    signups        = excluded.signups,
    active_users   = excluded.active_users,
    captured_at    = excluded.captured_at;
end;
$$;
revoke all on function public.capture_metrics_daily() from public;

------------------------------------------------------------------
-- 2. admin_metrics_history — the daily series for the trend charts
------------------------------------------------------------------
create or replace function public.admin_metrics_history(p_days int default 90)
returns table(
  day            date,
  mrr_cents      int,
  total_users    int,
  paid_users     int,
  demo_users     int,
  waitlist_users int,
  admin_users    int,
  signups        int,
  active_users   int
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  return query
    select m.day, m.mrr_cents, m.total_users, m.paid_users, m.demo_users,
           m.waitlist_users, m.admin_users, m.signups, m.active_users
    from public.metrics_daily m
    where m.day >= current_date - (p_days - 1)
    order by m.day asc;
end;
$$;
revoke all on function public.admin_metrics_history(int) from public;
grant execute on function public.admin_metrics_history(int) to authenticated;

------------------------------------------------------------------
-- 3. admin_active_now — live "active users right now"
------------------------------------------------------------------
create or replace function public.admin_active_now(p_window_minutes int default 5)
returns int language plpgsql stable security definer set search_path = public as $$
declare v_n int;
begin
  perform public._require_admin();
  p_window_minutes := greatest(1, least(p_window_minutes, 1440));
  select count(*) into v_n
  from public.user_presence
  where last_seen_at > now() - make_interval(mins => p_window_minutes);
  return coalesce(v_n, 0);
end;
$$;
revoke all on function public.admin_active_now(int) from public;
grant execute on function public.admin_active_now(int) to authenticated;

------------------------------------------------------------------
-- 4. admin_capture_metrics_now — opportunistic seed/top-up from the dashboard
------------------------------------------------------------------
create or replace function public.admin_capture_metrics_now()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  perform public.capture_metrics_daily();
end;
$$;
revoke all on function public.admin_capture_metrics_now() from public;
grant execute on function public.admin_capture_metrics_now() to authenticated;

------------------------------------------------------------------
-- 5. Daily cron at 00:05 + seed today immediately
------------------------------------------------------------------
do $$ begin
  perform cron.unschedule('capture_metrics_daily');
exception when others then null;   -- not scheduled yet → ignore
end $$;
select cron.schedule('capture_metrics_daily', '5 0 * * *', $$ select public.capture_metrics_daily(); $$);

select public.capture_metrics_daily();
