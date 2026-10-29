-- 0810_admin_tests_read.sql — the admin's Analytics › Tests: every test, its
-- two sides compared, and whether it is really running (the owner, 2026-10-29:
-- "see all the current tests and compare them to what things were by default
-- and make sure the tests are actually running properly").
--
-- admin_tests_read(p_now) returns, per test, counts only: who is on each side,
-- who could have been and isn't, the last event from each side, people seen on
-- the wrong side, a test's own event (when last seen, and how many were due it
-- since), and each measure as { A: {n, k}, B: {n, k}, due, next }, where n counts
-- only people old enough for the measure's window, due counts everyone in its
-- population, and next is when the first one not yet counted will be. Rates,
-- gaps, ranges and every word on the page are worked out in the browser
-- (boards/src/lib/testsView.js), from the list in boards/src/lib/testsCatalog.js.
--
-- Each measure is the one its test's saved read uses, cohort, maturity and all.
-- Those reads (outside this public repo) also hold what counts as a win; nothing
-- here does. Internal accounts (_internal_user_ids), service and banned
-- accounts are left out of everything, always: the page has no toggle for it.
--
-- One test's read failing doesn't blank the page: it comes back as {error}, and
-- the page says that test couldn't be checked.
--
-- The start instants are the code's own and testsMigration.test.mjs keeps them
-- equal: SETUP_EPOCH (lib/setupRule.js), BOARD_MORE_EPOCH (lib/boardMoreEpoch.js),
-- signup_box.startsAt (lib/experiments.js), SHARE_ASK_RELEASE and
-- SHARE_ASK_BEFORE_FROM, EMAIL_HOLDOUT_START (lib/testsCatalog.js).
--
-- New: admin_tests_read, admin only (_require_admin), EXECUTE for authenticated
-- and service_role only (0311). Every _admin_test_* helper is revoked from
-- public, anon and authenticated.

begin;

set local lock_timeout = '3s';

-- ── Who is left out ──────────────────────────────────────────────────────────
create or replace function public._admin_test_excluded()
returns table (user_id uuid)
language sql stable
set search_path = 'public'
as $$
  select i.user_id from public._internal_user_ids() i where i.user_id is not null
  union
  select p.user_id from public.profiles p
   where p.banned_at is not null or coalesce(p.is_service, false)
$$;

-- ── A coin flip on accounts: who is on each side ────────────────────────────
-- Accounts made since the start, by the side stamped on their profile at their
-- first App load (profiles.settings.experiments.<key>). The rest never reached
-- the app. last: the newest event from anyone on each side.
create or replace function public._admin_test_accounts(p_key text, p_start timestamptz, p_now timestamptz)
returns jsonb
language sql stable
set search_path = 'public'
as $$
  with ex as materialized (select x.user_id from public._admin_test_excluded() x),
  acc as (
    select u.id as user_id, u.created_at, p.settings->'experiments'->>p_key as arm
      from auth.users u
      join public.profiles p on p.user_id = u.id
     where u.created_at >= p_start and u.created_at < p_now
       and u.id not in (select user_id from ex)
  ),
  last_ev as (
    select a.arm, max(l.at) as at
      from acc a
      cross join lateral (
        select e.occurred_at as at from public.analytics_events e
         where e.user_id = a.user_id and e.occurred_at < p_now
         order by e.occurred_at desc limit 1
      ) l
     where a.arm in ('A', 'B')
     group by a.arm
  )
  select jsonb_build_object(
    'in', jsonb_build_object('A', count(*) filter (where arm = 'A'), 'B', count(*) filter (where arm = 'B')),
    'eligible', count(*),
    'recent', jsonb_build_object(
      'eligible', count(*) filter (where created_at >= p_now - interval '3 days'),
      'assigned', count(*) filter (where created_at >= p_now - interval '3 days' and arm in ('A', 'B'))),
    'last', jsonb_build_object(
      'A', (select at from last_ev where arm = 'A'),
      'B', (select at from last_ev where arm = 'B')))
  from acc
$$;

-- ── Workspace setup ─────────────────────────────────────────────────────────
-- workspace_setup_read.sql: return_7d_engaged (decides), joins_7d (also read),
-- canvas_reached_d1 and first_card_d1 (guardrails). Only B's steps log
-- setup_step, so one from someone in A is a leak.
create or replace function public._admin_test_workspace_setup(p_now timestamptz)
returns jsonb
language plpgsql stable
set search_path = 'public'
as $fn$
declare
  v_start constant timestamptz := '2026-10-22T07:00:00Z';
  v_rest jsonb;
begin
  with ex as materialized (select x.user_id from public._admin_test_excluded() x),
  pop as (
    select u.id as user_id, u.created_at, p.settings->'experiments'->>'workspace_setup' as arm, p.first_card_at
      from auth.users u
      join public.profiles p on p.user_id = u.id
     where u.created_at >= v_start and u.created_at < p_now
       and p.settings->'experiments'->>'workspace_setup' in ('A', 'B')
       and u.id not in (select user_id from ex)
  ),
  ev as (
    select v.user_id, v.ek, v.first_at
      from public._admin_engaged_visits((v_start at time zone 'utc')::date - 1, true, true, 2) v
     where v.engaged and v.first_at < p_now and v.user_id in (select user_id from pop)
  ),
  joins as (
    select l.created_by as owner_id, j.user_id as joiner_id, j.joined_at
      from public.workspace_invite_link_joins j
      join public.workspace_invite_links l on l.token = j.token
     where l.created_by in (select user_id from pop)
    union all
    select i.invited_by, i.claimed_by, i.claimed_at
      from public.pending_invites i
     where i.invited_by in (select user_id from pop) and i.claimed_at is not null
    union all
    select w.created_by, m.user_id, m.created_at
      from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id
     where w.created_by in (select user_id from pop) and m.role <> 'service'
    union all
    select s.invited_by, s.user_id, s.created_at
      from public.board_shares s
     where s.invited_by in (select user_id from pop)
  ),
  joins_clean as (
    select j.* from joins j
     where j.joiner_id is not null and j.joiner_id <> j.owner_id
       and j.joiner_id not in (select user_id from ex)
       and j.joined_at < p_now
  ),
  per as (
    select p.user_id, p.arm, p.created_at, e1.first_at as e1_at,
           (e1.first_at is not null and exists (
              select 1 from ev x where x.user_id = p.user_id and x.ek = 2
                 and x.first_at <= e1.first_at + interval '7 days')) as ret7,
           exists (select 1 from public.analytics_events e
                    where e.user_id = p.user_id and e.event = 'app_open'
                      and e.occurred_at < p.created_at + interval '24 hours') as canvas_d1,
           (p.first_card_at is not null and p.first_card_at < p.created_at + interval '24 hours') as card_d1,
           exists (select 1 from joins_clean j
                    where j.owner_id = p.user_id and j.joined_at < p.created_at + interval '7 days') as join7,
           (p.arm = 'A' and exists (select 1 from public.analytics_events e
                    where e.user_id = p.user_id and e.event = 'setup_step' and e.occurred_at < p_now)) as leak
      from pop p
      left join lateral (select min(x.first_at) as first_at from ev x where x.user_id = p.user_id and x.ek = 1) e1 on true
  ),
  r (m, arm, mature, hit, ready_at) as (
    select 'back_7d', arm,
           created_at <= p_now - interval '7 days' and (e1_at is null or e1_at <= p_now - interval '7 days'),
           ret7, coalesce(e1_at, created_at) + interval '7 days'
      from per
    union all
    select 'joined_7d', arm, created_at <= p_now - interval '7 days', join7, created_at + interval '7 days' from per
    union all
    select 'card_1d', arm, created_at <= p_now - interval '24 hours', card_d1, created_at + interval '24 hours' from per
    union all
    select 'board_1d', arm, created_at <= p_now - interval '24 hours', canvas_d1, created_at + interval '24 hours' from per
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
    'mismatched', (select count(*) from per where leak))
  into v_rest;
  return public._admin_test_accounts('workspace_setup', v_start, p_now) || v_rest;
end
$fn$;

-- ── First board asks for more ───────────────────────────────────────────────
-- first_board_more_read.sql: ten_plus_cards_d1 (aims at), return_7d_engaged
-- (decides), first_card_d1 and deleted_half_or_more_7d (guardrails). The toast
-- logs board_more_nudge {action}: 'eligible' in both arms when the third card
-- lands, 'view' only in B. A 'view' in A is a leak.
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
    'signals', jsonb_build_object('shown', jsonb_build_object(
      'last', (select at from last_view),
      'due', (select count(distinct n.user_id) from nudge n
               where n.arm = 'B' and n.action = 'eligible'
                 and n.occurred_at > coalesce((select at from last_view), v_start)))),
    'mismatched', (select count(distinct n.user_id) from nudge n where n.arm = 'A' and n.action = 'view'))
  into v_rest;
  return public._admin_test_accounts('first_board_more', v_start, p_now) || v_rest;
end
$fn$;

-- ── The sign-up box on the search pages ─────────────────────────────────────
-- signup_box_read.sql: a coin per device (analytics session_id), carried as
-- exp_signup_box on the device's lp_view. Devices that had an account before
-- they first saw a page in the test are left out. new_account_24h (decides),
-- first_card_24h of those who signed up (guardrail). The pages that can show the
-- box are the signed-out tool, compare, hub and listicle pages; a device that
-- saw one and carries no side is on neither.
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
           e.props->>'exp_signup_box' as arm, e.props->>'page_kind' as kind
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
  -- Had an account before first seeing a page in the test: the read's rule,
  -- from the first page with a side for the measures, and from the first page
  -- that could have shown the box for who could have been in it.
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
  r (m, arm, mature, hit, ready_at) as (
    select 'signup_1d', d.arm, d.first_at <= p_now - interval '24 hours',
           exists (select 1 from signups s where s.device = d.device),
           d.first_at + interval '24 hours'
      from devices d
    union all
    select 'card_1d', d.arm, s.created_at <= p_now - interval '24 hours',
           s.first_card_at is not null and s.first_card_at < s.created_at + interval '24 hours',
           s.created_at + interval '24 hours'
      from signups s join devices d on d.device = s.device
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
    'measures', coalesce((select jsonb_object_agg(m, v) from agg), '{}'::jsonb))
  into v_out;
  return v_out;
end
$fn$;

-- ── Follow-up emails, half held back ────────────────────────────────────────
-- 0790's hold-back: half of those due activate_nudge_1 or board_waiting get no
-- email (lifecycle_email_log.status 'held_out'; 'sent' is the other side). It
-- began when 0790 was applied, 2026-10-29 01:37:57Z: sends before that instant
-- had no coin, so they are not counted, even on holdout_from's own day.
-- Made something: admin_email_impact's measure (0494), a card placed or edited
-- or a doc edited in the 72 hours after the send, or after the moment a
-- held-back person would have had it. Opened the app: an app_open in the 7 days.
-- A held-back person later sent the same email is a leak.
create or replace function public._admin_test_email_holdout(p_now timestamptz)
returns jsonb
language plpgsql stable
set search_path = 'public'
as $fn$
declare
  v_cfg jsonb;
  v_from_raw text;
  v_pct_raw text;
  v_start timestamptz := '2026-10-29T01:38:00Z';
  v_pct int;
  v_out jsonb;
begin
  select c.value into v_cfg from public.app_config c where c.key = 'lifecycle_email_experiments';
  v_from_raw := v_cfg -> 'activate_nudge_1' ->> 'holdout_from';
  if v_from_raw ~ '^\d{4}-\d{2}-\d{2}$' then
    v_start := greatest(v_start, (v_from_raw::date)::timestamp at time zone 'utc');
  end if;
  -- The share held back, as configured (the split check expects it); the page
  -- divides, not this.
  v_pct_raw := v_cfg -> 'activate_nudge_1' ->> 'holdout_pct';
  if v_pct_raw ~ '^\d{1,3}$' then
    v_pct := least(v_pct_raw::int, 100);
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
  r (m, arm, mature, hit, ready_at) as (
    select case when email_type = 'activate_nudge_1' then 'nudge_made_72h' else 'waiting_made_72h' end,
           arm, sent_at <= p_now - interval '72 hours', made, sent_at + interval '72 hours'
      from per
    union all
    select case when email_type = 'activate_nudge_1' then 'nudge_open_7d' else 'waiting_open_7d' end,
           arm, sent_at <= p_now - interval '7 days', opened, sent_at + interval '7 days'
      from per
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
-- share_ask_read.sql: not a coin flip. Everyone got it with the release, so
-- "before" (A) is Sep 28 to the release and "since" (B) is the release on. A
-- crossing is someone's first card_placed in a window that takes a cluster from
-- under 10 cards to 10 or more. shown_1d (aims at): a share_ask_shown from a
-- minute before the crossing to a day after. tips (guardrail): power reveals
-- engaged, of those shown, everyone, per window. Accounts that made a public link
-- on 2026-10-15 (one classroom) are left out, as the read does.
create or replace function public._admin_test_share_ask(p_now timestamptz)
returns jsonb
language plpgsql stable
set search_path = 'public'
as $fn$
declare
  v_before constant timestamptz := '2026-09-28T00:00:00Z';
  v_live constant timestamptz := '2026-10-29T05:15:00Z';
  v_out jsonb;
begin
  with ex as materialized (
    select x.user_id from public._admin_test_excluded() x
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
  r (m, arm, mature, hit, ready_at) as (
    select 'shown_1d', arm, crossed_at <= p_now - interval '1 day', shown, crossed_at + interval '1 day' from after1d
  ),
  agg as (
    select m, jsonb_build_object(
      'A', jsonb_build_object('n', count(*) filter (where arm = 'A' and mature), 'k', count(*) filter (where arm = 'A' and mature and hit)),
      'B', jsonb_build_object('n', count(*) filter (where arm = 'B' and mature), 'k', count(*) filter (where arm = 'B' and mature and hit)),
      'due', count(*) filter (where arm = 'B'),
      'next', min(ready_at) filter (where not mature and arm = 'B')) as v
      from r group by m
  )
  select jsonb_build_object(
    'start', v_live,
    'in', jsonb_build_object(
      'A', (select count(*) from crossings where arm = 'A'),
      'B', (select count(*) from crossings where arm = 'B')),
    'shown', (select count(*) from after1d where arm = 'B' and shown),
    'signals', jsonb_build_object('ask_at_10', jsonb_build_object(
      'last', (select last from asks),
      'due', (select count(*) from crossings c
               where c.arm = 'B' and c.crossed_at > coalesce((select last from asks), v_live)))),
    'measures', coalesce((select jsonb_object_agg(m, v) from agg), '{}'::jsonb)
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

-- ── The free trial from the first card: switched off ────────────────────────
-- While it is off nobody should get a side: a stamp on an account made in the
-- last 30 days, or an app_open carrying exp_trial_early in the last 7, is one.
create or replace function public._admin_test_trial_early(p_now timestamptz)
returns jsonb
language sql stable
set search_path = 'public'
as $$
  with ex as materialized (select x.user_id from public._admin_test_excluded() x)
  select jsonb_build_object('stamped_off', count(distinct s.user_id))
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
   where s.user_id not in (select user_id from ex)
$$;

-- ── The what's-new email's two versions ─────────────────────────────────────
-- A rotation, not a coin per person: lifecycle_email_experiments.whats_new keeps
-- each version's sends (n) and the people back within a day (reward). Idle when
-- nothing went out in 14 days.
create or replace function public._admin_test_whats_new(p_now timestamptz)
returns jsonb
language plpgsql stable
set search_path = 'public'
as $fn$
declare
  v_stats jsonb;
  v_last timestamptz;
  v_na int; v_nb int; v_ka int; v_kb int;
begin
  select c.value -> 'whats_new' -> 'stats' into v_stats
    from public.app_config c where c.key = 'lifecycle_email_experiments';
  select max(s.sent_at) into v_last from public.email_sends s
   where s.template = 'whats_new' and s.sent_at < p_now;
  v_na := case when v_stats -> 'A' ->> 'n' ~ '^\d+$' then (v_stats -> 'A' ->> 'n')::int else 0 end;
  v_nb := case when v_stats -> 'B' ->> 'n' ~ '^\d+$' then (v_stats -> 'B' ->> 'n')::int else 0 end;
  v_ka := case when v_stats -> 'A' ->> 'reward' ~ '^\d+$' then (v_stats -> 'A' ->> 'reward')::int else 0 end;
  v_kb := case when v_stats -> 'B' ->> 'reward' ~ '^\d+$' then (v_stats -> 'B' ->> 'reward')::int else 0 end;
  return jsonb_build_object(
    'in', jsonb_build_object('A', v_na, 'B', v_nb),
    'last_run', v_last,
    'idle', v_last is null or v_last < p_now - interval '14 days',
    'measures', jsonb_build_object('back_1d', jsonb_build_object(
      'A', jsonb_build_object('n', v_na, 'k', least(v_ka, v_na)),
      'B', jsonb_build_object('n', v_nb, 'k', least(v_kb, v_nb)),
      'due', v_na + v_nb, 'next', null)));
end
$fn$;

-- ── The read ────────────────────────────────────────────────────────────────
create or replace function public.admin_tests_read(p_now timestamptz default now())
returns jsonb
language plpgsql stable security definer
set search_path = 'public'
as $fn$
declare
  v_tests jsonb := '{}'::jsonb;
  v_part jsonb;
  v_key text;
begin
  perform public._require_admin();
  foreach v_key in array array['workspace_setup', 'first_board_more', 'signup_box', 'email_holdout',
                               'share_ask', 'trial_early', 'whats_new'] loop
    begin
      execute format('select public.%I($1)', '_admin_test_' || v_key) into v_part using p_now;
    exception when others then
      v_part := jsonb_build_object('error', sqlstate);
    end;
    v_tests := v_tests || jsonb_build_object(v_key, v_part);
  end loop;
  return jsonb_build_object('now', p_now, 'tests', v_tests);
end
$fn$;

revoke execute on function public.admin_tests_read(timestamptz) from public, anon;
grant execute on function public.admin_tests_read(timestamptz) to authenticated, service_role;

revoke execute on function public._admin_test_excluded() from public, anon, authenticated;
revoke execute on function public._admin_test_accounts(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public._admin_test_workspace_setup(timestamptz) from public, anon, authenticated;
revoke execute on function public._admin_test_first_board_more(timestamptz) from public, anon, authenticated;
revoke execute on function public._admin_test_signup_box(timestamptz) from public, anon, authenticated;
revoke execute on function public._admin_test_email_holdout(timestamptz) from public, anon, authenticated;
revoke execute on function public._admin_test_share_ask(timestamptz) from public, anon, authenticated;
revoke execute on function public._admin_test_trial_early(timestamptz) from public, anon, authenticated;
revoke execute on function public._admin_test_whats_new(timestamptz) from public, anon, authenticated;

do $$
declare
  f text;
begin
  if has_function_privilege('anon', 'public.admin_tests_read(timestamptz)', 'execute') then
    raise exception '0810: anon can execute admin_tests_read';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_tests_read(timestamptz)', 'execute') then
    raise exception '0810: authenticated cannot execute admin_tests_read';
  end if;
  if not has_function_privilege('service_role', 'public.admin_tests_read(timestamptz)', 'execute') then
    raise exception '0810: service_role cannot execute admin_tests_read';
  end if;
  foreach f in array array[
    'public._admin_test_excluded()',
    'public._admin_test_accounts(text, timestamptz, timestamptz)',
    'public._admin_test_workspace_setup(timestamptz)',
    'public._admin_test_first_board_more(timestamptz)',
    'public._admin_test_signup_box(timestamptz)',
    'public._admin_test_email_holdout(timestamptz)',
    'public._admin_test_share_ask(timestamptz)',
    'public._admin_test_trial_early(timestamptz)',
    'public._admin_test_whats_new(timestamptz)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '0810: anon can execute %', f;
    end if;
    if has_function_privilege('authenticated', f, 'execute') then
      raise exception '0810: authenticated can execute %', f;
    end if;
  end loop;
end
$$;

notify pgrst, 'reload schema';

commit;
