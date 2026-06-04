-- 0117_admin_retention_curve_lifespan.sql
--
-- Retention graphs for the admin Engagement view: how long people stick around.
--
-- The existing admin_retention_cohorts (0110) powers a weekly cohort HEATMAP.
-- This adds two RPCs behind visual graphs:
--
--   1. admin_retention_curve  — a pooled retention CURVE: % of signed-up users
--      still active N days after signup, split into overall / demo / paid lines.
--   2. admin_user_lifespan    — distribution of how many active days each user
--      has accumulated (+ median), a "stickiness" view.
--
-- Both mirror admin_retention_cohorts' conventions exactly: _require_admin(),
-- security definer, set search_path, p_* clamping, internal-account exclusion via
-- _internal_user_ids(), grant to authenticated. Activity source is the same
-- public.user_active_day(user_id, day) the cohort RPC uses; signup day comes from
-- auth.users.created_at (verified users only).
--
-- OBSERVABLE-WINDOW ELIGIBILITY (the important bit): user_active_day only began
-- recording ~mid-May, but the earliest signups predate it. Counting a user's
-- pre-instrumentation days as "inactive" would bias retention toward 0. So a
-- (user, day_offset) is "eligible" only when its calendar day falls in
-- [v_track_start, current_date] — the window we could actually observe. As a
-- result, retention at a given tenure pools every user old enough to have reached
-- it within the tracked window, not a fixed signup cohort; the frontend clips the
-- curve to offsets with a trustworthy eligible count and labels it as a pooled
-- snapshot. Note: at day_offset 0, eligible counts only users who signed up on/after
-- v_track_start (earlier signups have no observable baseline). The tier split uses
-- CURRENT profiles.tier (matching admin_tier_usage_compare), so a demo→paid upgrader
-- counts as paid across their whole curve — the widget discloses "by current tier".

-- ── 1. Retention curve (pooled, by tier) ────────────────────────────────────
create or replace function public.admin_retention_curve(
  p_window_days integer default 30,
  p_exclude_internal boolean default true
)
returns table(segment text, day_offset integer, eligible integer, active integer, active_pct numeric)
language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_track_start date;
begin
  perform public._require_admin();
  p_window_days := greatest(1, least(p_window_days, 365));
  select min(day) into v_track_start from public.user_active_day;
  v_track_start := coalesce(v_track_start, current_date);
  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup_day,
           coalesce(p.tier, 'demo') as tier   -- CURRENT tier (shifts as users convert)
      from auth.users usr
      left join public.profiles p on p.user_id = usr.id
     where usr.email_confirmed_at is not null
       and (not p_exclude_internal or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  grid as (
    select u.user_id, u.tier, d.day_offset, (u.signup_day + d.day_offset) as cal_day
      from u
      cross join generate_series(0, p_window_days) as d(day_offset)
     where u.signup_day + d.day_offset <= current_date   -- the day has elapsed
       and u.signup_day + d.day_offset >= v_track_start  -- and was observable
  ),
  marked as (
    select g.day_offset, g.tier,
           exists (select 1 from public.user_active_day a
                    where a.user_id = g.user_id and a.day = g.cal_day) as is_active
      from grid g
  ),
  seg as (
    select 'all'::text as segment, m.day_offset, m.is_active from marked m
    union all
    select m.tier, m.day_offset, m.is_active from marked m where m.tier in ('demo', 'paid')
  )
  select s.segment, s.day_offset,
         count(*)::int as eligible,
         sum(case when s.is_active then 1 else 0 end)::int as active,
         round(sum(case when s.is_active then 1 else 0 end)::numeric / nullif(count(*), 0), 4) as active_pct
    from seg s
   group by s.segment, s.day_offset
   order by s.segment, s.day_offset;
end $function$;

revoke all on function public.admin_retention_curve(integer, boolean) from public;
grant execute on function public.admin_retention_curve(integer, boolean) to authenticated;

-- ── 2. Lifespan distribution (active-days per user) ─────────────────────────
create or replace function public.admin_user_lifespan(
  p_exclude_internal boolean default true
)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v jsonb;
begin
  perform public._require_admin();
  with per_user as (
    select u.id as user_id, count(distinct a.day) as active_days
      from auth.users u
      left join public.user_active_day a on a.user_id = u.id
     where u.email_confirmed_at is not null
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
     group by u.id
  ),
  bucketed as (
    select case
             when active_days <= 1  then '0–1'
             when active_days <= 2  then '2'
             when active_days <= 4  then '3–4'
             when active_days <= 7  then '5–7'
             when active_days <= 14 then '8–14'
             else '15+'
           end as label,
           case
             when active_days <= 1  then 1
             when active_days <= 2  then 2
             when active_days <= 4  then 3
             when active_days <= 7  then 4
             when active_days <= 14 then 5
             else 6
           end as ord
      from per_user
  )
  select jsonb_build_object(
    'total_users',        (select count(*) from per_user),
    'median_active_days', (select round(percentile_cont(0.5) within group (order by active_days)::numeric, 1) from per_user),
    'p90_active_days',    (select round(percentile_cont(0.9) within group (order by active_days)::numeric, 1) from per_user),
    'mean_active_days',   (select round(avg(active_days)::numeric, 1) from per_user),
    'buckets',            (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'ord', ord, 'users', n) order by ord), '[]'::jsonb)
                             from (select label, ord, count(*)::int as n from bucketed group by label, ord) b)
  ) into v;
  return v;
end $function$;

revoke all on function public.admin_user_lifespan(boolean) from public;
grant execute on function public.admin_user_lifespan(boolean) to authenticated;
