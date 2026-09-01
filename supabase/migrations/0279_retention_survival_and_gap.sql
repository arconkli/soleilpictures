-- 0279 — the retention read layer is calendar-indexed, and the problem is not.
--
-- Every retention function deployed here keys off days-since-signup:
-- admin_retention_curve (day_offset), admin_return_rate (D1/D7/D30),
-- admin_retention_cohort_matrix (weeks since), admin_habit_curve (days out of
-- 28). Every one of them answers "how much of a cohort is still alive on
-- calendar day N".
--
-- That framing hides the shape of this product's loss completely. Measured by
-- VISIT instead of by date — the chance of making visit N+1 given you reached
-- visit N — the curve is not a decay at all. The first step is far and away the
-- worst, and every step after it is roughly twice as good and still improving.
-- The loss is one broken door, not a leaky funnel, and no panel on the
-- dashboard could express that. It was found in an ad-hoc query and would have
-- had to be re-derived by hand every time anyone wanted to check it.
--
-- These two functions make it standing instrumentation.
--
-- ── ON CENSORING, WHICH THE AD-HOC VERSION GOT WRONG ────────────────────────
-- The naive form of this query is "count users with >= k active days, then
-- count those with >= k+1". It is wrong in a way that matters: a user whose
-- k-th visit was yesterday is counted as having failed to make visit k+1, when
-- really they have not had the chance yet. That is right-censoring, and it
-- deflates every step — worst at the deep steps, which have the freshest
-- members and the smallest denominators.
--
-- So the at-risk set is per-VISIT, not per-user: a user enters the denominator
-- for step k only once their k-th visit is at least p_grace_days old. Someone
-- can be at risk for step 1 and not yet for step 3. Both forms agree closely on
-- the first step, which is the one that matters, but only this one is honest
-- about the tail.
--
-- ── ON p_require_work, WHICH DEFAULTS THE OPPOSITE WAY TO 0278 ──────────────
-- user_active_day.did_work is FALSE for every row before work instrumentation
-- landed (0248) and cannot be backfilled. admin_retention_cohort_matrix defaults
-- p_require_work to true and marks the un-instrumented cells unmeasurable,
-- which works because that function is already a grid with a per-cell state.
--
-- A survival curve has nowhere to put that flag: it pools the entire history
-- into one number per step. Gating on work across the boundary would silently
-- return near-zero and read as catastrophic churn rather than as an absent
-- column. That trap has already been sprung once here — it is why 0277 wrote
-- the epoch into the table comment.
--
-- So this defaults to presence, and when work IS required it CLAMPS the cohort
-- start forward to the work floor rather than spanning it, and returns the
-- floor it used. You cannot accidentally ask this function a question it would
-- answer with a lie.

-- ── 1. Conditional survival — the chance of making the NEXT visit ───────────
create or replace function public.admin_survival_curve(
  -- Defaults to the waitlist-off boundary. Signups before it came through a
  -- gate that no longer exists and behave differently enough that pooling them
  -- with organic signups is its own contamination — the same split every other
  -- honest read of this data has had to make by hand.
  p_since date default '2026-06-16',
  p_grace_days int default 14,
  p_max_visits int default 10,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true,
  p_require_work boolean default false
)
returns table (
  visit int,
  reached int,
  continued int,
  pct numeric,
  since date,
  work_floor date
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_grace int  := least(greatest(coalesce(p_grace_days, 14), 0), 365);
  v_max   int  := least(greatest(coalesce(p_max_visits, 10), 2), 60);
  v_floor date := case
    when coalesce(p_require_work, false)
      then (select min(a.day) from public.user_active_day a where a.did_work)
    else null
  end;
  -- The clamp described in the header. When work is required, a cohort start
  -- earlier than the floor is moved forward rather than honoured, because the
  -- honoured version returns zeros that look like churn.
  v_since date := greatest(coalesce(p_since, '2026-06-16'::date),
                           coalesce(v_floor, '-infinity'::date));
begin
  perform public._require_admin();

  return query
  with u as (
    select usr.id as user_id
      from auth.users usr
     where usr.created_at >= v_since
       and (not p_verified_only
            or (usr.email_confirmed_at is not null and usr.last_sign_in_at is not null))
       and (not p_exclude_internal
            or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  -- Every active day, numbered. k is the visit ordinal: k=1 is the day they
  -- first showed up, which for almost everyone is signup day.
  v as (
    select a.user_id, a.day,
           row_number() over (partition by a.user_id order by a.day)::int as k
      from public.user_active_day a
      join u on u.user_id = a.user_id
     where (not p_require_work or a.did_work)
  ),
  -- At risk for step k only once visit k has had its grace period. This is the
  -- whole correction: the denominator is people who had a fair chance, not
  -- everyone who ever got that far.
  atrisk as (
    select v.k, v.user_id,
           exists (select 1 from v v2 where v2.user_id = v.user_id and v2.k = v.k + 1) as continued
      from v
     where v.day <= current_date - v_grace
       and v.k <= v_max
  )
  select a.k,
         count(*)::int,
         sum(a.continued::int)::int,
         round(sum(a.continued::int)::numeric / nullif(count(*), 0), 4),
         v_since,
         v_floor
    from atrisk a
   group by a.k
   order by a.k;
end $$;

revoke all on function public.admin_survival_curve(date, int, int, boolean, boolean, boolean)
  from public, anon;
grant execute on function public.admin_survival_curve(date, int, int, boolean, boolean, boolean)
  to authenticated;

comment on function public.admin_survival_curve(date, int, int, boolean, boolean, boolean) is
  'Conditional survival by VISIT, not by calendar day: P(reach visit k+1 | '
  'reached visit k). The one read that shows this product loses people at a '
  'single step rather than steadily — every calendar-indexed function here '
  '(admin_retention_curve, admin_return_rate, admin_retention_cohort_matrix) '
  'pools that away. The at-risk set is per-visit and grace-censored, so a user '
  'whose k-th visit was yesterday is not counted as having failed step k. '
  'p_require_work defaults FALSE and CLAMPS p_since forward to work_floor when '
  'true, because a pooled work-gated number spanning the did_work epoch reads '
  'as churn rather than as missing instrumentation. Admin only.';

-- ── 2. How long until the second visit ─────────────────────────────────────
-- The companion number, and the one that judges any timed intervention. Return
-- is overwhelmingly a next-day behaviour with a tail measured in days, not
-- weeks — which means anything that fires a week out is addressing a window
-- that has already closed. That fact has been carried in prose across several
-- passes and re-derived by hand each time; it belongs on the dashboard next to
-- the step it explains.
--
-- Buckets rather than percentiles: the actionable question is "does an
-- intervention at T+1 day reach most of them", and a p50 in days does not
-- answer it as directly as a cumulative share does.
create or replace function public.admin_return_gap(
  p_since date default '2026-06-16',
  p_exclude_internal boolean default true,
  p_verified_only boolean default true
)
returns table (
  bucket text,
  lo int,
  n int,
  pct numeric,
  cum_pct numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_since date := coalesce(p_since, '2026-06-16'::date);
begin
  perform public._require_admin();

  return query
  with u as (
    select usr.id as user_id
      from auth.users usr
     where usr.created_at >= v_since
       and (not p_verified_only
            or (usr.email_confirmed_at is not null and usr.last_sign_in_at is not null))
       and (not p_exclude_internal
            or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  v as (
    select a.user_id, a.day,
           row_number() over (partition by a.user_id order by a.day)::int as k
      from public.user_active_day a
      join u on u.user_id = a.user_id
  ),
  -- Only people who HAVE a second visit. This is deliberately the distribution
  -- of the gap among returners, not a survival function over everyone: the
  -- question it answers is "when do the ones who come back, come back", which
  -- is what an intervention has to be timed against.
  gaps as (
    select (v2.day - v1.day)::int as g
      from v v1
      join v v2 on v2.user_id = v1.user_id and v2.k = 2
     where v1.k = 1
  ),
  binned as (
    select case
             when g <= 1  then 'next day'
             when g <= 3  then '2-3 days'
             when g <= 7  then '4-7 days'
             when g <= 14 then '8-14 days'
             when g <= 30 then '15-30 days'
             else '31+ days'
           end as bucket,
           case
             when g <= 1 then 1 when g <= 3 then 2 when g <= 7 then 4
             when g <= 14 then 8 when g <= 30 then 15 else 31
           end as lo
      from gaps
  ),
  counted as (
    select b.bucket, b.lo, count(*)::int as n from binned b group by b.bucket, b.lo
  )
  select c.bucket, c.lo, c.n,
         round(c.n::numeric / nullif(sum(c.n) over (), 0), 4),
         round(sum(c.n) over (order by c.lo)::numeric / nullif(sum(c.n) over (), 0), 4)
    from counted c
   order by c.lo;
end $$;

revoke all on function public.admin_return_gap(date, boolean, boolean)
  from public, anon;
grant execute on function public.admin_return_gap(date, boolean, boolean)
  to authenticated;

comment on function public.admin_return_gap(date, boolean, boolean) is
  'Distribution of the gap between visit 1 and visit 2, among users who made a '
  'second visit. The number any timed intervention has to be judged against: '
  'return here is dominated by the first day or two, so a nudge sent a week out '
  'is aimed at a window that has closed. Deliberately conditioned on returning '
  '— it describes WHEN returners return, not whether they do (that is '
  'admin_survival_curve step 1). Admin only.';
