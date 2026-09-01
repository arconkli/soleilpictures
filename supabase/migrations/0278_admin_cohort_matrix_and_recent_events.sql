-- 0278 — two read-only admin RPCs the instrument deck needs.
--
-- Both exist because the closest deployed function is subtly wrong for the job,
-- not because nothing was close.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 1. admin_retention_cohort_matrix
--
-- admin_retention_cohorts (0149) already returns a cohort matrix, and it cannot
-- be used here for two independent reasons:
--
--   * It is cohort_week x DAY_OFFSET — up to 60 daily columns. Daily retention
--     at 25-51 people per cohort is noise: a user active on day 3 and not day 4
--     has not churned, they had a Tuesday. And the roll-up cannot be done on
--     the client, because active_n is a DISTINCT USER COUNT per day. Summing
--     seven of those double-counts anyone who came back twice that week.
--     Weekly distinctness has to be computed here or not at all.
--
--   * It has no p_require_work. Roughly half of user_active_day rows contain no
--     work event, so a cohort chart built on presence disagrees by ~2x with the
--     habit curve and the return rate sitting inches away from it on the same
--     screen. That disagreement is exactly what the 0250 work parameter was
--     added to end; this function defaults it to TRUE.
--
-- The other thing it does differently: it ZERO-FILLS ONLY THE CELLS A COHORT
-- HAS ACTUALLY REACHED. Last week's cohort has one column, not thirteen.
-- Emitting the unreached weeks as 0% is the classic cohort-chart lie — it draws
-- a cliff that is really just the future — so those rows are absent and the
-- client leaves them blank.
--
-- AND A THIRD CELL STATE, which building this chart is what surfaced:
--
--   user_active_day.did_work has been FALSE FOR EVERY ROW before 2026-08-17.
--   0248 added the column and said so in its own header — "did_work cannot be
--   backfilled. Rows before this migration stay false, which is honest: we do
--   not know." That is the right call and this migration does not overturn it.
--
--   But it means a work-gated cohort matrix reads 0% in WEEK ZERO for every
--   cohort older than mid-August, which is impossible — you cannot sign up and
--   not be present in your own first week. Drawn as zeros it is a fabricated
--   churn cliff, which is the same lie as the unreached triangle wearing a
--   different hat.
--
--   So every cell carries `measurable`. A week that began before work tracking
--   did is returned with a NULL percentage, and the client hatches it. Absent
--   means "hasn't happened yet"; zero means "measured, nobody came back";
--   NULL means "we were not counting". Three states, because there are three.
--
--   This is not only a new-chart problem. admin_return_rate is already called
--   with p_require_work at D30 and admin_habit_curve over 28 days, both of
--   which cross the same boundary — the deck captions the date wherever a
--   work-gated number spans it.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 2. admin_recent_events
--
-- The live console is push-based over the realtime channel that useActivityPulse
-- already holds open, so this is called ONCE, to backfill. Without it the
-- console is empty on open and fills at roughly one row every two minutes,
-- which reads as broken rather than as quiet.
--
-- Deliberately not a view of everything: a hard limit, newest first, riding the
-- (occurred_at desc) index added in 0273.

-- ── 1. Weekly cohort retention matrix ──────────────────────────────────────
create or replace function public.admin_retention_cohort_matrix(
  p_weeks int default 13,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true,
  p_require_work boolean default true
)
returns table (
  cohort_week date,
  week_offset int,
  cohort_size int,
  active_n int,
  active_pct numeric,
  measurable boolean,
  work_floor date
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_weeks int := least(greatest(coalesce(p_weeks, 13), 1), 52);
  v_first date := date_trunc('week', now())::date - ((v_weeks - 1) * 7);
  -- The first day work was ever recorded. Derived rather than hardcoded so it
  -- stays true if the column is ever backfilled; null (and therefore no floor)
  -- when work gating is off, because presence has been tracked all along.
  v_floor date := case
    when coalesce(p_require_work, true)
      then (select min(a.day) from public.user_active_day a where a.did_work)
    else null
  end;
begin
  perform public._require_admin();

  return query
  with cohorts as (
    select date_trunc('week', u.created_at)::date as cohort_week,
           u.id as user_id
      from auth.users u
     where u.created_at >= v_first
       and (not p_verified_only
            or (u.email_confirmed_at is not null and u.last_sign_in_at is not null))
       and (not p_exclude_internal
            or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  sizes as (
    select c.cohort_week, count(*)::int as cohort_size
      from cohorts c group by c.cohort_week
  ),
  -- One row per (cohort, week it has lived through). generate_series stops at
  -- the current week, so the unreached upper triangle is never emitted.
  grid as (
    select s.cohort_week, s.cohort_size, g.week_offset,
           -- A week that STARTED before work tracking did is unknown, not
           -- empty. A week straddling the boundary counts as unknown too: a
           -- partially-instrumented week under-reports, and an under-report
           -- drawn as a measurement is the thing being avoided here.
           (v_floor is null or (s.cohort_week + (g.week_offset * 7)) >= v_floor) as measurable
      from sizes s
      cross join lateral generate_series(
        0, greatest(0, ((current_date - s.cohort_week) / 7)::int)
      ) as g(week_offset)
  ),
  act as (
    select c.cohort_week,
           ((a.day - c.cohort_week) / 7)::int as week_offset,
           count(distinct c.user_id)::int     as active_n
      from cohorts c
      join public.user_active_day a on a.user_id = c.user_id
     where a.day >= c.cohort_week
       and (not p_require_work or a.did_work)
     group by 1, 2
  )
  select g.cohort_week,
         g.week_offset,
         g.cohort_size,
         -- Zero, not null, when the week is measurable and nobody came back —
         -- that is a real finding. Null only when we were not counting.
         case when g.measurable then coalesce(x.active_n, 0)::int else 0 end,
         case when g.measurable
              then round(coalesce(x.active_n, 0)::numeric / nullif(g.cohort_size, 0), 4)
              else null end,
         g.measurable,
         v_floor
    from grid g
    left join act x
      on x.cohort_week = g.cohort_week
     and x.week_offset = g.week_offset
   order by g.cohort_week desc, g.week_offset asc;
end $$;

revoke all on function public.admin_retention_cohort_matrix(int, boolean, boolean, boolean)
  from public, anon;
grant execute on function public.admin_retention_cohort_matrix(int, boolean, boolean, boolean)
  to authenticated;

comment on function public.admin_retention_cohort_matrix(int, boolean, boolean, boolean) is
  'Weekly signup cohort x weeks-since-signup retention matrix. Distinctness is '
  'computed per WEEK here because a daily matrix cannot be rolled up on the '
  'client without double-counting. Defaults to work-days only, so it agrees '
  'with admin_habit_curve and admin_return_rate rather than inheriting '
  'user_active_day''s ~2x presence over-count. Three cell states, because there '
  'are three: absent = not reached yet, 0 = measured and nobody returned, '
  'null with measurable=false = the week predates did_work instrumentation '
  '(see work_floor) and we were not counting. Admin only.';

-- ── 2. Recent raw events, for the live console's backfill ──────────────────
create or replace function public.admin_recent_events(
  p_limit int default 40,
  p_exclude_internal boolean default true
)
returns table (
  id uuid,
  event text,
  occurred_at timestamptz,
  user_id uuid,
  email text,
  path text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 40), 1), 200);
begin
  perform public._require_admin();

  return query
  select e.id, e.event, e.occurred_at, e.user_id, u.email::text, e.path
    from public.analytics_events e
    left join auth.users u on u.id = e.user_id
   where (not p_exclude_internal
          or ((e.user_id is null
               or e.user_id not in (select iu.user_id from public._internal_user_ids() iu))
              and (e.session_id is null
                   or e.session_id not in (select isid.session_id from public._internal_session_ids() isid))))
   order by e.occurred_at desc
   limit v_limit;
end $$;

revoke all on function public.admin_recent_events(int, boolean) from public, anon;
grant execute on function public.admin_recent_events(int, boolean) to authenticated;

comment on function public.admin_recent_events(int, boolean) is
  'Newest raw analytics events, capped. Called ONCE to seed the live console; '
  'everything after it arrives by realtime push, so this is not a polling '
  'endpoint. Admin only.';
