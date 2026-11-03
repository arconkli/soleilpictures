-- 0855_admin_tests_reaim.sql — Analytics › Tests reads what each test is now
-- deciding on (the owner, 2026-11-03: "see if we are ready to make any
-- decisions based off of it or if there is anywhere we can improve right now
-- and make the test better").
--
-- Additive. The page in production keeps calling admin_tests_read (0810,
-- unchanged here) between this migration and the release that reads the new
-- keys, so every key 0810's helpers return keeps its meaning; these
-- definitions only add keys. The legacy tests (workspace_setup, whats_new)
-- stay in the read until production carries the new catalog.
--
-- New: _admin_test_release_builds(p_now), the builds that carry the release:
-- those that sent share_ask_skipped or up_settings_view, two events only the
-- release's code sends. And _admin_test_release_seen(p_now), the release
-- instant: the first time a real account opened the app on one of them, null
-- until that release is live. An event with no build is on neither side.
--
-- Added keys (each measure is { A: {n, k}, B: {n, k}, due, next }):
--   email_holdout     measures.open_72h (both emails pooled, each person once,
--                     at their first due row), measures.unsub (a guard: has
--                     turned these emails off, read 7 days on), weeks.
--   first_board_more  measures.ten_after_1d and more_1d, from each account's
--                     first 'eligible' moment; signals.click {views, clicks}.
--   signup_box        strata [{page, phone, A, B}] for signup_1d, by the
--                     device's first page with a side.
--   share_ask         fix_from; measures.reach_load, crowd_reveal,
--                     crowd_banner; misses [{reason, n}]; signals.lost_to_ask.
--   trial_early       on_from; in {A, B}; measures.press_14d; signals.reach
--                     {views, early} and signals.leak. stamped_off keeps its
--                     0810 meaning until on_from is known.
--
-- The follow-up emails' hold-back runs 12 weeks: app_config
-- lifecycle_email_experiments holdout_weeks becomes 12 for both emails (0790
-- wrote 6). Nothing switches the hold-back off by itself; the page reads it.
--
-- Counts only, as 0810. Internal, service and banned accounts are left out of
-- everything. Every helper is revoked from public, anon and authenticated.

begin;

set local lock_timeout = '3s';

-- ── The release builds, and the release instant ─────────────────────────────
-- A build carries the release when it sent an event only the release's code
-- sends: share_ask_skipped or up_settings_view. exp_trial_early cannot mark a
-- build: once an account is stamped, the client adopts every arm the server
-- holds for it (armCache.adoptServer), so an old build left open in a tab
-- carries exp_trial_early too. Nor can "first seen after the release": a
-- release run may ship other work without this one.
create or replace function public._admin_test_release_builds(p_now timestamptz)
returns setof text
language sql stable
set search_path = 'public'
as $$
  select distinct e.props->>'build'
    from public.analytics_events e
   where e.event in ('share_ask_skipped', 'up_settings_view')
     and e.occurred_at >= '2026-11-03T00:00:00Z' and e.occurred_at < p_now
     and e.props->>'build' is not null
$$;

create or replace function public._admin_test_release_seen(p_now timestamptz)
returns timestamptz
language sql stable
set search_path = 'public'
as $$
  with ex as materialized (select x.user_id from public._admin_test_excluded() x)
  select min(o.occurred_at)
    from public.analytics_events o
   where o.event = 'app_open'
     and o.occurred_at >= '2026-11-03T00:00:00Z' and o.occurred_at < p_now
     and o.props->>'build' in (select b from public._admin_test_release_builds(p_now) b)
     and o.user_id is not null
     and o.user_id not in (select user_id from ex)
$$;

-- ── First board asks for more ───────────────────────────────────────────────
-- 0810's measures, plus two from each account's first 'eligible' moment (the
-- third card, both arms): ten_after_1d, 10 or more genuine cards placed by a
-- day after it (ten_1d's count with its anchor moved), and more_1d, at least one
-- more card in that day. click: who in B saw the toast, and who pressed it.
create or replace function public._admin_test_first_board_more(p_now timestamptz)
returns jsonb
language plpgsql stable
set search_path = 'public'
as $fn$
declare
  v_start constant timestamptz := '2026-10-29T04:30:00Z';
  v_rest jsonb;
begin
  with ex as materialized (select x.user_id from public._admin_test_excluded() x),
  pop as (
    select u.id as user_id, u.created_at, p.settings->'experiments'->>'first_board_more' as arm, p.first_card_at
      from auth.users u
      join public.profiles p on p.user_id = u.id
     where u.created_at >= v_start and u.created_at < p_now
       and p.settings->'experiments'->>'first_board_more' in ('A', 'B')
       and u.id not in (select user_id from ex)
  ),
  ev as (
    select v.user_id, v.ek, v.first_at
      from public._admin_engaged_visits((v_start at time zone 'utc')::date - 1, true, true, 2) v
     where v.engaged and v.first_at < p_now and v.user_id in (select user_id from pop)
  ),
  placed as (
    select e.user_id, e.occurred_at,
           case when e.props->>'n' ~ '^[0-9]+$' then (e.props->>'n')::int else 1 end as n
      from public.analytics_events e
     where e.event = 'card_placed' and e.occurred_at >= v_start and e.occurred_at < p_now
       and e.user_id in (select user_id from pop)
  ),
  deleted as (
    select e.user_id, e.occurred_at,
           case when e.props->>'n' ~ '^[0-9]+$' then (e.props->>'n')::int else 1 end as n
      from public.analytics_events e
     where e.event = 'card_deleted' and e.occurred_at >= v_start and e.occurred_at < p_now
       and e.user_id in (select user_id from pop)
  ),
  nudge as (
    select e.user_id, e.occurred_at, e.props->>'action' as action, p.arm
      from public.analytics_events e
      join pop p on p.user_id = e.user_id
     where e.event = 'board_more_nudge' and e.occurred_at >= v_start and e.occurred_at < p_now
  ),
  last_view as (
    select max(occurred_at) as at from nudge where arm = 'B' and action = 'view'
  ),
  per as (
    select p.user_id, p.arm, p.created_at, e1.first_at as e1_at,
           coalesce((select sum(x.n) from placed x where x.user_id = p.user_id
                      and x.occurred_at < p.created_at + interval '24 hours'), 0) as placed_d1,
           coalesce((select sum(x.n) from placed x where x.user_id = p.user_id
                      and x.occurred_at < p.created_at + interval '7 days'), 0) as placed7,
           coalesce((select sum(x.n) from deleted x where x.user_id = p.user_id
                      and x.occurred_at < p.created_at + interval '7 days'), 0) as deleted7,
           (p.first_card_at is not null and p.first_card_at < p.created_at + interval '24 hours') as card_d1,
           (e1.first_at is not null and exists (
              select 1 from ev x where x.user_id = p.user_id and x.ek = 2
                 and x.first_at <= e1.first_at + interval '7 days')) as ret7
      from pop p
      left join lateral (select min(x.first_at) as first_at from ev x where x.user_id = p.user_id and x.ek = 1) e1 on true
  ),
  -- Each account's first moment the toast could show (B) or would have (A).
  moment as (
    select distinct on (n.user_id) n.user_id, n.arm, n.occurred_at as at
      from nudge n
     where n.action = 'eligible'
     order by n.user_id, n.occurred_at
  ),
  after_moment as (
    select m.user_id, m.arm, m.at,
           coalesce((select sum(x.n) from placed x where x.user_id = m.user_id
                      and x.occurred_at < m.at + interval '24 hours'), 0) as placed_by_1d,
           exists (select 1 from placed x where x.user_id = m.user_id
                    and x.occurred_at > m.at and x.occurred_at < m.at + interval '24 hours') as more
      from moment m
  ),
  r (m, arm, mature, hit, ready_at) as (
    select 'ten_1d', arm, created_at <= p_now - interval '24 hours', placed_d1 >= 10, created_at + interval '24 hours' from per
    union all
    select 'back_7d', arm,
           created_at <= p_now - interval '7 days' and (e1_at is null or e1_at <= p_now - interval '7 days'),
           ret7, coalesce(e1_at, created_at) + interval '7 days'
      from per
    union all
    select 'card_1d', arm, created_at <= p_now - interval '24 hours', card_d1, created_at + interval '24 hours' from per
    union all
    select 'deleted_half_7d', arm, created_at <= p_now - interval '7 days', deleted7 * 2 >= placed7,
           created_at + interval '7 days'
      from per where placed7 > 0
    union all
    select 'ten_after_1d', arm, at <= p_now - interval '24 hours', placed_by_1d >= 10, at + interval '24 hours'
      from after_moment
    union all
    select 'more_1d', arm, at <= p_now - interval '24 hours', more, at + interval '24 hours'
      from after_moment
  ),
  agg as (
    select m, jsonb_build_object(
      'A', jsonb_build_object('n', count(*) filter (where arm = 'A' and mature), 'k', count(*) filter (where arm = 'A' and mature and hit)),
      'B', jsonb_build_object('n', count(*) filter (where arm = 'B' and mature), 'k', count(*) filter (where arm = 'B' and mature and hit)),
      'due', count(*),
      'next', min(ready_at) filter (where not mature)) as v
      from r group by m
  )
  select jsonb_build_object(
    'measures', coalesce((select jsonb_object_agg(m, v) from agg), '{}'::jsonb),
    'signals', jsonb_build_object(
      'shown', jsonb_build_object(
        'last', (select at from last_view),
        'due', (select count(distinct n.user_id) from nudge n
                 where n.arm = 'B' and n.action = 'eligible'
                   and n.occurred_at > coalesce((select at from last_view), v_start))),
      'click', jsonb_build_object(
        'views', (select count(distinct n.user_id) from nudge n where n.arm = 'B' and n.action = 'view'),
        'clicks', (select count(distinct n.user_id) from nudge n
                    where n.arm = 'B' and n.action in ('folder', 'photos', 'note')))),
    'mismatched', (select count(distinct n.user_id) from nudge n where n.arm = 'A' and n.action = 'view'))
  into v_rest;
  return public._admin_test_accounts('first_board_more', v_start, p_now) || v_rest;
end
$fn$;

-- ── The sign-up box on the search pages ─────────────────────────────────────
-- 0810's read, plus strata: signup_1d split by the device's first page with a
-- side (lp_view's page, else its path) and whether that device is a phone or
-- tablet (lp_view's device_type; anything else counts as a desktop).
create or replace function public._admin_test_signup_box(p_now timestamptz)
returns jsonb
language plpgsql stable
set search_path = 'public'
as $fn$
declare
  v_start constant timestamptz := '2026-10-29T00:00:00Z';
  v_out jsonb;
begin
  with ex as materialized (select x.user_id from public._admin_test_excluded() x),
  lp as (
    select e.session_id as device, e.occurred_at, e.user_id,
           e.props->>'exp_signup_box' as arm, e.props->>'page_kind' as kind,
           coalesce(e.props->>'page', e.path) as page,
           coalesce(e.props->>'device_type' in ('mobile', 'tablet'), false) as phone
      from public.analytics_events e
     where e.event = 'lp_view' and e.occurred_at >= v_start and e.occurred_at < p_now
       and e.session_id is not null
  ),
  seen as (
    select device, min(occurred_at) as first_at
      from lp
     where (user_id is null and kind in ('tool', 'compare', 'hub', 'listicle')) or arm is not null
     group by device
  ),
  exposed as (
    select device, min(occurred_at) as first_at,
           mode() within group (order by arm) as arm,
           count(distinct arm) as arms,
           max(occurred_at) filter (where arm = 'A') as last_a,
           max(occurred_at) filter (where arm = 'B') as last_b
      from lp
     where arm is not null
     group by device
  ),
  first_page as (
    select distinct on (device) device, page, phone
      from lp
     where arm is not null
     order by device, occurred_at
  ),
  prior_seen as (
    select distinct s.device
      from seen s
      join public.analytics_events e on e.session_id = s.device
     where e.user_id is not null and e.occurred_at < s.first_at
  ),
  prior_exposed as (
    select distinct x.device
      from exposed x
      join public.analytics_events e on e.session_id = x.device
     where e.user_id is not null and e.occurred_at < x.first_at
  ),
  devices as (
    select x.* from exposed x
     where x.arm in ('A', 'B') and x.device not in (select device from prior_exposed)
  ),
  elig as (
    select s.device, s.first_at from seen s where s.device not in (select device from prior_seen)
  ),
  signups as (
    select d.device, u.id as user_id, u.created_at, p.first_card_at
      from devices d
      join public.analytics_events e on e.session_id = d.device and e.user_id is not null
      join auth.users u on u.id = e.user_id
      join public.profiles p on p.user_id = u.id
     where u.created_at >= d.first_at
       and u.created_at < d.first_at + interval '24 hours'
       and u.created_at < p_now
       and u.id not in (select user_id from ex)
     group by d.device, u.id, u.created_at, p.first_card_at
  ),
  sends as (
    select e.occurred_at
      from public.analytics_events e
     where e.event = 'signup_box_send' and e.occurred_at >= v_start and e.occurred_at < p_now
       and e.props->>'exp_signup_box' = 'B'
  ),
  r (m, arm, mature, hit, ready_at, device) as (
    select 'signup_1d', d.arm, d.first_at <= p_now - interval '24 hours',
           exists (select 1 from signups s where s.device = d.device),
           d.first_at + interval '24 hours', d.device
      from devices d
    union all
    select 'card_1d', d.arm, s.created_at <= p_now - interval '24 hours',
           s.first_card_at is not null and s.first_card_at < s.created_at + interval '24 hours',
           s.created_at + interval '24 hours', d.device
      from signups s join devices d on d.device = s.device
  ),
  agg as (
    select m, jsonb_build_object(
      'A', jsonb_build_object('n', count(*) filter (where arm = 'A' and mature), 'k', count(*) filter (where arm = 'A' and mature and hit)),
      'B', jsonb_build_object('n', count(*) filter (where arm = 'B' and mature), 'k', count(*) filter (where arm = 'B' and mature and hit)),
      'due', count(*),
      'next', min(ready_at) filter (where not mature)) as v
      from r group by m
  ),
  strata as (
    select f.page, f.phone,
           count(*) filter (where r.arm = 'A' and r.mature) as na,
           count(*) filter (where r.arm = 'A' and r.mature and r.hit) as ka,
           count(*) filter (where r.arm = 'B' and r.mature) as nb,
           count(*) filter (where r.arm = 'B' and r.mature and r.hit) as kb
      from r
      join first_page f on f.device = r.device
     where r.m = 'signup_1d'
     group by f.page, f.phone
  )
  select jsonb_build_object(
    'in', jsonb_build_object(
      'A', (select count(*) from devices where arm = 'A'),
      'B', (select count(*) from devices where arm = 'B')),
    'eligible', (select count(*) from elig),
    'recent', jsonb_build_object(
      'eligible', (select count(*) from elig where first_at >= p_now - interval '3 days'),
      'assigned', (select count(*) from devices where first_at >= p_now - interval '3 days')),
    'last', jsonb_build_object(
      'A', (select max(last_a) from devices),
      'B', (select max(last_b) from devices)),
    'mismatched', (select count(*) from exposed where arms > 1),
    'signals', jsonb_build_object('box_sent', jsonb_build_object(
      'last', (select max(occurred_at) from sends),
      'due', (select count(*) from devices d
               where d.arm = 'B' and d.first_at > coalesce((select max(occurred_at) from sends), v_start)))),
    'measures', coalesce((select jsonb_object_agg(m, v) from agg), '{}'::jsonb),
    'strata', coalesce((select jsonb_agg(jsonb_build_object(
                 'page', page, 'phone', phone,
                 'A', jsonb_build_object('n', na, 'k', ka),
                 'B', jsonb_build_object('n', nb, 'k', kb)) order by page, phone)
               from strata), '[]'::jsonb))
  into v_out;
  return v_out;
end
$fn$;

-- ── Follow-up emails, half held back ────────────────────────────────────────
-- 0810's read, plus open_72h, the one that decides: both emails pooled, each
-- person once, at their first row since the start (sent is A, held back is B),
-- and an app_open by them in the 72 hours after it. weeks: how long the
-- hold-back runs, as configured. unsub (a guard): the same people, has the
-- account turned these emails off (notification_prefs.email_lifecycle), read
-- as it stands now once 7 days have passed since their first row. An
-- unsubscribe is a flag with no time on it, so "within 7 days" can't be read.
create or replace function public._admin_test_email_holdout(p_now timestamptz)
returns jsonb
language plpgsql stable
set search_path = 'public'
as $fn$
declare
  v_cfg jsonb;
  v_from_raw text;
  v_pct_raw text;
  v_weeks_raw text;
  v_start timestamptz := '2026-10-29T01:38:00Z';
  v_pct int;
  v_weeks int;
  v_out jsonb;
begin
  select c.value into v_cfg from public.app_config c where c.key = 'lifecycle_email_experiments';
  v_from_raw := v_cfg -> 'activate_nudge_1' ->> 'holdout_from';
  if v_from_raw ~ '^\d{4}-\d{2}-\d{2}$' then
    v_start := greatest(v_start, (v_from_raw::date)::timestamp at time zone 'utc');
  end if;
  v_pct_raw := v_cfg -> 'activate_nudge_1' ->> 'holdout_pct';
  if v_pct_raw ~ '^\d{1,3}$' then
    v_pct := least(v_pct_raw::int, 100);
  end if;
  v_weeks_raw := v_cfg -> 'activate_nudge_1' ->> 'holdout_weeks';
  if v_weeks_raw ~ '^\d{1,3}$' then
    v_weeks := v_weeks_raw::int;
  end if;

  with ex as materialized (select x.user_id from public._admin_test_excluded() x),
  lg as (
    select l.id, l.user_id, l.email_type, l.status, l.sent_at,
           case when l.status = 'sent' then 'A' else 'B' end as arm
      from public.lifecycle_email_log l
     where l.email_type in ('activate_nudge_1', 'board_waiting')
       and l.status in ('sent', 'held_out')
       and l.sent_at >= v_start and l.sent_at < p_now
       and l.user_id not in (select user_id from ex)
  ),
  per as (
    select g.*,
           exists (select 1 from public.analytics_events a
                    where a.user_id = g.user_id
                      and a.occurred_at > g.sent_at and a.occurred_at <= g.sent_at + interval '72 hours'
                      and a.occurred_at < p_now
                      and a.event in ('card_placed', 'card_edit', 'doc_edit')
                      and coalesce(a.props->>'synthetic', '') <> 'true') as made,
           exists (select 1 from public.analytics_events a
                    where a.user_id = g.user_id and a.event = 'app_open'
                      and a.occurred_at > g.sent_at and a.occurred_at <= g.sent_at + interval '7 days'
                      and a.occurred_at < p_now) as opened
      from lg g
  ),
  -- Each person once: their first row since the start, whichever email.
  first_row as (
    select distinct on (g.user_id) g.user_id, g.arm, g.sent_at
      from lg g
     order by g.user_id, g.sent_at, g.id
  ),
  first_open as (
    select f.*,
           exists (select 1 from public.analytics_events a
                    where a.user_id = f.user_id and a.event = 'app_open'
                      and a.occurred_at > f.sent_at and a.occurred_at <= f.sent_at + interval '72 hours'
                      and a.occurred_at < p_now) as opened
      from first_row f
  ),
  r (m, arm, mature, hit, ready_at) as (
    select case when email_type = 'activate_nudge_1' then 'nudge_made_72h' else 'waiting_made_72h' end,
           arm, sent_at <= p_now - interval '72 hours', made, sent_at + interval '72 hours'
      from per
    union all
    select case when email_type = 'activate_nudge_1' then 'nudge_open_7d' else 'waiting_open_7d' end,
           arm, sent_at <= p_now - interval '7 days', opened, sent_at + interval '7 days'
      from per
    union all
    select 'open_72h', arm, sent_at <= p_now - interval '72 hours', opened, sent_at + interval '72 hours'
      from first_open
    union all
    select 'unsub', f.arm, f.sent_at <= p_now - interval '7 days',
           coalesce(p.notification_prefs->>'email_lifecycle', '') = 'false', f.sent_at + interval '7 days'
      from first_row f
      left join public.profiles p on p.user_id = f.user_id
  ),
  agg as (
    select m, jsonb_build_object(
      'A', jsonb_build_object('n', count(*) filter (where arm = 'A' and mature), 'k', count(*) filter (where arm = 'A' and mature and hit)),
      'B', jsonb_build_object('n', count(*) filter (where arm = 'B' and mature), 'k', count(*) filter (where arm = 'B' and mature and hit)),
      'due', count(*),
      'next', min(ready_at) filter (where not mature)) as v
      from r group by m
  )
  select jsonb_build_object(
    'start', v_start,
    'holdout_pct', v_pct,
    'weeks', v_weeks,
    'in', jsonb_build_object(
      'A', (select count(*) from lg where arm = 'A'),
      'B', (select count(*) from lg where arm = 'B')),
    'parts', jsonb_build_array(
      jsonb_build_object('label', 'Day-one nudge',
        'A', (select count(*) from lg where email_type = 'activate_nudge_1' and arm = 'A'),
        'B', (select count(*) from lg where email_type = 'activate_nudge_1' and arm = 'B')),
      jsonb_build_object('label', 'board waiting',
        'A', (select count(*) from lg where email_type = 'board_waiting' and arm = 'A'),
        'B', (select count(*) from lg where email_type = 'board_waiting' and arm = 'B'))),
    'last_run', (select max(l.sent_at) from public.lifecycle_email_log l where l.sent_at < p_now),
    'mismatched', (select count(*) from lg h
                    where h.arm = 'B'
                      and exists (select 1 from lg s
                                   where s.arm = 'A' and s.user_id = h.user_id
                                     and s.email_type = h.email_type and s.sent_at > h.sent_at)),
    'measures', coalesce((select jsonb_object_agg(m, v) from agg), '{}'::jsonb))
  into v_out;
  return v_out;
end
$fn$;

-- ── The share ask at ten cards ──────────────────────────────────────────────
-- 0810's before/after read, plus the fix (fix_from, the release instant):
--   reach_load: each person's first crossing overall since the ask's release (a
--     card_placed taking a cluster from under 10 genuine cards to 10 or more)
--     decides their side, so nobody is counted on both; asked or not in that
--     same app session for that cluster. Settled when the page closes, so no wait. A is
--     the share ask's release to fix_from on builds that aren't fixed, B is on
--     fixed builds; until fix_from is known A is everything since the release.
--   misses: B's people not asked, by the reason a share_ask_skipped gave for
--     that cluster in that session, else 'not_in_view'.
--   crowd_reveal, crowd_banner: accounts made in each period whose first app
--     session showed a power reveal, or the first-value banner.
--   lost_to_ask: first-value banners stood down because the share ask held the
--     slot, since fix_from.
create or replace function public._admin_test_share_ask(p_now timestamptz)
returns jsonb
language plpgsql stable
set search_path = 'public'
as $fn$
declare
  v_before constant timestamptz := '2026-09-28T00:00:00Z';
  v_live constant timestamptz := '2026-10-29T05:15:00Z';
  v_fix timestamptz;
  v_out jsonb;
begin
  v_fix := public._admin_test_release_seen(p_now);

  with ex0 as materialized (select x.user_id from public._admin_test_excluded() x),
  ex as materialized (
    select x.user_id from ex0 x
    union
    select distinct l.created_by from public.public_share_links l
     where l.created_at >= '2026-10-15T00:00:00Z' and l.created_at < '2026-10-16T00:00:00Z'
       and l.created_by is not null
  ),
  windows (arm, w0, w1) as (
    values ('A', v_before, least(v_live, p_now)), ('B', v_live, p_now)
  ),
  crossings as (
    select distinct on (w.arm, e.user_id)
           w.arm, e.user_id, e.occurred_at as crossed_at
      from windows w
      join public.analytics_events e on e.occurred_at >= w.w0 and e.occurred_at < w.w1
     where e.event = 'card_placed'
       and (e.props->>'cards_after') ~ '^\d+$' and (e.props->>'n') ~ '^\d+$'
       and (e.props->>'cards_after')::int >= 10
       and (e.props->>'cards_after')::int - (e.props->>'n')::int < 10
       and e.user_id is not null
       and e.user_id not in (select user_id from ex)
     order by w.arm, e.user_id, e.occurred_at
  ),
  after1d as (
    select c.arm, c.user_id, c.crossed_at,
           exists (select 1 from public.analytics_events e
                    where e.user_id = c.user_id and e.event = 'share_ask_shown'
                      and e.occurred_at >= c.crossed_at - interval '1 minute'
                      and e.occurred_at < c.crossed_at + interval '1 day'
                      and e.occurred_at < p_now) as shown
      from crossings c
  ),
  tips as (
    select w.arm,
           count(*) filter (where e.event = 'power_reveal_shown') as shown,
           count(*) filter (where e.event = 'power_reveal_engaged') as engaged
      from windows w
      join public.analytics_events e on e.occurred_at >= w.w0 and e.occurred_at < w.w1
     where e.event in ('power_reveal_shown', 'power_reveal_engaged')
       and e.user_id not in (select user_id from ex)
     group by w.arm
  ),
  asks as (
    select max(e.occurred_at) as last
      from public.analytics_events e
     where e.event = 'share_ask_shown' and e.props ? 'at'
       and e.occurred_at >= v_live and e.occurred_at < p_now
       and e.user_id not in (select user_id from ex)
  ),
  -- Builds that carry the fix (_admin_test_release_builds).
  fixed as (
    select b as build from public._admin_test_release_builds(p_now) b
     where v_fix is not null
  ),
  -- Each person's FIRST crossing since v_live decides their side: someone who
  -- crossed (and may have been asked) before the fix is not counted again in B,
  -- where the weekly stamp would hold their next ask back. A first crossing on
  -- neither side (an old build after the fix) leaves the person out.
  load_cross as (
    select s.*
      from (
        select distinct on (e.user_id)
               case
                 when e.occurred_at < coalesce(v_fix, p_now)
                      and e.props->>'build' not in (select build from fixed) then 'A'
                 when v_fix is not null and e.occurred_at >= v_fix
                      and e.props->>'build' in (select build from fixed) then 'B'
               end as arm,
               e.user_id, e.occurred_at as crossed_at,
               e.props->>'board_id' as board_id, e.app_session_id as sess
          from public.analytics_events e
         where e.event = 'card_placed'
           and e.occurred_at >= v_live and e.occurred_at < p_now
           and e.props->>'build' is not null
           and (e.props->>'cards_after') ~ '^\d+$' and (e.props->>'n') ~ '^\d+$'
           and (e.props->>'cards_after')::int >= 10
           and (e.props->>'cards_after')::int - (e.props->>'n')::int < 10
           and e.user_id is not null
           and e.user_id not in (select user_id from ex)
         order by e.user_id, e.occurred_at
      ) s
     where s.arm is not null
  ),
  load_asked as (
    select c.*,
           (c.sess is not null and c.board_id is not null and exists (
              select 1 from public.analytics_events e
               where e.app_session_id = c.sess and e.user_id = c.user_id
                 and e.event = 'share_ask_shown' and e.props->>'board_id' = c.board_id
                 and e.occurred_at < p_now)) as asked
      from load_cross c
  ),
  missed as (
    select coalesce((select e.props->>'reason' from public.analytics_events e
                      where c.sess is not null and e.app_session_id = c.sess and e.user_id = c.user_id
                        and e.event = 'share_ask_skipped' and e.props->>'board_id' = c.board_id
                        and e.occurred_at < p_now
                      order by e.occurred_at desc limit 1), 'not_in_view') as reason
      from load_asked c
     where c.arm = 'B' and not c.asked
  ),
  -- Accounts made in each period, and their first app session.
  crowd as (
    select a.arm, a.created_at,
           exists (select 1 from public.analytics_events e
                    where e.app_session_id = f.sess and e.user_id = a.user_id
                      and e.event = 'power_reveal_shown' and e.occurred_at < p_now) as reveal,
           exists (select 1 from public.analytics_events e
                    where e.app_session_id = f.sess and e.user_id = a.user_id
                      and e.event = 'first_value_upgrade_view' and e.occurred_at < p_now) as banner
      from (
        select u.id as user_id, u.created_at,
               case when u.created_at < coalesce(v_fix, p_now) then 'A'
                    when v_fix is not null and u.created_at >= v_fix then 'B' end as arm
          from auth.users u
         where u.created_at >= v_live and u.created_at < p_now
           and u.id not in (select user_id from ex)
      ) a
      cross join lateral (
        select o.app_session_id as sess from public.analytics_events o
         where o.user_id = a.user_id and o.event = 'app_open' and o.app_session_id is not null
           and o.occurred_at < p_now
         order by o.occurred_at limit 1
      ) f
     where a.arm is not null
  ),
  r (m, arm, mature, hit, ready_at) as (
    select 'shown_1d', arm, crossed_at <= p_now - interval '1 day', shown, crossed_at + interval '1 day' from after1d
    union all
    select 'reach_load', arm, true, asked, crossed_at from load_asked
    union all
    select 'crowd_reveal', arm, created_at <= p_now - interval '1 day', reveal, created_at + interval '1 day' from crowd
    union all
    select 'crowd_banner', arm, created_at <= p_now - interval '1 day', banner, created_at + interval '1 day' from crowd
  ),
  agg as (
    select m, jsonb_build_object(
      'A', jsonb_build_object('n', count(*) filter (where arm = 'A' and mature), 'k', count(*) filter (where arm = 'A' and mature and hit)),
      'B', jsonb_build_object('n', count(*) filter (where arm = 'B' and mature), 'k', count(*) filter (where arm = 'B' and mature and hit)),
      'due', count(*) filter (where arm = 'B'),
      'next', min(ready_at) filter (where not mature and arm = 'B')) as v
      from r group by m
  ),
  zero (m) as (values ('shown_1d'), ('reach_load'), ('crowd_reveal'), ('crowd_banner'))
  select jsonb_build_object(
    'start', v_live,
    'fix_from', v_fix,
    'in', jsonb_build_object(
      'A', (select count(*) from crossings where arm = 'A'),
      'B', (select count(*) from crossings where arm = 'B')),
    'shown', (select count(*) from after1d where arm = 'B' and shown),
    'misses', coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'n', n) order by n desc, reason)
                          from (select reason, count(*) as n from missed group by reason) x), '[]'::jsonb),
    'signals', jsonb_build_object(
      'ask_at_10', jsonb_build_object(
        'last', (select last from asks),
        'due', (select count(*) from crossings c
                 where c.arm = 'B' and c.crossed_at > coalesce((select last from asks), v_live))),
      'lost_to_ask', (select count(*) from public.analytics_events e
                       where e.event = 'up_suppressed'
                         and e.occurred_at >= v_fix and e.occurred_at < p_now
                         and e.props->>'reason' = 'slot_busy' and e.props->>'winner' = 'share-ask'
                         and e.user_id not in (select user_id from ex))),
    'measures', coalesce((select jsonb_object_agg(z.m, coalesce(a.v, jsonb_build_object(
                    'A', jsonb_build_object('n', 0, 'k', 0), 'B', jsonb_build_object('n', 0, 'k', 0),
                    'due', 0, 'next', null)))
                  from zero z left join agg a on a.m = z.m), '{}'::jsonb)
      || jsonb_build_object('tips', jsonb_build_object(
           'A', jsonb_build_object('n', coalesce((select shown from tips where arm = 'A'), 0),
                                   'k', least(coalesce((select engaged from tips where arm = 'A'), 0),
                                              coalesce((select shown from tips where arm = 'A'), 0))),
           'B', jsonb_build_object('n', coalesce((select shown from tips where arm = 'B'), 0),
                                   'k', least(coalesce((select engaged from tips where arm = 'B'), 0),
                                              coalesce((select shown from tips where arm = 'B'), 0))),
           'due', coalesce((select shown from tips where arm = 'B'), 0),
           'next', null)))
  into v_out;
  return v_out;
end
$fn$;

-- ── The free trial from the first card ──────────────────────────────────────
-- Switched on with the release that carries this; on_from is that release.
--   in: accounts stamped with a side (profiles.settings.experiments), once
--     on_from is known. Only demo accounts are stamped; a stamped account
--     that has since paid still counts.
--   press_14d (decides): each stamped account's first offer seen after on_from
--     (the pill, the first-value banner, the pricing pop-up, Settings' plan)
--     while both the count on screen and the server's count were 1 to 12, not
--     one the pill held back waiting on the server's count, and only for
--     accounts with no offer view before on_from, or after it on a build
--     without the switch; and any upgrade press, trial
--     or priced, in the 14 days after it.
--   reach: B's first such views, and how many offered the trial as 'early'.
--   leak: A's offers that gave 'early' as the reason. Should be none.
--   stamped_off: until on_from, 0810's meaning (anyone given a side while
--     the test is off). After it, accounts carrying exp_trial_early in the 7
--     days before on_from.
create or replace function public._admin_test_trial_early(p_now timestamptz)
returns jsonb
language plpgsql stable
set search_path = 'public'
as $fn$
declare
  v_on timestamptz;
  v_off bigint;
  v_out jsonb;
begin
  v_on := public._admin_test_release_seen(p_now);

  if v_on is null then
    with ex as materialized (select x.user_id from public._admin_test_excluded() x)
    select count(distinct s.user_id) into v_off
      from (
        select p.user_id
          from public.profiles p
          join auth.users u on u.id = p.user_id
         where p.settings->'experiments' ? 'trial_early'
           and u.created_at >= p_now - interval '30 days' and u.created_at < p_now
        union
        select e.user_id
          from public.analytics_events e
         where e.event = 'app_open' and e.props ? 'exp_trial_early'
           and e.occurred_at >= p_now - interval '7 days' and e.occurred_at < p_now
           and e.user_id is not null
      ) s
     where s.user_id not in (select user_id from ex);
  else
    with ex as materialized (select x.user_id from public._admin_test_excluded() x)
    select count(distinct e.user_id) into v_off
      from public.analytics_events e
     where e.props ? 'exp_trial_early'
       and e.occurred_at >= v_on - interval '7 days' and e.occurred_at < v_on
       and e.user_id is not null
       and e.user_id not in (select user_id from ex);
  end if;

  with ex as materialized (select x.user_id from public._admin_test_excluded() x),
  st as (
    select p.user_id, p.settings->'experiments'->>'trial_early' as arm
      from public.profiles p
     where v_on is not null
       and p.settings->'experiments'->>'trial_early' in ('A', 'B')
       and p.user_id not in (select user_id from ex)
  ),
  views as (
    select e.user_id, s.arm, e.occurred_at,
           case when coalesce(e.props->>'count', e.props->>'demo_cards') ~ '^\d+$'
                then coalesce(e.props->>'count', e.props->>'demo_cards')::int end as shown_n,
           case when e.props->>'server_cards' ~ '^\d+$' then (e.props->>'server_cards')::int end as server_n,
           e.props->>'trial_reason' as reason,
           coalesce(e.props->>'trial_pending', '') = 'true' as pending
      from public.analytics_events e
      join st s on s.user_id = e.user_id
     where e.event in ('up_chip_view', 'first_value_upgrade_view', 'pricing_view', 'up_settings_view')
       and (e.event <> 'pricing_view' or e.props->>'surface' = 'modal')
       and e.occurred_at >= v_on and e.occurred_at < p_now
       -- Only builds that carry the switch: an old build never offers 'early'.
       and e.props->>'build' in (select b from public._admin_test_release_builds(p_now) b)
  ),
  -- Anyone offered the upgrade before on_from, or after it on a build without
  -- the switch (an old tab), has seen the offer without the early trial: out.
  seen_before as (
    select distinct e.user_id
      from public.analytics_events e
      join st s on s.user_id = e.user_id
     where e.event in ('up_chip_view', 'first_value_upgrade_view', 'pricing_view', 'up_settings_view')
       and (e.event <> 'pricing_view' or e.props->>'surface' = 'modal')
       and e.occurred_at < p_now
       and (e.occurred_at < v_on
            or coalesce(e.props->>'build', '') not in (select b from public._admin_test_release_builds(p_now) b))
  ),
  first_view as (
    select distinct on (v.user_id) v.*
      from views v
     where v.shown_n between 1 and 12 and v.server_n between 1 and 12
       and not v.pending
       and v.user_id not in (select user_id from seen_before)
     order by v.user_id, v.occurred_at
  ),
  pressed as (
    select f.*,
           exists (select 1 from public.analytics_events e
                    where e.user_id = f.user_id
                      and e.event in ('up_chip_click', 'first_value_upgrade_cta', 'pricing_creator_intent',
                                      'pricing_team_start', 'up_settings_upgrade_click')
                      and coalesce(e.props->>'already_paid', '') <> 'true'
                      and e.occurred_at >= f.occurred_at
                      and e.occurred_at < f.occurred_at + interval '14 days'
                      and e.occurred_at < p_now) as hit
      from first_view f
  ),
  r (m, arm, mature, hit, ready_at) as (
    select 'press_14d', arm, occurred_at <= p_now - interval '14 days', hit, occurred_at + interval '14 days'
      from pressed
  ),
  agg as (
    select m, jsonb_build_object(
      'A', jsonb_build_object('n', count(*) filter (where arm = 'A' and mature), 'k', count(*) filter (where arm = 'A' and mature and hit)),
      'B', jsonb_build_object('n', count(*) filter (where arm = 'B' and mature), 'k', count(*) filter (where arm = 'B' and mature and hit)),
      'due', count(*),
      'next', min(ready_at) filter (where not mature)) as v
      from r group by m
  )
  select jsonb_build_object(
    'stamped_off', v_off,
    'on_from', v_on,
    'in', jsonb_build_object(
      'A', (select count(*) from st where arm = 'A'),
      'B', (select count(*) from st where arm = 'B')),
    'measures', jsonb_build_object('press_14d', coalesce((select v from agg where m = 'press_14d'),
      jsonb_build_object('A', jsonb_build_object('n', 0, 'k', 0), 'B', jsonb_build_object('n', 0, 'k', 0),
                         'due', 0, 'next', null))),
    'signals', jsonb_build_object(
      'reach', jsonb_build_object(
        'views', (select count(*) from first_view where arm = 'B'),
        'early', (select count(*) from first_view where arm = 'B' and reason = 'early')),
      'leak', (select count(*) from views where arm = 'A' and reason = 'early')))
  into v_out;
  return v_out;
end
$fn$;

-- ── The hold-back runs 12 weeks ─────────────────────────────────────────────
update public.app_config c
   set value = c.value || jsonb_build_object(
         'activate_nudge_1', (c.value -> 'activate_nudge_1') || jsonb_build_object('holdout_weeks', 12),
         'board_waiting', (c.value -> 'board_waiting') || jsonb_build_object('holdout_weeks', 12)),
       updated_at = now()
 where c.key = 'lifecycle_email_experiments'
   and c.value ? 'activate_nudge_1'
   and c.value ? 'board_waiting';

revoke execute on function public._admin_test_release_builds(timestamptz) from public, anon, authenticated;
revoke execute on function public._admin_test_release_seen(timestamptz) from public, anon, authenticated;
revoke execute on function public._admin_test_first_board_more(timestamptz) from public, anon, authenticated;
revoke execute on function public._admin_test_signup_box(timestamptz) from public, anon, authenticated;
revoke execute on function public._admin_test_email_holdout(timestamptz) from public, anon, authenticated;
revoke execute on function public._admin_test_share_ask(timestamptz) from public, anon, authenticated;
revoke execute on function public._admin_test_trial_early(timestamptz) from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public._admin_test_release_builds(timestamptz)',
    'public._admin_test_release_seen(timestamptz)',
    'public._admin_test_first_board_more(timestamptz)',
    'public._admin_test_signup_box(timestamptz)',
    'public._admin_test_email_holdout(timestamptz)',
    'public._admin_test_share_ask(timestamptz)',
    'public._admin_test_trial_early(timestamptz)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '0855: anon can execute %', f;
    end if;
    if has_function_privilege('authenticated', f, 'execute') then
      raise exception '0855: authenticated can execute %', f;
    end if;
  end loop;
  if (select count(*) from public.app_config c
       where c.key = 'lifecycle_email_experiments'
         and c.value -> 'activate_nudge_1' ->> 'holdout_weeks' = '12'
         and c.value -> 'board_waiting' ->> 'holdout_weeks' = '12') <> 1 then
    raise exception '0855: the hold-back is not set to 12 weeks for both emails';
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
