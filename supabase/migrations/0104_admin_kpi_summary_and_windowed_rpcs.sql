-- 0104_admin_kpi_summary_and_windowed_rpcs.sql
--
-- Analytics-tab rework (decision-making pass). Additive only.
--   1. admin_kpi_summary(p_days) — current-vs-previous window values for the
--      KPI strip metrics NOT already in metrics_daily (activation rate,
--      demo→paid rate, checkout success rate, WAU, cards created, signups).
--      MRR / signups / active trends keep coming from admin_metrics_history
--      (0101) + admin_stats (0102); this RPC does NOT redefine the MRR math.
--   2. Windowed overloads of the three all-time analytics RPCs so the global
--      time-range selector can scope them. The windowed overload takes a
--      *required* p_days (no default → no overload ambiguity with the existing
--      zero-arg signature); the original zero-arg function is re-pointed to
--      delegate with an ~all-time window so existing callers (e.g. the
--      Command Center's admin_activation_funnel()) keep working. The windowed
--      bodies also fold in 0102's "verified users only" predicate so the
--      Analytics numbers stay internally consistent with admin_stats.

------------------------------------------------------------------
-- 1. admin_kpi_summary — period-over-period KPI values.
--    window   = [now() - p_days,   now())
--    previous = [now() - 2*p_days, now() - p_days)
------------------------------------------------------------------
create or replace function public.admin_kpi_summary(p_days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_out     jsonb;
  v_now     timestamptz := now();
  v_cur_lo  timestamptz;
  v_prev_lo timestamptz;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  v_cur_lo  := v_now - (p_days || ' days')::interval;
  v_prev_lo := v_now - ((2 * p_days) || ' days')::interval;

  with
  -- Verified signups in the current+previous windows, carrying the flags we
  -- need for activation and demo→paid (first_card_at / first_paid_at can land
  -- any time after signup — this is a cohort rate, not a same-window event).
  signers as (
    select u.id, u.created_at, p.tier, p.first_card_at, p.first_paid_at
      from auth.users u
      join public.profiles p on p.user_id = u.id
     where u.email_confirmed_at is not null
       and u.created_at >= v_prev_lo
  ),
  -- Distinct checkout sessions per window (mirrors admin_event_funnel ord 8→9).
  ev as (
    select session_id, event, occurred_at
      from public.analytics_events
     where occurred_at >= v_prev_lo
       and event in ('checkout_open', 'checkout_success')
  ),
  -- Cards created per window (matches admin_cards_per_day: card_index.updated_at).
  cards as (
    select updated_at from public.card_index where updated_at >= v_prev_lo
  )
  select jsonb_build_object(
    'current', jsonb_build_object(
      'signups',          (select count(*) from signers where created_at >= v_cur_lo),
      'activated',        (select count(*) from signers where created_at >= v_cur_lo and first_card_at is not null),
      'activation_rate',  (select round(count(*) filter (where first_card_at is not null)::numeric
                                        / nullif(count(*), 0), 4)
                             from signers where created_at >= v_cur_lo),
      'demo_base',        (select count(*) from signers where created_at >= v_cur_lo and tier in ('demo','paid')),
      'converted',        (select count(*) from signers where created_at >= v_cur_lo and first_paid_at is not null),
      'demo_to_paid_rate',(select round(count(*) filter (where first_paid_at is not null)::numeric
                                        / nullif(count(*) filter (where tier in ('demo','paid')), 0), 4)
                             from signers where created_at >= v_cur_lo),
      'checkout_open',    (select count(distinct session_id) from ev where event='checkout_open'    and occurred_at >= v_cur_lo),
      'checkout_success', (select count(distinct session_id) from ev where event='checkout_success' and occurred_at >= v_cur_lo),
      'checkout_success_rate', (
        select round(
          (select count(distinct session_id) from ev where event='checkout_success' and occurred_at >= v_cur_lo)::numeric
          / nullif((select count(distinct session_id) from ev where event='checkout_open' and occurred_at >= v_cur_lo), 0), 4)),
      'wau',              (select count(distinct user_id) from public.user_active_day
                             where day >= (v_now - interval '7 days')::date and day <= v_now::date),
      'cards_created',    (select count(*) from cards where updated_at >= v_cur_lo)
    ),
    'previous', jsonb_build_object(
      'signups',          (select count(*) from signers where created_at >= v_prev_lo and created_at < v_cur_lo),
      'activated',        (select count(*) from signers where created_at >= v_prev_lo and created_at < v_cur_lo and first_card_at is not null),
      'activation_rate',  (select round(count(*) filter (where first_card_at is not null)::numeric
                                        / nullif(count(*), 0), 4)
                             from signers where created_at >= v_prev_lo and created_at < v_cur_lo),
      'demo_base',        (select count(*) from signers where created_at >= v_prev_lo and created_at < v_cur_lo and tier in ('demo','paid')),
      'converted',        (select count(*) from signers where created_at >= v_prev_lo and created_at < v_cur_lo and first_paid_at is not null),
      'demo_to_paid_rate',(select round(count(*) filter (where first_paid_at is not null)::numeric
                                        / nullif(count(*) filter (where tier in ('demo','paid')), 0), 4)
                             from signers where created_at >= v_prev_lo and created_at < v_cur_lo),
      'checkout_open',    (select count(distinct session_id) from ev where event='checkout_open'    and occurred_at >= v_prev_lo and occurred_at < v_cur_lo),
      'checkout_success', (select count(distinct session_id) from ev where event='checkout_success' and occurred_at >= v_prev_lo and occurred_at < v_cur_lo),
      'checkout_success_rate', (
        select round(
          (select count(distinct session_id) from ev where event='checkout_success' and occurred_at >= v_prev_lo and occurred_at < v_cur_lo)::numeric
          / nullif((select count(distinct session_id) from ev where event='checkout_open' and occurred_at >= v_prev_lo and occurred_at < v_cur_lo), 0), 4)),
      'wau',              (select count(distinct user_id) from public.user_active_day
                             where day >= (v_cur_lo - interval '7 days')::date and day < v_cur_lo::date),
      'cards_created',    (select count(*) from cards where updated_at >= v_prev_lo and updated_at < v_cur_lo)
    )
  ) into v_out;

  return v_out;
end;
$$;
revoke all on function public.admin_kpi_summary(int) from public;
grant execute on function public.admin_kpi_summary(int) to authenticated;

------------------------------------------------------------------
-- 2. Windowed overloads of the all-time analytics RPCs.
--    Pattern per RPC: define foo(p_days int) [required arg, no default];
--    re-point the original foo() to delegate with ~all-time (36500 days).
--    The inner windowed body runs _require_admin(), so the delegate is
--    protected even though the SQL wrapper has no explicit check.
------------------------------------------------------------------

-- 2a. Acquisition source — window on auth.users.created_at, verified only.
create or replace function public.admin_acquisition_breakdown(p_days int)
returns table(source text, signups int, converted int, conversion numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  return query
  with src as (
    select coalesce(nullif(p.first_source->>'utm_source', ''),
                    nullif(p.first_source->>'referrer', ''),
                    'direct') as source,
           p.first_paid_at is not null as paid
      from public.profiles p
      join auth.users u on u.id = p.user_id
     where u.email_confirmed_at is not null
       and u.created_at >= now() - (p_days || ' days')::interval
  )
  select source,
         count(*)::int as signups,
         sum(case when paid then 1 else 0 end)::int as converted,
         round(sum(case when paid then 1 else 0 end)::numeric / nullif(count(*), 0), 4) as conversion
    from src
   group by source
   order by signups desc;
end;
$$;
revoke all on function public.admin_acquisition_breakdown(int) from public;
grant execute on function public.admin_acquisition_breakdown(int) to authenticated;

create or replace function public.admin_acquisition_breakdown()
returns table(source text, signups int, converted int, conversion numeric)
language sql stable security definer set search_path = public as $$
  select * from public.admin_acquisition_breakdown(36500);
$$;
revoke all on function public.admin_acquisition_breakdown() from public;
grant execute on function public.admin_acquisition_breakdown() to authenticated;

-- 2b. Activation milestones — window on auth.users.created_at, verified only.
create or replace function public.admin_activation_funnel(p_days int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  with p as (
    select pr.*
      from public.profiles pr
      join auth.users u on u.id = pr.user_id
     where u.email_confirmed_at is not null
       and u.created_at >= now() - (p_days || ' days')::interval
  )
  select jsonb_build_object(
    'signed_up',      (select count(*) from p),
    'first_board',    (select count(*) from p where first_board_at    is not null),
    'first_card',     (select count(*) from p where first_card_at     is not null),
    'first_share',    (select count(*) from p where first_share_at    is not null),
    'first_backlink', (select count(*) from p where first_backlink_at is not null),
    'first_paid',     (select count(*) from p where first_paid_at     is not null)
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.admin_activation_funnel(int) from public;
grant execute on function public.admin_activation_funnel(int) to authenticated;

create or replace function public.admin_activation_funnel()
returns jsonb language sql stable security definer set search_path = public as $$
  select public.admin_activation_funnel(36500);
$$;
revoke all on function public.admin_activation_funnel() from public;
grant execute on function public.admin_activation_funnel() to authenticated;

-- 2c. Tier usage compare — window the user set on auth.users.created_at,
--     verified only. Aggregation logic preserved verbatim from 0071.
create or replace function public.admin_tier_usage_compare(p_days int)
returns table(
  tier         text,
  users        bigint,
  avg_cards    numeric,
  avg_boards   numeric,
  total_cards  bigint,
  total_boards bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  return query
  with user_stats as (
    select
      coalesce(p.tier, 'demo')::text as t_tier,
      u.id as user_id,
      coalesce((select count(*) from public.boards b where b.created_by = u.id), 0)::bigint as board_count,
      coalesce((select count(*) from public.card_index ci
                join public.boards b on b.id = ci.board_id
                where b.created_by = u.id), 0)::bigint as card_count
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    where u.email_confirmed_at is not null
      and u.created_at >= now() - (p_days || ' days')::interval
  )
  select
    t_tier                              as tier,
    count(*)::bigint                    as users,
    round(avg(card_count)::numeric, 1)  as avg_cards,
    round(avg(board_count)::numeric, 1) as avg_boards,
    sum(card_count)::bigint             as total_cards,
    sum(board_count)::bigint            as total_boards
  from user_stats
  group by t_tier
  order by case t_tier
    when 'admin'    then 1
    when 'paid'     then 2
    when 'demo'     then 3
    when 'waitlist' then 4
    else 5
  end;
end;
$$;
revoke all on function public.admin_tier_usage_compare(int) from public;
grant execute on function public.admin_tier_usage_compare(int) to authenticated;

create or replace function public.admin_tier_usage_compare()
returns table(
  tier         text,
  users        bigint,
  avg_cards    numeric,
  avg_boards   numeric,
  total_cards  bigint,
  total_boards bigint
)
language sql stable security definer set search_path = public as $$
  select * from public.admin_tier_usage_compare(36500);
$$;
revoke all on function public.admin_tier_usage_compare() from public;
grant execute on function public.admin_tier_usage_compare() to authenticated;
