-- 0280 — what day-one behaviour predicts a second visit, in a form that cannot
-- be read confounded.
--
-- THE PROBLEM THIS SOLVES IS NOT "we have no predictors". It is that every
-- predictor read off this data so far has been confounded by depth, and at
-- least one of them has been shipped on.
--
-- Depth — how much someone made on their first day — drives both the behaviour
-- and the returning. So ANY day-one behaviour correlates with return simply
-- because people who do more of anything also do more of everything and come
-- back more. Read pooled, this dataset has produced:
--
--   * a composition effect that reverses inside the middle depth band, having
--     already been built on;
--   * a reading in which hitting an ERROR on day one substantially IMPROVES
--     retention — which is absurd, and is exactly what a pooled query returns;
--   * an onboarding question whose answering looks predictive, when answering
--     it at all is itself an engagement signal.
--
-- Three for three. A function that returned a single lift per signal would
-- keep producing those, so this one CANNOT: it returns CELLS, never a verdict.
-- Every signal is crossed with the day-one depth band, and deciding whether an
-- effect is real is left to the caller, which has the sample sizes in hand and
-- refuses to render an effect size unless the sign holds across bands
-- (retentionStats.consistency).
--
-- The pooled row is emitted too, as band='all'. Not as the answer — as the
-- contrast. Seeing "pooled says +17 points, and every band disagrees with the
-- next" side by side is the entire pedagogical point of the panel, and dropping
-- the pooled row would just move the confounded read somewhere less careful.
--
-- ── ON SIGNALS WITH NO OCCURRENCES ──────────────────────────────────────────
-- Some of these barely fire. That is a finding, not a defect, and the rows are
-- emitted with with_n = 0 rather than suppressed: a nest gesture that the
-- onboarding calls the retention "aha" and that essentially never happens is
-- worth seeing as a zero. The caller distinguishes "no effect" from "never
-- observed"; a missing row would collapse the two.
--
-- ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────
-- Session length would be a natural signal here and is NOT included: it comes
-- from usage_session, which begins 2026-08-17 (see the table comment added in
-- 0277). Joined to a cohort that predates it, it returns zeros that read as
-- "nobody used the app" rather than "this table did not exist" — the specific
-- trap that has already cost one analysis. It belongs here once the table has
-- history behind the cohort, not before.

create or replace function public.admin_return_predictors(
  p_since date default '2026-06-16',
  -- Aged out so the outcome is settled. A cohort that has not had a fair chance
  -- to come back inflates the non-returning side of every single cell.
  p_min_age_days int default 14,
  p_exclude_internal boolean default true,
  p_verified_only boolean default true
)
returns table (
  signal text,
  band text,
  band_ord int,
  with_n int,
  with_ret int,
  without_n int,
  without_ret int
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_age int := least(greatest(coalesce(p_min_age_days, 14), 0), 365);
begin
  perform public._require_admin();

  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup
      from auth.users usr
     where usr.created_at >= coalesce(p_since, '2026-06-16'::date)
       and usr.created_at < now() - (v_age || ' days')::interval
       and (not p_verified_only
            or (usr.email_confirmed_at is not null and usr.last_sign_in_at is not null))
       and (not p_exclude_internal
            or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  -- Day-one events only. Everything measured here is a FIRST DAY behaviour, so
  -- that the signal cannot be contaminated by the very return it predicts.
  ev as (
    select e.user_id, e.event, e.props
      from public.analytics_events e
      join u on u.user_id = e.user_id
     where e.occurred_at::date = u.signup
  ),
  err as (
    select distinct c.user_id
      from public.client_errors c
      join u on u.user_id = c.user_id
     where c.occurred_at::date = u.signup
  ),
  depth as (
    select u.user_id,
           coalesce((select sum((e.props->>'n')::int) from ev e
                      where e.user_id = u.user_id and e.event = 'card_placed'), 0) as cards
      from u
  ),
  outcome as (
    select u.user_id, (count(distinct a.day) > 1) as returned
      from u
      left join public.user_active_day a on a.user_id = u.user_id
     group by u.user_id
  ),
  flags as (
    select d.user_id, d.cards, o.returned,
      -- Wrote, rather than merely placed. Matches mixPrompt's definition of
      -- text: the kinds a person types into.
      exists (select 1 from ev e where e.user_id = d.user_id and e.event = 'card_placed'
               and e.props->>'kind' in ('note', 'doc', 'script'))                    as wrote_text,
      exists (select 1 from ev e where e.user_id = d.user_id
               and e.event = 'onboarding_nest')                                     as nested,
      exists (select 1 from ev e where e.user_id = d.user_id
               and e.event in ('import_batch', 'photo_pick_commit')
               and coalesce((e.props->>'n_files')::int,
                            (e.props->>'n_selected')::int, 0) >= 3)                  as batch_upload,
      exists (select 1 from ev e where e.user_id = d.user_id
               and e.props->>'device_type' = 'mobile')                              as mobile,
      (d.user_id in (select user_id from err))                                      as day1_error,
      exists (select 1 from ev e where e.user_id = d.user_id
               and e.event = 'onboarding_intent')                                   as answered_intent,
      exists (select 1 from ev e where e.user_id = d.user_id
               and e.event in ('share_open', 'share_link_copied', 'share_link_created',
                               'invite_link_created', 'invite_sent', 'share_ask_taken'))
                                                                                    as shared,
      exists (select 1 from ev e where e.user_id = d.user_id
               and e.event in ('card_create_stuck', 'card_create_blocked'))          as hit_friction,
      (select count(distinct e.props->>'board_id') from ev e
        where e.user_id = d.user_id and e.event = 'board_open') > 1                  as multi_board
      from depth d
      join outcome o on o.user_id = d.user_id
  ),
  -- Unpivoted so adding a signal is one line in the VALUES list rather than a
  -- new column in the result and a new branch in every caller.
  long as (
    select f.cards, f.returned, t.k, t.v
      from flags f
      cross join lateral (values
        ('wrote_text', f.wrote_text),
        ('nested', f.nested),
        ('batch_upload', f.batch_upload),
        ('mobile', f.mobile),
        ('day1_error', f.day1_error),
        ('answered_intent', f.answered_intent),
        ('shared', f.shared),
        ('hit_friction', f.hit_friction),
        ('multi_board', f.multi_board)
      ) as t(k, v)
  ),
  banded as (
    select l.k, l.v, l.returned,
           case when l.cards = 0 then '0'
                when l.cards <= 2 then '1-2'
                when l.cards <= 5 then '3-5'
                else '6+' end as band,
           case when l.cards = 0 then 1
                when l.cards <= 2 then 2
                when l.cards <= 5 then 3
                else 4 end as band_ord
      from long l
  ),
  -- The stratified cells and the pooled row, unioned. band_ord 0 sorts the
  -- pooled row first so a caller can present it as the claim being tested.
  cells as (
    select b.k, b.band, b.band_ord, b.v, b.returned from banded b
    union all
    select b.k, 'all', 0, b.v, b.returned from banded b
  )
  select c.k, c.band, c.band_ord,
         count(*) filter (where c.v)::int,
         count(*) filter (where c.v and c.returned)::int,
         count(*) filter (where not c.v)::int,
         count(*) filter (where not c.v and c.returned)::int
    from cells c
   group by c.k, c.band, c.band_ord
   order by c.k, c.band_ord;
end $$;

revoke all on function public.admin_return_predictors(date, int, boolean, boolean)
  from public, anon;
grant execute on function public.admin_return_predictors(date, int, boolean, boolean)
  to authenticated;

comment on function public.admin_return_predictors(date, int, boolean, boolean) is
  'Day-one behaviours crossed with day-one DEPTH BANDS, as raw cells. Returns '
  'no lift, no p-value and no verdict, on purpose: depth drives both the '
  'behaviour and the returning, so every pooled reading of this data has been '
  'confounded — including one in which hitting an error improves retention. '
  'The caller decides, and should refuse to state an effect size unless the '
  'sign holds across bands (see lib/retentionStats.consistency). band=''all'' '
  'is the pooled row, emitted as the contrast rather than as the answer. '
  'Signals that never fire return with_n=0 rather than being suppressed, so '
  '"no effect" and "never observed" stay distinguishable. Session length is '
  'deliberately excluded — usage_session begins 2026-08-17 and returns zeros '
  'that read as absence of usage across older cohorts. Admin only.';
