-- 0110_admin_internal_exclusion.sql
--
-- Exclude internal / founder / test traffic from the admin product metrics,
-- and make it a toggle: every analytics RPC gains a trailing
-- `p_exclude_internal boolean DEFAULT true` so exclusion is the new normal
-- while the dashboard can still flip to a raw, internal-inclusive view.
--
-- WHY: ~44% of analytics_events are internal. Five internal accounts produced
-- 7 sessions / 546 events, including the ONLY checkout_success in the dataset
-- (the founder's own demo account, arconkli@gmail.com, testing checkout). So
-- product numbers are poisoned today. tier='admin' alone is NOT sufficient —
-- the founder's test account is tier='demo' — so we keep an explicit
-- internal_accounts allowlist UNIONed with the admin tier, and exclude at the
-- SESSION level: any session that ever resolved to an internal user is internal
-- for its whole lifetime (this catches pre-auth landing_view rows whose
-- user_id is null but whose session later authenticates as an internal user).
--
-- Every function below changes arg count (adds the new param), so each is
-- DROP-then-CREATE to avoid leaving an ambiguous overload (42725). All client
-- call sites use named-arg objects, so the new defaulted param is transparent.

-- ── Part A: identification ──────────────────────────────────────────

create table if not exists public.internal_accounts (
  user_id  uuid primary key references auth.users on delete cascade,
  reason   text,
  added_at timestamptz not null default now()
);
alter table public.internal_accounts enable row level security;
drop policy if exists internal_accounts_admin_all on public.internal_accounts;
create policy internal_accounts_admin_all on public.internal_accounts
  for all to authenticated
  using      (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.tier = 'admin'))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.tier = 'admin'));

-- internal = admin-tier UNION the explicit allowlist.
create or replace function public._internal_user_ids()
returns table(user_id uuid)
language sql stable security definer set search_path to 'public' as $$
  select p.user_id from public.profiles p where p.tier = 'admin'
  union
  select ia.user_id from public.internal_accounts ia;
$$;

-- any session that ever resolved to an internal user (covers pre-auth rows).
create or replace function public._internal_session_ids()
returns table(session_id uuid)
language sql stable security definer set search_path to 'public' as $$
  select distinct e.session_id
  from public.analytics_events e
  where e.session_id is not null
    and e.user_id in (select iu.user_id from public._internal_user_ids() iu);
$$;

-- These are internal helpers, called only from the SECURITY DEFINER RPCs below
-- (which run as the owner and so can call them regardless of grants). Not
-- exposed to authenticated/anon so the internal-account set can't be enumerated.
revoke all on function public._internal_user_ids()    from public;
revoke all on function public._internal_session_ids() from public;
grant execute on function public._internal_user_ids()    to service_role;
grant execute on function public._internal_session_ids() to service_role;

-- Seed the founder demo + the Chris test accounts. (admin-tier accounts are
-- already covered by the UNION in _internal_user_ids, so we only need the
-- non-admin testers here.)
insert into public.internal_accounts (user_id, reason)
select u.id, 'founder/test'
  from auth.users u
 where lower(u.email) = 'arconkli@gmail.com'
    or lower(u.email) like 'pchristopher%@gmail.com'
on conflict (user_id) do nothing;

-- ── Part B: per-RPC exclusion toggle ────────────────────────────────

-- admin_signup_funnel — session-based; filter the ev CTE.
drop function if exists public.admin_signup_funnel(integer, text, text, text);
create or replace function public.admin_signup_funnel(
  p_days integer DEFAULT 30,
  p_source text DEFAULT NULL::text,
  p_campaign text DEFAULT NULL::text,
  p_content text DEFAULT NULL::text,
  p_exclude_internal boolean DEFAULT true)
 RETURNS TABLE(ord integer, step text, label text, branch text, sessions bigint, users bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_since timestamptz := now() - (greatest(1, least(p_days, 365)) || ' days')::interval;
  v_src   text := nullif(trim(coalesce(p_source,   '')), '');
  v_camp  text := nullif(trim(coalesce(p_campaign, '')), '');
  v_cont  text := nullif(trim(coalesce(p_content,  '')), '');
begin
  perform public._require_admin();

  return query
  with
  ev as (
    select e.session_id, e.user_id, e.event, e.props, e.occurred_at
    from public.analytics_events e
    where e.occurred_at >= v_since
      and e.session_id is not null
      and (not p_exclude_internal
           or e.session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  sessions_all as (
    select distinct session_id from ev
  ),
  attr_src as (
    select distinct on (e.session_id)
      e.session_id,
      e.props->>'utm_source'   as src,
      e.props->>'utm_campaign' as campaign,
      e.props->>'utm_content'  as content
    from ev e
    where e.props->>'utm_source' is not null
    order by e.session_id, e.occurred_at asc
  ),
  sess_user as (
    select distinct on (session_id) session_id, user_id
    from ev
    where user_id is not null
    order by session_id, occurred_at desc
  ),
  attr as (
    select s.session_id,
      coalesce(a.src,      pr.first_source->>'utm_source')   as src,
      coalesce(a.campaign, pr.first_source->>'utm_campaign') as campaign,
      coalesce(a.content,  pr.first_source->>'utm_content')  as content
    from sessions_all s
    left join attr_src a        on a.session_id = s.session_id
    left join sess_user su      on su.session_id = s.session_id
    left join public.profiles pr on pr.user_id = su.user_id
  ),
  sel as (
    select a.session_id
    from attr a
    where (v_src  is null or lower(a.src)      = lower(v_src))
      and (v_camp is null or lower(a.campaign) = lower(v_camp))
      and (v_cont is null or a.content         = v_cont)
  ),
  steps(ord, step, label, branch) as (
    values
      (1,  'landing_view',        'Landing view',           'core'),
      (2,  'email_submit',        'Email submitted',        'core'),
      (3,  'otp_verify',          'OTP verified (account)', 'core'),
      (4,  'welcome_view',        'Welcome page',           'core'),
      (5,  'submit_socials_open', 'Opened waitlist form',   'waitlist'),
      (6,  'submit_socials_done', 'Joined waitlist',        'waitlist'),
      (7,  'pricing_view',        'Viewed pricing',         'pricing'),
      (8,  'checkout_open',       'Opened checkout',        'pricing'),
      (9,  'checkout_success',    'Completed payment',      'pricing'),
      (20, 'email_submit_error',  'Email submit failed',    'leak'),
      (21, 'otp_verify_error',    'OTP verify failed',      'leak'),
      (22, 'waitlist_abandon',    'Abandoned waitlist form','leak'),
      (23, 'pricing_abandon',     'Abandoned pricing',      'leak'),
      (24, 'checkout_error',      'Checkout failed',        'leak')
  ),
  counts as (
    select e.event,
           count(distinct e.session_id) as sessions,
           count(distinct e.user_id)    as users
    from ev e
    join sel on sel.session_id = e.session_id
    group by e.event
  )
  select st.ord, st.step, st.label, st.branch,
         coalesce(c.sessions, 0)::bigint as sessions,
         coalesce(c.users,    0)::bigint as users
  from steps st
  left join counts c on c.event = st.step
  order by st.ord;
end $function$;
revoke all on function public.admin_signup_funnel(integer, text, text, text, boolean) from public;
grant execute on function public.admin_signup_funnel(integer, text, text, text, boolean) to authenticated;

-- admin_funnel_segments — session-based; filter the ev CTE.
drop function if exists public.admin_funnel_segments(integer);
create or replace function public.admin_funnel_segments(
  p_days integer DEFAULT 30,
  p_exclude_internal boolean DEFAULT true)
 RETURNS TABLE(dim text, value text, sessions bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_since timestamptz := now() - (greatest(1, least(p_days, 365)) || ' days')::interval;
begin
  perform public._require_admin();
  return query
  with ev as (
    select e.session_id, e.props
    from public.analytics_events e
    where e.occurred_at >= v_since
      and e.session_id is not null
      and (not p_exclude_internal
           or e.session_id not in (select isess.session_id from public._internal_session_ids() isess))
  )
  select 'source'::text,   ev.props->>'utm_source',   count(distinct ev.session_id)::bigint
    from ev where ev.props->>'utm_source'   is not null group by 2
  union all
  select 'campaign'::text, ev.props->>'utm_campaign', count(distinct ev.session_id)::bigint
    from ev where ev.props->>'utm_campaign' is not null group by 2
  union all
  select 'content'::text,  ev.props->>'utm_content',  count(distinct ev.session_id)::bigint
    from ev where ev.props->>'utm_content'  is not null group by 2
  order by 1, 3 desc;
end $function$;
revoke all on function public.admin_funnel_segments(integer, boolean) from public;
grant execute on function public.admin_funnel_segments(integer, boolean) to authenticated;

-- admin_event_funnel — session-based; filter the ev CTE.
drop function if exists public.admin_event_funnel(integer);
create or replace function public.admin_event_funnel(
  p_days integer DEFAULT 30,
  p_exclude_internal boolean DEFAULT true)
 RETURNS TABLE(event text, sessions bigint, users bigint, ord integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  return query
  with ev as (
    select * from public.analytics_events
    where occurred_at >= now() - (p_days || ' days')::interval
      and (not p_exclude_internal
           or session_id is null
           or session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  stages(event, ord) as (
    values
      ('landing_view',         1),
      ('email_submit',         2),
      ('otp_verify',           3),
      ('welcome_view',         4),
      ('submit_socials_open',  5),
      ('submit_socials_done',  6),
      ('pricing_view',         7),
      ('checkout_open',        8),
      ('checkout_success',     9),
      ('app_open',            10)
  )
  select s.event,
         count(distinct ev.session_id) as sessions,
         count(distinct ev.user_id)    as users,
         s.ord
  from stages s
  left join ev on ev.event = s.event
  group by s.event, s.ord
  order by s.ord;
end;
$function$;
revoke all on function public.admin_event_funnel(integer, boolean) from public;
grant execute on function public.admin_event_funnel(integer, boolean) to authenticated;

-- admin_event_breakdown — session-based; filter the ev CTE.
drop function if exists public.admin_event_breakdown(integer);
create or replace function public.admin_event_breakdown(
  p_days integer DEFAULT 30,
  p_exclude_internal boolean DEFAULT true)
 RETURNS TABLE(event text, sessions bigint, users bigint, total bigint, ord integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  return query
  with ev as (
    select * from public.analytics_events
    where occurred_at >= now() - (p_days || ' days')::interval
      and (not p_exclude_internal
           or session_id is null
           or session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  curated(event, ord) as (
    values
      ('email_submit_error',     1),
      ('otp_verify_error',       2),
      ('landing_callback_error', 3),
      ('landing_edit_email',     4),
      ('landing_explore_click',  5),
      ('welcome_cta',            6),
      ('waitlist_abandon',       7),
      ('waitlist_plan_toggle',   8),
      ('waitlist_subscribe_cta', 9),
      ('pricing_plan_toggle',   10),
      ('pricing_demo_cta',      11),
      ('pricing_creator_intent',12),
      ('pricing_abandon',       13),
      ('checkout_error',        14),
      ('billing_portal_error',  15),
      ('checkout_stalled',      16),
      ('checkout_verify_retry', 17),
      ('checkout_missing_session',18),
      ('checkout_support_click',19)
  )
  select c.event,
         count(distinct ev.session_id) as sessions,
         count(distinct ev.user_id)    as users,
         count(ev.*)                   as total,
         c.ord
  from curated c
  left join ev on ev.event = c.event
  group by c.event, c.ord
  order by c.ord;
end;
$function$;
revoke all on function public.admin_event_breakdown(integer, boolean) from public;
grant execute on function public.admin_event_breakdown(integer, boolean) to authenticated;

-- admin_checkout_reliability — session-based; filter the ev CTE.
drop function if exists public.admin_checkout_reliability(integer);
create or replace function public.admin_checkout_reliability(
  p_days integer DEFAULT 30,
  p_exclude_internal boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare v_out jsonb;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));

  with ev as (
    select * from public.analytics_events
    where occurred_at >= now() - (p_days || ' days')::interval
      and (not p_exclude_internal
           or session_id is null
           or session_id not in (select isess.session_id from public._internal_session_ids() isess))
  )
  select jsonb_build_object(
    'success_views',   (select count(distinct session_id) from ev where event = 'checkout_success'),
    'activated',       (select count(distinct session_id) from ev where event = 'checkout_activated_seen'),
    'stalled',         (select count(distinct session_id) from ev where event = 'checkout_stalled'),
    'verify_retry',    (select count(distinct session_id) from ev where event = 'checkout_verify_retry'),
    'missing_session', (select count(distinct session_id) from ev where event = 'checkout_missing_session'),
    'verify_failed',   (select count(distinct session_id) from ev
                          where event = 'checkout_verify_result' and props->>'result' = 'failed'),
    'support_clicks',  (select count(*) from ev where event = 'checkout_support_click')
  ) into v_out;

  return v_out;
end;
$function$;
revoke all on function public.admin_checkout_reliability(integer, boolean) from public;
grant execute on function public.admin_checkout_reliability(integer, boolean) to authenticated;

-- admin_kpi_summary — mixed; filter signers (user), ev (session), cards (owner via boards), wau (user).
drop function if exists public.admin_kpi_summary(integer);
create or replace function public.admin_kpi_summary(
  p_days integer DEFAULT 30,
  p_exclude_internal boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
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
  signers as (
    select u.id, u.created_at, p.tier, p.first_card_at, p.first_paid_at
      from auth.users u
      join public.profiles p on p.user_id = u.id
     where u.email_confirmed_at is not null
       and u.created_at >= v_prev_lo
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  ev as (
    select session_id, event, occurred_at
      from public.analytics_events
     where occurred_at >= v_prev_lo
       and event in ('checkout_open', 'checkout_success')
       and (not p_exclude_internal
            or session_id is null
            or session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  cards as (
    select ci.updated_at
      from public.card_index ci
      left join public.boards b on b.id = ci.board_id
     where ci.updated_at >= v_prev_lo
       and (not p_exclude_internal
            or b.created_by is null
            or b.created_by not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  wau as (
    select day, user_id
      from public.user_active_day
     where (not p_exclude_internal or user_id not in (select iu.user_id from public._internal_user_ids() iu))
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
      'wau',              (select count(distinct user_id) from wau
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
      'wau',              (select count(distinct user_id) from wau
                             where day >= (v_cur_lo - interval '7 days')::date and day < v_cur_lo::date),
      'cards_created',    (select count(*) from cards where updated_at >= v_prev_lo and updated_at < v_cur_lo)
    )
  ) into v_out;

  return v_out;
end;
$function$;
revoke all on function public.admin_kpi_summary(integer, boolean) from public;
grant execute on function public.admin_kpi_summary(integer, boolean) to authenticated;

-- admin_activation_funnel — user-based; filter the p CTE. Recreate the no-arg
-- delegator so its 1-arg call resolves to the new (integer, boolean) version.
drop function if exists public.admin_activation_funnel(integer);
create or replace function public.admin_activation_funnel(
  p_days integer,
  p_exclude_internal boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
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
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
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
$function$;
revoke all on function public.admin_activation_funnel(integer, boolean) from public;
grant execute on function public.admin_activation_funnel(integer, boolean) to authenticated;

create or replace function public.admin_activation_funnel()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.admin_activation_funnel(36500);
$function$;

-- admin_retention_cohorts — user-based; filter the cohorts CTE.
drop function if exists public.admin_retention_cohorts(integer);
create or replace function public.admin_retention_cohorts(
  p_window_days integer DEFAULT 60,
  p_exclude_internal boolean DEFAULT true)
 RETURNS TABLE(cohort_week date, day_offset integer, cohort_size integer, active_n integer, active_pct numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_window_days := greatest(1, least(p_window_days, 365));
  return query
  with cohorts as (
    select date_trunc('week', u.created_at)::date as cohort_week, u.id as user_id
      from auth.users u
     where u.created_at >= now() - (p_window_days || ' days')::interval
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  sizes as (
    select cohort_week, count(*)::int as cohort_size from cohorts group by cohort_week
  ),
  matrix as (
    select c.cohort_week, (a.day - c.cohort_week)::int as day_offset, count(distinct c.user_id)::int as active_n
      from cohorts c
      join public.user_active_day a on a.user_id = c.user_id
     where a.day >= c.cohort_week and a.day < c.cohort_week + p_window_days
     group by c.cohort_week, (a.day - c.cohort_week)
  )
  select m.cohort_week, m.day_offset, s.cohort_size, m.active_n,
         round(m.active_n::numeric / nullif(s.cohort_size, 0), 4) as active_pct
    from matrix m join sizes s using (cohort_week)
   order by m.cohort_week desc, m.day_offset asc;
end $function$;
revoke all on function public.admin_retention_cohorts(integer, boolean) from public;
grant execute on function public.admin_retention_cohorts(integer, boolean) to authenticated;

-- admin_tier_usage_compare — user-based; filter user_stats. Recreate no-arg delegator.
drop function if exists public.admin_tier_usage_compare(integer);
create or replace function public.admin_tier_usage_compare(
  p_days integer,
  p_exclude_internal boolean DEFAULT true)
 RETURNS TABLE(tier text, users bigint, avg_cards numeric, avg_boards numeric, total_cards bigint, total_boards bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
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
      and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
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
$function$;
revoke all on function public.admin_tier_usage_compare(integer, boolean) from public;
grant execute on function public.admin_tier_usage_compare(integer, boolean) to authenticated;

create or replace function public.admin_tier_usage_compare()
 RETURNS TABLE(tier text, users bigint, avg_cards numeric, avg_boards numeric, total_cards bigint, total_boards bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from public.admin_tier_usage_compare(36500);
$function$;

-- admin_top_users — user-based; filter the auth.users scan.
drop function if exists public.admin_top_users(text, integer);
create or replace function public.admin_top_users(
  p_tier text DEFAULT NULL::text,
  p_limit integer DEFAULT 20,
  p_exclude_internal boolean DEFAULT true)
 RETURNS TABLE(user_id uuid, email text, tier text, card_count bigint, board_count bigint, created_at timestamp with time zone, last_sign_in_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare v_t text := nullif(trim(coalesce(p_tier, '')), '');
begin
  perform public._require_admin();
  p_limit := greatest(1, least(p_limit, 100));
  return query
  select
    u.id                                    as user_id,
    u.email::text                           as email,
    coalesce(p.tier, 'demo')::text          as tier,
    coalesce(stats.card_count, 0)::bigint   as card_count,
    coalesce(stats.board_count, 0)::bigint  as board_count,
    u.created_at                            as created_at,
    u.last_sign_in_at                       as last_sign_in_at
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  left join lateral (
    select
      (select count(*) from public.boards b where b.created_by = u.id) as board_count,
      (select count(*) from public.card_index ci
         join public.boards b on b.id = ci.board_id
         where b.created_by = u.id) as card_count
  ) stats on true
  where (v_t is null or coalesce(p.tier, 'demo') = v_t)
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  order by stats.card_count desc nulls last
  limit p_limit;
end;
$function$;
revoke all on function public.admin_top_users(text, integer, boolean) from public;
grant execute on function public.admin_top_users(text, integer, boolean) to authenticated;

-- admin_cards_per_day — route through boards.created_by to know the owner, then
-- exclude internal-owned cards. LEFT JOIN keeps orphan cards (no board) intact.
drop function if exists public.admin_cards_per_day(integer);
create or replace function public.admin_cards_per_day(
  p_days integer DEFAULT 30,
  p_exclude_internal boolean DEFAULT true)
 RETURNS TABLE(day date, cards integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  return query
  select d::date as day, coalesce(c.n, 0)::int as cards
  from generate_series(
    current_date - (p_days - 1),
    current_date,
    '1 day'::interval
  ) d
  left join (
    select date_trunc('day', ci.updated_at)::date as day, count(*)::int as n
    from public.card_index ci
    left join public.boards b on b.id = ci.board_id
    where ci.updated_at >= (current_date - (p_days - 1))::timestamptz
      and (not p_exclude_internal
           or b.created_by is null
           or b.created_by not in (select iu.user_id from public._internal_user_ids() iu))
    group by 1
  ) c on c.day = d::date
  order by day asc;
end;
$function$;
revoke all on function public.admin_cards_per_day(integer, boolean) from public;
grant execute on function public.admin_cards_per_day(integer, boolean) to authenticated;
