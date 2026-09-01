-- 0281 — the first session of someone who came back, against the first session
-- of someone who did not.
--
-- This comparison has never been run, and every byte it needs has been sitting
-- in analytics_events the whole time. The great majority of both the
-- one-and-done population and the returning population have a full traced first
-- session recorded. Nothing aggregates them by OUTCOME:
-- admin_journey_dropoff pools everyone together, and AdminUserJourneys reads
-- one person at a time. So "what does a session that leads nowhere actually
-- look like" has been answerable and unanswered.
--
-- It is also the closest thing to a reason we can get without asking. Behaviour
-- cannot say why someone decided the product was not for them, but it can say
-- what their last few minutes were made of, and that is a far better starting
-- point than the current one, which is nothing.
--
-- ── THREE THINGS THIS HAS TO GET RIGHT ──────────────────────────────────────
--
-- 1. NEVER-BOOTED USERS ARE EXCLUDED. They have no first session. Leaving them
--    in drags every median toward zero for a reason that has nothing to do with
--    what happened inside the product, and makes the one-and-done group look
--    far more inert than it is.
--
-- 2. MEDIANS, NOT MEANS. One tab left open overnight moves a mean by minutes.
--    The distribution here is long-tailed at both ends.
--
-- 3. EVERY SHARE CARRIES THE DATE ITS SIGNAL BEGAN. Several of the surfaces
--    worth asking about are YOUNGER THAN THE COHORT — the empty-board panel and
--    the add-more dock among them. Measured naively they return 0% for both
--    groups, which reads as "this never happens" and means "nothing was
--    recording it yet". That is the exact failure 0277 had to write into the
--    table comments after it cost an analysis.
--
--    The first version of this function guarded that with an inner join and
--    introduced a THIRD failure mode: the metric matched nobody and vanished
--    from the panel altogether, which reads as "we never thought to measure
--    this". The join is now outer, so an unmeasurable metric returns n=0 beside
--    the date it started, and the caller says so in as many words.
--
-- ── THE CONFOUND WARNING APPLIES HERE TOO ───────────────────────────────────
-- These are UNADJUSTED comparisons between two groups that differ in depth as
-- well as in outcome, so the same trap 0280 exists to defuse is live in this
-- table. "Hit an error" in particular reads backwards here for exactly that
-- reason. Read a difference here as a place to look, and take the verdict from
-- admin_return_predictors, which stratifies. The panel says so on its face.

create or replace function public.admin_first_session_compare(
  p_since date default '2026-06-16',
  p_min_age_days int default 14,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true
)
returns table (
  metric text,
  kind text,
  ord int,
  measured_from date,
  returned_n int,
  returned_val numeric,
  oneshot_n int,
  oneshot_val numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_age int := least(greatest(coalesce(p_min_age_days, 14), 0), 365);
  v_since date := coalesce(p_since, '2026-06-16'::date);
begin
  perform public._require_admin();

  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup
      from auth.users usr
     where usr.created_at >= v_since
       and usr.created_at < now() - (v_age || ' days')::interval
       and (not p_verified_only
            or (usr.email_confirmed_at is not null and usr.last_sign_in_at is not null))
       and (not p_exclude_internal
            or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  outcome as (
    select u.user_id, u.signup,
           count(distinct a.day) as days,
           (count(distinct a.day) > 1) as returned
      from u
      left join public.user_active_day a on a.user_id = u.user_id
     group by u.user_id, u.signup
  ),
  -- No first session means nothing to autopsy. Including these users would pull
  -- every median toward zero for reasons outside the product entirely.
  pop as (select o.user_id, o.signup, o.returned from outcome o where o.days > 0),
  ev as (
    select e.user_id, e.event, e.props, e.occurred_at
      from public.analytics_events e
      join pop p on p.user_id = e.user_id
     where e.occurred_at::date = p.signup
  ),
  epochs as (
    select e.event as ev_name, min(e.occurred_at)::date as first_seen
      from public.analytics_events e
     group by e.event
  ),
  spans as (
    select p.user_id, p.returned,
           extract(epoch from (max(s.occurred_at) - min(s.occurred_at))) / 60.0 as minutes,
           count(s.*) as events_n,
           coalesce(max((s.props->>'gcards')::int), 0) as gcards,
           coalesce(max((s.props->>'boards')::int), 0) as boards
      from pop p
      left join ev s on s.user_id = p.user_id and s.event like 'ps\_%'
     group by p.user_id, p.returned
  ),
  medians as (
    select x.metric, x.ord,
           count(*) filter (where sp.returned)::int as rn,
           percentile_cont(0.5) within group (order by case when sp.returned then x.v end)::numeric as rv,
           count(*) filter (where not sp.returned)::int as sn,
           percentile_cont(0.5) within group (order by case when not sp.returned then x.v end)::numeric as sv
      from spans sp
      cross join lateral (values
        ('Minutes in the first session', 1, sp.minutes),
        ('Events recorded in it',        2, sp.events_n::numeric),
        ('Cards on the board by the end',3, sp.gcards::numeric),
        ('Clusters open',                4, sp.boards::numeric)
      ) as x(metric, ord, v)
     group by x.metric, x.ord
  ),
  share_defs(metric, ord, src) as (
    values ('Got stuck placing a card',        10, 'card_create_stuck'),
           ('Opened the share panel',          11, 'share_open'),
           ('Edited a document',               12, 'doc_edit'),
           ('Was shown the empty-board panel', 13, 'empty_board_shown'),
           ('Saw the add-more dock',           14, 'depth_dock_shown')
  ),
  shares as (
    select d.metric, d.ord,
           coalesce(ep.first_seen, v_since) as mfrom,
           count(*) filter (where p.user_id is not null and p.returned)::int as rn,
           round(100.0 * count(*) filter (where p.user_id is not null and p.returned and h.found)
                 / nullif(count(*) filter (where p.user_id is not null and p.returned), 0), 0)::numeric as rv,
           count(*) filter (where p.user_id is not null and not p.returned)::int as sn,
           round(100.0 * count(*) filter (where p.user_id is not null and not p.returned and h.found)
                 / nullif(count(*) filter (where p.user_id is not null and not p.returned), 0), 0)::numeric as sv
      from share_defs d
      left join epochs ep on ep.ev_name = d.src
      -- OUTER, so a metric whose signal postdates every aged user still returns
      -- a row rather than disappearing from the panel entirely.
      left join pop p on p.signup >= coalesce(ep.first_seen, v_since)
      left join lateral (
        select exists (select 1 from ev x where x.user_id = p.user_id and x.event = d.src) as found
      ) h on true
     group by d.metric, d.ord, coalesce(ep.first_seen, v_since)
  ),
  -- client_errors is not an analytics event, so it has no epochs row; it has
  -- been recording since long before this cohort and needs no window.
  err_share as (
    select 'Hit an error'::text as metric, 15 as ord,
           count(*) filter (where p.returned)::int as rn,
           round(100.0 * count(*) filter (where p.returned and h.found)
                 / nullif(count(*) filter (where p.returned), 0), 0)::numeric as rv,
           count(*) filter (where not p.returned)::int as sn,
           round(100.0 * count(*) filter (where not p.returned and h.found)
                 / nullif(count(*) filter (where not p.returned), 0), 0)::numeric as sv
      from pop p
      cross join lateral (
        select exists (
          select 1 from public.client_errors c
           where c.user_id = p.user_id and c.occurred_at::date = p.signup
        ) as found
      ) h
  )
  select m.metric, 'median'::text, m.ord, null::date, m.rn, round(m.rv, 1), m.sn, round(m.sv, 1)
    from medians m
  union all
  select s.metric, 'share', s.ord, s.mfrom, s.rn, s.rv, s.sn, s.sv from shares s
  union all
  select e.metric, 'share', e.ord, null::date, e.rn, e.rv, e.sn, e.sv from err_share e
   order by 3;
end $$;

revoke all on function public.admin_first_session_compare(date, int, boolean, boolean)
  from public, anon;
grant execute on function public.admin_first_session_compare(date, int, boolean, boolean)
  to authenticated;

comment on function public.admin_first_session_compare(date, int, boolean, boolean) is
  'The first session of someone who came back, against the first session of '
  'someone who did not. Runs entirely on telemetry already collected — the '
  'traced first sessions of both groups have been sitting in analytics_events '
  'unread. Never-booted users are excluded: they have no session to autopsy '
  'and would drag every median toward zero for unrelated reasons. Each share '
  'metric carries measured_from, the date its underlying signal first existed, '
  'and is computed only over users who signed up on or after it — several of '
  'these surfaces are younger than the cohort and would otherwise read 0% for '
  'both groups, which looks like "never happens" and means "was not being '
  'recorded". UNADJUSTED: the two groups differ in depth as well as outcome, so '
  'take verdicts from admin_return_predictors, which stratifies. Admin only.';
