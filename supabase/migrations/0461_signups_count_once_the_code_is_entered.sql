-- 0461_signups_count_once_the_code_is_entered.sql
--
-- A signup counts once the emailed code is entered, not when an address is
-- typed (owner decision, 2026-10-20).
--
-- Email autoconfirm is on, so signInWithOtp creates the account already
-- confirmed and signed in, with one session, the moment an address is
-- submitted. 0149's "verified" (email_confirmed_at and last_sign_in_at both
-- set) is true for every one of those rows. So every admin count of signups
-- and users has included addresses that asked for a code and never entered
-- it: typos, second tries under another address, mail that never arrived, and
-- people who gave up at the code step. None of those accounts ever placed a
-- card.
--
-- From here an account is a signup once there is evidence its owner got in.
-- _admin_entered_code() returns those accounts, and any one of these is enough:
--   * it owns a workspace, which only the signed-in app makes;
--   * it has a day in user_active_day, the signed-in heartbeat;
--   * it has a second auth session. The first is made with the account, so one
--     proves nothing; entering the code makes the second;
--   * it has a client analytics event (session_id set). The server writes its
--     own rows (tier_changed, referral_signup and the like) without one, some
--     of them for accounts that never got in.
-- Workspaces and presence days are never purged, so the verdict outlives the
-- 400-day analytics purge.
--
-- Every admin reader that took 0149's rule now asks the helper instead: the
-- `p_verified_only` filter, the Users tab's 'verified' / 'unverified', and the
-- populations that filtered on email_confirmed_at alone. Section 2 is the live
-- bodies with only that predicate replaced, checked by md5 against the
-- database as it was applied, so nothing else in them moves. "Verified"
-- now means what it says: the address was proven by entering its code.
--
-- A signup stays dated by the account's created_at, which is when the code was
-- asked for. Entering it follows within minutes.
--
-- History moves with it. The readers judge every past week by today's
-- evidence, and the tail below rewrites metrics_daily's signups and
-- total_users the same way, so no chart steps down at this migration and
-- adminDefinitionBreaks.js needs no marker.
--
-- Also here (section 3):
--   * admin_signup_funnel names its steps for what they count, "Asked for a
--     code" and "Entered the code", and gains a leak row, "Never entered the
--     code": the browsers that asked for one and never entered it;
--   * admin_universe_stats counts people once for all three of its windows;
--   * admin_journey_dropoff orders the new 'setup' phase between ad_welcome and
--     app_enter, as JOURNEY_PHASE_ORDER does in analyticsEvents.js;
--   * admin_return_predictors reads its day-one events in one pass. It asked
--     them again for every signal and every person, a cost that grew with the
--     square of the signups and outran the API's statement timeout, so the
--     Retention panel's predictors never loaded. Same rows, checked against the
--     old body on cohorts small enough for it to finish.
--
-- Not changed, on purpose:
--   * lifecycle email targeting and the file-share access checks, which decide
--     who gets mail or a file, not what a chart says;
--   * experiment_optimize, the bandit's reward, because changing it moves live
--     traffic;
--   * the platform_counters triggers and reconcilers, which nothing reads now;
--   * the archived _0149 / _0159 / _0332 copies, which nothing calls.
--
-- Four of section 2's bodies had drifted from their files before this one, and
-- are recorded here as they are live: admin_first_session_compare,
-- admin_retention_cohort_matrix and admin_stats are live without comments their
-- files carry, admin_first_session_compare also runs with work_mem = '24MB',
-- and admin_user_lifespan labels its buckets '0-1', '3-4' with hyphens where
-- its file has dashes.

begin;

set local lock_timeout = '3s';

-- ── 1. The one definition of a signup ──────────────────────────────────────

create or replace function public._admin_entered_code()
returns table (entered_id uuid)
language sql stable security definer set search_path = public
as $$
  -- Cheapest evidence first. Asking for a code can make none of it.
  select u.id
    from auth.users u
   where u.email_confirmed_at is not null
     and (   u.id in (select w.created_by from public.workspaces w)
          or u.id in (select d.user_id from public.user_active_day d)
          or (select count(*) from auth.sessions s where s.user_id = u.id) > 1
          or exists (select 1 from public.analytics_events e
                      where e.user_id = u.id and e.session_id is not null));
$$;

revoke all on function public._admin_entered_code() from public, anon, authenticated;
grant execute on function public._admin_entered_code() to service_role;

comment on function public._admin_entered_code() is
  '0461: accounts whose owner has entered the emailed sign-in code, which is what /admin counts as a signup.';


-- ── 2. Every reader that took 0149's rule asks the helper instead ───────────
-- Each body below is the live one with only that predicate replaced.

create or replace function public._admin_people(p_exclude_internal boolean, p_verified_only boolean)
returns table (user_id uuid, created_at timestamptz)
language sql stable security definer set search_path = public
as $function$
  select u.id, u.created_at
    from auth.users u
   where (not p_verified_only
          or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
     and (not p_exclude_internal
          or u.id not in (select iu.user_id from public._internal_user_ids() iu));
$function$;

create or replace function public._admin_visits(p_since date, p_exclude_internal boolean, p_verified_only boolean, p_merge_hours integer)
returns table (user_id uuid, k integer, day date, first_at timestamptz, last_at timestamptz, did_work boolean)
language sql stable security definer set search_path = public
as $function$
  with u as (
    select usr.id as user_id
      from auth.users usr
     where usr.created_at >= p_since
       and (not p_verified_only
            or (usr.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and (not p_exclude_internal
            or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  -- One row per UTC day per user, with whether anything real happened. The
  -- passive list is telemetry the client emits on its own schedule; a day made
  -- only of these is a tab, not a person.
  days as (
    select e.user_id,
           (e.occurred_at at time zone 'utc')::date as day,
           min(e.occurred_at) as first_at,
           max(e.occurred_at) as last_at,
           bool_or(e.event not in (
             'ps_heartbeat', 'ps_pause', 'ps_trace', 'session_summary', 'up_suppressed',
             'experiment_enrolled', 'ps_tier_resolved', 'lp_trace', 'app_trace', 'up_trace',
             'ps_seed_skip', 'ps_seed_start', 'ps_seed_done', 'instant_entry_skip',
             'lp_dwell', 'landing_dwell', 'pricing_dwell', 'ps_end', 'telemetry_drop',
             'resume_greet_shown'
           )) as real
      from public.analytics_events e
      join u on u.user_id = e.user_id
     group by e.user_id, (e.occurred_at at time zone 'utc')::date
  ),
  -- A day starts a NEW visit unless it begins within p_merge_hours of the
  -- previous day's last event — that is the same sitting crossing midnight.
  marked as (
    select d.*,
           case when d.first_at - lag(d.last_at) over (partition by d.user_id order by d.day)
                     < make_interval(hours => greatest(coalesce(p_merge_hours, 0), 0))
                then 0 else 1 end as nv
      from days d
  ),
  numbered as (
    select m.*, sum(m.nv) over (partition by m.user_id order by m.day) as vn
      from marked m
  ),
  merged as (
    select n.user_id, n.vn,
           min(n.day) as day,
           min(n.first_at) as first_at,
           max(n.last_at) as last_at,
           bool_or(n.real) as real,
           bool_or(exists (
             select 1 from public.user_active_day a
              where a.user_id = n.user_id and a.day = n.day and a.did_work
           )) as did_work
      from numbered n
     group by n.user_id, n.vn
  )
  -- Renumber AFTER dropping phantom visits, so k=2 is the second time a person
  -- actually showed up, not the second calendar day a tab was alive.
  select m.user_id,
         row_number() over (partition by m.user_id order by m.first_at)::int as k,
         m.day, m.first_at, m.last_at, m.did_work
    from merged m
   where m.real
$function$;

create or replace function public.admin_acquisition_breakdown(p_days integer, p_exclude_internal boolean default true, p_verified_only boolean default true)
returns table (source text, signups integer, converted integer, conversion numeric)
language plpgsql stable security definer set search_path = public
as $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  return query
  with src as (
    select public.derive_acquisition_channel(p.first_source) as source,
           p.first_paid_at is not null as paid
      from public.profiles p
      join auth.users u on u.id = p.user_id
     where (not p_verified_only or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and u.created_at >= now() - (p_days || ' days')::interval
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  )
  select source,
         count(*)::int as signups,
         sum(case when paid then 1 else 0 end)::int as converted,
         round(sum(case when paid then 1 else 0 end)::numeric / nullif(count(*), 0), 4) as conversion
    from src group by source order by signups desc;
end;
$function$;

create or replace function public.admin_acquisition_channels(p_verification text default 'all', p_activity text default 'all')
returns table (channel text, n integer)
language plpgsql stable security definer set search_path = public
as $function$
declare
  v_v text := lower(coalesce(nullif(trim(p_verification), ''), 'all'));
  v_a text := lower(coalesce(nullif(trim(p_activity), ''), 'all'));
begin
  perform public._require_admin();
  return query
  select public.derive_acquisition_channel(p.first_source) as channel, count(*)::int as n
    from auth.users u
    left join public.profiles p on p.user_id = u.id
   where (case v_v
            when 'verified'   then (u.id in (select ec.entered_id from public._admin_entered_code() ec))
            when 'unverified' then (u.id not in (select ec.entered_id from public._admin_entered_code() ec))
            else true
          end)
     and (case v_a
            when 'active'   then u.id in     (select m.user_id from public._admin_made_something() m)
            when 'inactive' then u.id not in (select m.user_id from public._admin_made_something() m)
            else true
          end)
   group by 1
   order by n desc, channel asc;
end $function$;

create or replace function public.admin_activation_by_experiment(p_key text, p_days integer default 30, p_exclude_internal boolean default true)
returns table (arm text, enrolled integer, first_card integer, first_card_pct numeric, populated integer, populated_pct numeric, returned integer, returned_pct numeric, paid integer, paid_pct numeric, mean_reward numeric)
language plpgsql stable security definer set search_path = public
as $function$
#variable_conflict use_column
declare v_rw jsonb; v_wmax numeric;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  select coalesce(value->p_key->'reward_weights', '{"first_card":1,"populated":2,"returned":3,"paid":14}'::jsonb)
    into v_rw from public.app_config where key = 'experiments';
  v_rw := coalesce(v_rw, '{"first_card":1,"populated":2,"returned":3,"paid":14}'::jsonb);
  v_wmax := coalesce((v_rw->>'first_card')::numeric,1) + coalesce((v_rw->>'populated')::numeric,2)
          + coalesce((v_rw->>'returned')::numeric,3)  + coalesce((v_rw->>'paid')::numeric,14);
  if v_wmax <= 0 then v_wmax := 1; end if;
  return query
  with p as (
    select pr.user_id,
           pr.first_card_at, pr.first_populated_board_at, pr.first_paid_at,
           pr.settings->'experiments'->>p_key as arm,
           exists(select 1 from public.user_active_day a where a.user_id = pr.user_id and a.day > u.created_at::date) as did_return
      from public.profiles pr
      join auth.users u on u.id = pr.user_id
     where u.id in (select ec.entered_id from public._admin_entered_code() ec)
       and u.created_at >= now() - (p_days || ' days')::interval
       and pr.settings->'experiments'->>p_key is not null
       and (not p_exclude_internal or u.id not in (select user_id from public._internal_user_ids()))
  )
  select p.arm,
         count(*)::int,
         count(*) filter (where p.first_card_at is not null)::int,
         round(count(*) filter (where p.first_card_at is not null)::numeric / nullif(count(*),0), 4),
         count(*) filter (where p.first_populated_board_at is not null)::int,
         round(count(*) filter (where p.first_populated_board_at is not null)::numeric / nullif(count(*),0), 4),
         count(*) filter (where p.did_return)::int,
         round(count(*) filter (where p.did_return)::numeric / nullif(count(*),0), 4),
         count(*) filter (where p.first_paid_at is not null)::int,
         round(count(*) filter (where p.first_paid_at is not null)::numeric / nullif(count(*),0), 4),
         round(avg(
           ( coalesce((v_rw->>'first_card')::numeric,1) * (case when p.first_card_at is not null then 1 else 0 end)
           + coalesce((v_rw->>'populated')::numeric,2)  * (case when p.first_populated_board_at is not null then 1 else 0 end)
           + coalesce((v_rw->>'returned')::numeric,3)   * (case when p.did_return then 1 else 0 end)
           + coalesce((v_rw->>'paid')::numeric,14)      * (case when p.first_paid_at is not null then 1 else 0 end)
           ) / v_wmax), 4)
    from p group by p.arm order by p.arm;
end $function$;

create or replace function public.admin_activation_funnel(p_days integer, p_exclude_internal boolean, p_verified_only boolean, p_device text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $function$
#variable_conflict use_column
declare v_out jsonb; v_dev text;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  v_dev := nullif(trim(coalesce(p_device, '')), '');
  with p as (
    select pr.*
      from public.profiles pr
      join auth.users u on u.id = pr.user_id
      left join public._user_device_map() dm on dm.user_id = pr.user_id
     where (not p_verified_only or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and u.created_at >= now() - (p_days || ' days')::interval
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
       and (v_dev is null or coalesce(dm.device, 'unknown') = v_dev)
  )
  select jsonb_build_object(
    'signed_up',       (select count(*) from p),
    'first_board',     (select count(*) from p where first_board_at           is not null),
    'first_card',      (select count(*) from p where first_card_at            is not null),
    'populated_board', (select count(*) from p where first_populated_board_at is not null),
    'first_share',     (select count(*) from p where first_share_at           is not null),
    'first_backlink',  (select count(*) from p where first_backlink_at        is not null),
    'first_paid',      (select count(*) from p where first_paid_at            is not null)
  ) into v_out;
  return v_out;
end;
$function$;

create or replace function public.admin_activation_funnel(p_days integer, p_exclude_internal boolean default true, p_verified_only boolean default true)
returns jsonb
language plpgsql stable security definer set search_path = public
as $function$
#variable_conflict use_column
declare v_out jsonb;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  with p as (
    select pr.* from public.profiles pr join auth.users u on u.id = pr.user_id
     where (not p_verified_only or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and u.created_at >= now() - (p_days || ' days')::interval
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  )
  select jsonb_build_object(
    'signed_up',       (select count(*) from p),
    'first_board',     (select count(*) from p where first_board_at           is not null),
    'first_card',      (select count(*) from p where first_card_at            is not null),
    'populated_board', (select count(*) from p where first_populated_board_at is not null),
    'first_share',     (select count(*) from p where first_share_at           is not null),
    'first_backlink',  (select count(*) from p where first_backlink_at        is not null),
    'first_paid',      (select count(*) from p where first_paid_at            is not null)
  ) into v_out;
  return v_out;
end;
$function$;

create or replace function public.admin_avg_time_to_paid(p_verified_only boolean default true)
returns jsonb
language plpgsql stable security definer set search_path = public
as $function$
declare v_out jsonb;
begin
  perform public._require_admin();
  with conv as (
    select u.id as user_id, u.created_at as signed_up_at,
           min(ev.occurred_at) as first_paid_at
      from auth.users u
      join public.analytics_events ev
        on ev.user_id = u.id
       and (
         ev.event = 'inferred_first_paid'
      or (ev.event = 'tier_changed' and ev.props->>'to' = 'paid')
       )
     where (not p_verified_only or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
     group by u.id, u.created_at
  ),
  spans as (
    select extract(epoch from (first_paid_at - signed_up_at))::bigint as secs
      from conv
     where first_paid_at >= signed_up_at
  )
  select jsonb_build_object(
    'paid_users',     (select count(*) from spans),
    'avg_seconds',    (select coalesce(avg(secs), 0)::bigint from spans),
    'median_seconds', (select coalesce(
                              percentile_cont(0.5) within group (order by secs),
                              0)::bigint from spans)
  ) into v_out;
  return v_out;
end $function$;

create or replace function public.admin_engaged_weeks(p_asof date default current_date, p_since date default '2026-08-17', p_exclude_internal boolean default true, p_verified_only boolean default true, p_merge_hours integer default 2)
returns table (dim text, n integer, pct numeric)
language plpgsql stable security definer set search_path = public
as $function$
#variable_conflict use_column
declare
  v_asof  date := coalesce(p_asof, current_date);
  v_since date := coalesce(p_since, '2026-08-17'::date);
  v_merge int  := least(greatest(coalesce(p_merge_hours, 2), 0), 12);
begin
  perform public._require_admin();

  return query
  with eligible as (
    select usr.id as user_id
      from auth.users usr
     where usr.created_at >= v_since
       and usr.created_at < (v_asof - 28)::timestamptz
       and (not p_verified_only
            or (usr.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and (not p_exclude_internal
            or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  wk as (
    select el.user_id,
           count(distinct ((v_asof - 1 - v.day) / 7)) as weeks
      from eligible el
      join public._admin_engaged_visits(v_since, p_exclude_internal, p_verified_only, v_merge) v
        on v.user_id = el.user_id
       and v.engaged
       and v.day >= v_asof - 28
       and v.day < v_asof
     group by el.user_id
  ),
  per as (
    select el.user_id, coalesce(wk.weeks, 0)::int as weeks
      from eligible el left join wk on wk.user_id = el.user_id
  ),
  tot as (select count(*)::numeric as t from per),
  rows_ as (
    select 'eligible'::text as dim, count(*)::int as n from per
    union all
    select 'weeks:' || g.w, (select count(*)::int from per where per.weeks = g.w)
      from generate_series(0, 4) as g(w)
    union all
    select 'habitual', count(*)::int from per where per.weeks >= 3
  )
  select r.dim, r.n, round(r.n::numeric / nullif((select t from tot), 0), 4)
    from rows_ r;
end $function$;

create or replace function public.admin_event_coverage(p_days integer default 90, p_exclude_internal boolean default true, p_verified_only boolean default true)
returns table (milestone text, server_truth integer, client_event integer, coverage_pct numeric)
language plpgsql stable security definer set search_path = public
as $function$
declare v_since timestamptz;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  v_since := now() - (p_days || ' days')::interval;
  return query
  with eligible as (
    select u.id as uid from auth.users u
     where (not p_verified_only or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and u.created_at >= v_since
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  prof as (select p.* from public.profiles p where p.user_id in (select uid from eligible)),
  ev as (
    select event, count(distinct user_id) as users
      from public.analytics_events
     where user_id in (select uid from eligible) and occurred_at >= v_since
     group by event
  ),
  m as (
    select 'first_card'::text as milestone,
           (select count(*) from prof where first_card_at is not null)::int as server_truth,
           'onboarding_first_card'::text as ev_name
    union all
    select 'populated_board',
           (select count(*) from prof where first_populated_board_at is not null)::int, 'activated'
    union all
    select 'first_share',
           (select count(*) from prof where first_share_at is not null)::int, 'share_open'
    union all
    select 'first_paid',
           (select count(*) from prof where first_paid_at is not null)::int, 'checkout_success'
  )
  select m.milestone, m.server_truth,
         coalesce((select e.users from ev e where e.event = m.ev_name), 0)::int as client_event,
         round(coalesce((select e.users from ev e where e.event = m.ev_name), 0)::numeric
               / nullif(m.server_truth, 0), 4) as coverage_pct
    from m
   order by m.milestone;
end $function$;

create or replace function public.admin_feature_reach(p_since date default '2026-08-17', p_weeks integer default 12, p_exclude_internal boolean default true, p_verified_only boolean default true)
returns table (cohort text, feature text, n integer, d1 integer, d14_n integer, d14 integer)
language plpgsql stable security definer set search_path = public
as $function$
#variable_conflict use_column
declare
  v_since date := coalesce(p_since, '2026-08-17'::date);
  v_weeks int  := least(greatest(coalesce(p_weeks, 12), 1), 52);
begin
  perform public._require_admin();

  return query
  with u as (
    select usr.id as user_id, usr.created_at
      from auth.users usr
     where usr.created_at >= greatest(v_since, current_date - (7 * v_weeks))
       -- a day-one window still open cannot be read
       and usr.created_at <= now() - interval '24 hours'
       and (not p_verified_only
            or (usr.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and (not p_exclude_internal
            or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  -- The cohort: placed something real within two weeks. Reach among people
  -- who never placed a card is reach among people who never saw the canvas.
  placed as (
    select u.user_id, u.created_at
      from u
     where exists (
       select 1 from public.analytics_events e
        where e.user_id = u.user_id
          and e.event = 'card_placed'
          and coalesce(e.props->>'actor', 'user') not in ('seed', 'template', 'system')
          and e.occurred_at >= u.created_at
          and e.occurred_at <  u.created_at + interval '14 days'
     )
  ),
  feat(feature, event, kinds, view_eq) as (values
    ('list_view',   'list_browser_view',   null::text[],                                  null::text),
    ('list_view',   'view_mode_switch',    null,                                          'list'),
    ('writing',     'card_placed',         array['note', 'doc'],                          null),
    ('doc',         'doc_edit',            null,                                          null),
    ('doc',         'card_placed',         array['doc'],                                  null),
    ('grid',        'card_placed',         array['grid'],                                 null),
    ('cluster',     'card_placed',         array['board'],                                null),
    ('cluster',     'cluster_create',      null,                                          null),
    ('files_links', 'card_placed',         array['pdf', 'video', 'audio', 'file', 'link'], null),
    ('import',      'import_batch',        null,                                          null),
    ('share',       'share_open',          null,                                          null),
    ('share',       'share_link_created',  null,                                          null),
    ('share',       'share_link_copied',   null,                                          null),
    ('share',       'invite_sent',         null,                                          null),
    ('share',       'invite_link_created', null,                                          null),
    ('search',      'search_run',          null,                                          null),
    ('download',    'file_download',       null,                                          null),
    ('arrows',      'arrow_created',       null,                                          null),
    ('comments',    'comment_create',      null,                                          null),
    ('tags',        'tag_manual_apply',    null,                                          null),
    ('tags',        'tag_confirm',         null,                                          null),
    ('tags',        'tag_set_type',        null,                                          null),
    ('tags',        'tag_candidate_promote', null,                                        null),
    -- the education surfaces this read exists to grade (catalogued in
    -- boards/src/lib/analyticsEvents.js; zero until their client ships)
    ('help',        'help_open',           null,                                          null),
    ('docs_site',   'docs_open',           null,                                          null)
  ),
  hits as (
    select p.user_id, f.feature, min(e.occurred_at) as first_at
      from placed p
      join public.analytics_events e
        on e.user_id = p.user_id
       and e.occurred_at >= p.created_at
       and e.occurred_at <  p.created_at + interval '14 days'
      join feat f
        on f.event = e.event
       and (f.kinds is null or e.props->>'kind' = any (f.kinds))
       and (f.view_eq is null or e.props->>'view' = f.view_eq)
     group by p.user_id, f.feature
  ),
  -- A second cluster is the second project; card_placed{kind:'board'} is the
  -- durable record of a cluster being made (cluster_create only says which door).
  second as (
    select x.user_id, 'second_cluster'::text as feature, min(x.occurred_at) as first_at
      from (
        select p.user_id, e.occurred_at,
               row_number() over (partition by p.user_id order by e.occurred_at) as rn
          from placed p
          join public.analytics_events e
            on e.user_id = p.user_id
           and e.event = 'card_placed'
           and e.props->>'kind' = 'board'
           and coalesce(e.props->>'actor', 'user') not in ('seed', 'template', 'system')
           and e.occurred_at >= p.created_at
           and e.occurred_at <  p.created_at + interval '14 days'
      ) x
     where x.rn = 2
     group by x.user_id
  ),
  allhits as (select * from hits union all select * from second),
  features as (select distinct f.feature from feat f union all select 'second_cluster'),
  cohorts as (
    select p.user_id, p.created_at, 'all'::text as cohort from placed p
    union all
    select p.user_id, p.created_at, to_char(date_trunc('week', p.created_at), 'YYYY-MM-DD') from placed p
  ),
  joined as (
    select c.cohort, fe.feature, c.user_id,
           (c.created_at <= now() - interval '14 days') as matured,
           (h.first_at is not null and h.first_at < c.created_at + interval '24 hours') as on_d1,
           (h.first_at is not null) as by_d14
      from cohorts c
      cross join features fe
      left join allhits h on h.user_id = c.user_id and h.feature = fe.feature
  )
  select j.cohort, j.feature,
         count(distinct j.user_id)::int,
         count(distinct j.user_id) filter (where j.on_d1)::int,
         count(distinct j.user_id) filter (where j.matured)::int,
         count(distinct j.user_id) filter (where j.matured and j.by_d14)::int
    from joined j
   group by j.cohort, j.feature
   order by j.cohort, j.feature;
end $function$;

create or replace function public.admin_first_session_compare(p_since date default '2026-06-16', p_min_age_days integer default 14, p_exclude_internal boolean default true, p_verified_only boolean default true)
returns table (metric text, kind text, ord integer, measured_from date, returned_n integer, returned_val numeric, oneshot_n integer, oneshot_val numeric)
language plpgsql stable security definer set search_path = public set work_mem = '24MB'
as $function$
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
            or (usr.id in (select ec.entered_id from public._admin_entered_code() ec)))
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
end $function$;

create or replace function public.admin_geo_breakdown(p_days integer default 30, p_exclude_internal boolean default true)
returns jsonb
language plpgsql stable security definer set search_path = public
as $function$
declare v_out jsonb;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  with ev as (
    select e.session_id, e.user_id,
           coalesce(nullif(e.country, ''), 'unknown') as country
      from public.analytics_events e
     where e.occurred_at >= now() - (p_days || ' days')::interval
       and (not p_exclude_internal
            or e.session_id is null
            or e.session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  traffic as (
    select country as value,
           count(distinct session_id)::int as sessions,
           count(distinct user_id)::int    as users
      from ev group by country
  ),
  su as (
    select coalesce(nullif(p.signup_country, ''), 'unknown') as value,
           count(*)::int as signups,
           count(*) filter (where p.first_card_at is not null)::int as activated
      from public.profiles p
      join auth.users u on u.id = p.user_id
     where u.created_at >= now() - (p_days || ' days')::interval
       and u.id in (select ec.entered_id from public._admin_entered_code() ec)
       and (not p_exclude_internal
            or p.user_id not in (select iu.user_id from public._internal_user_ids() iu))
     group by 1
  )
  select jsonb_build_object(
    'by_country', coalesce((select jsonb_agg(jsonb_build_object(
                     'country', value, 'sessions', sessions, 'users', users)
                     order by sessions desc) from traffic), '[]'::jsonb),
    'signups',    coalesce((select jsonb_agg(jsonb_build_object(
                     'country', value, 'signups', signups, 'activated', activated)
                     order by signups desc) from su), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $function$;

create or replace function public.admin_landing_scorecard(p_days integer default 30, p_exclude_internal boolean default true)
returns json
language plpgsql stable security definer set search_path = public
as $function$
declare
  v_days  int := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := now() - make_interval(days => v_days);
begin
  perform public._require_admin();
  return (
    with ev as (
      select coalesce(e.props->>'page', e.props->>'path') as page,
             e.session_id, e.event, e.props, e.occurred_at
      from analytics_events e
      where e.occurred_at >= v_since
        and e.event in ('lp_view', 'lp_dwell', 'lp_cta_click', 'seo_landing_view')
        and coalesce(e.props->>'page', e.props->>'path') is not null
        and (not p_exclude_internal
             or e.session_id is null
             or e.session_id not in (select isess.session_id from public._internal_session_ids() isess))
    ),
    -- A view = lp_view, plus legacy seo_landing_view rows whose session never
    -- emitted lp_view for that page (pre-lp_* clients).
    view_ev as (
      select page, session_id, occurred_at,
             max(props->>'page_kind') over (partition by page) as page_kind
      from ev where event = 'lp_view'
      union all
      select s.page, s.session_id, s.occurred_at, null
      from ev s
      where s.event = 'seo_landing_view'
        and not exists (
          select 1 from ev v
          where v.event = 'lp_view' and v.page = s.page
            and v.session_id is not distinct from s.session_id
        )
    ),
    views as (
      select page,
             count(*)                    as views,
             count(distinct session_id)  as sessions,
             max(page_kind)              as page_kind
      from view_ev group by page
    ),
    dwell as (
      select page,
             count(*) as dwell_n,
             percentile_cont(0.5) within group (order by (props->>'ms')::numeric) as med_dwell_ms,
             percentile_cont(0.5) within group (order by
               case when (props->>'max_depth') ~ '^[0-9]+(\.[0-9]+)?$'
                    then (props->>'max_depth')::numeric end)                      as med_scroll
      from ev
      where event = 'lp_dwell'
        and (props->>'ms') ~ '^[0-9]+(\.[0-9]+)?$'          -- props are anon-writable; never cast junk
      group by page
    ),
    ctas as (
      select page,
             count(*)                   as cta_clicks,
             count(distinct session_id) as cta_sessions
      from ev
      where event = 'lp_cta_click' and coalesce(props->>'intent', 'signup') = 'signup'
      group by page
    ),
    refs as (
      select page, jsonb_object_agg(cls, n) as referrers
      from (
        -- utm-tagged, referrer-stripped assistant arrivals count as ai (0335).
        select page, seo_source_class(props->>'referrer_host', props->>'utm_source') as cls, count(*) as n
        from ev where event in ('lp_view', 'seo_landing_view')
        group by 1, 2
      ) t group by page
    ),
    signups as (
      select pr.first_source->>'landing_path' as page, count(*) as n
      from profiles pr
      join auth.users au on au.id = pr.user_id
      where au.created_at >= v_since
        and au.id in (select ec.entered_id from public._admin_entered_code() ec)
        and (not p_exclude_internal
             or pr.user_id not in (select iu.user_id from public._internal_user_ids() iu))
      group by 1
    ),
    perday as (
      select page, occurred_at::date as d, count(*) as n
      from view_ev group by 1, 2
    )
    select coalesce(json_agg(json_build_object(
             'page',         v.page,
             'page_kind',    v.page_kind,
             'views',        v.views,
             'sessions',     v.sessions,
             'dwell_n',      coalesce(d.dwell_n, 0),
             'med_dwell_ms', round(d.med_dwell_ms),
             'med_scroll',   round(d.med_scroll::numeric, 2),
             'cta_clicks',   coalesce(c.cta_clicks, 0),
             'cta_sessions', coalesce(c.cta_sessions, 0),
             'signups',      coalesce(s.n, 0),
             'referrers',    coalesce(r.referrers, '{}'::jsonb),
             'spark',        (select json_agg(coalesce(pd.n, 0) order by gs.d)
                              from generate_series(v_since::date, current_date, interval '1 day') gs(d)
                              left join perday pd on pd.page = v.page and pd.d = gs.d::date)
           ) order by v.sessions desc, v.views desc), '[]'::json)
    from views v
    left join dwell d   on d.page = v.page
    left join ctas c    on c.page = v.page
    left join refs r    on r.page = v.page
    left join signups s on s.page = v.page
  );
end;
$function$;

create or replace function public.admin_list_users(p_limit integer default 50, p_offset integer default 0, p_query text default null, p_tier text default null, p_sort text default 'recent', p_status text default null, p_source text default null, p_contacted text default null, p_verification text default 'verified', p_activity text default 'all')
returns table (user_id uuid, email text, tier text, card_count integer, seconds_in_app bigint, created_at timestamptz, last_sign_in_at timestamptz, subscription_plan text, subscription_status text, current_period_end timestamptz, subscription_amount_cents integer, subscription_discounted boolean, banned boolean, joined_waitlist boolean, display_name text, avatar_url text, color text, last_seen_at timestamptz, board_count integer, acquisition_source text, last_reached_out_at timestamptz, outreach_count integer, email_confirmed boolean, storage_bytes bigint, country text, last_worked_at timestamptz)
language plpgsql stable security definer set search_path = public
as $function$
declare
  v_q text := nullif(trim(coalesce(p_query,     '')), '');
  v_t text := nullif(trim(coalesce(p_tier,      '')), '');
  v_s text := nullif(trim(coalesce(p_status,    '')), '');
  v_o text := nullif(trim(coalesce(p_source,    '')), '');
  v_c text := nullif(trim(coalesce(p_contacted, '')), '');
  v_k text := lower(coalesce(nullif(trim(p_sort), ''), 'recent'));
  v_v text := lower(coalesce(nullif(trim(p_verification), ''), 'verified'));
  v_a text := lower(coalesce(nullif(trim(p_activity), ''), 'all'));
begin
  perform public._require_admin();
  p_limit  := greatest(1, least(p_limit, 200));
  p_offset := greatest(0, p_offset);
  return query
  with owner_cards as (
    select b.created_by as uid,
           max(ci.updated_at) filter (where ci.card_id not like 'onb-%') as last_card_at
    from public.card_index ci join public.boards b on b.id = ci.board_id
    group by b.created_by
  ),
  owner_counts as (
    select c.user_id as uid, c.live_cards from public._owner_card_counts c
  ),
  owner_boards as (
    select b.created_by as uid, count(*)::int as board_count
    from public.boards b where b.created_by is not null and b.deleted_at is null
    group by b.created_by
  ),
  owner_storage as (
    select w.created_by as uid, coalesce(sum(i.size_bytes), 0)::bigint as bytes
    from public.images i join public.workspaces w on w.id = i.workspace_id
    where i.deleted_at is null group by w.created_by
  ),
  work_ev as (
    select e.user_id as uid, max(e.occurred_at) as last_ev_at
    from public.analytics_events e
    where e.user_id is not null
      and e.event in ('card_placed','card_edit','doc_edit','comment_create',
                      'arrow_created','remix_clone','tag_manual_apply','tag_confirm')
      and coalesce(e.props->>'synthetic', '') <> 'true'
    group by e.user_id
  ),
  base as (
    select
      u.id as user_id, u.email::text as email, coalesce(p.tier, 'demo')::text as tier,
      coalesce(occ.live_cards, 0)::int as card_count,
      coalesce(p.seconds_in_app, 0)::bigint as seconds_in_app,
      u.created_at as created_at, u.last_sign_in_at as last_sign_in_at,
      s.plan::text as subscription_plan, s.status::text as subscription_status,
      s.current_period_end as current_period_end, s.monthly_amount_cents as subscription_amount_cents,
      (s.discount is not null) as subscription_discounted, (p.banned_at is not null) as banned,
      exists (select 1 from public.waitlist_entries we2 where lower(we2.email) = lower(u.email)) as joined_waitlist,
      nullif(p.display_name, '') as display_name, nullif(p.avatar_url, '') as avatar_url,
      nullif(p.color, '') as color, pr.last_seen_at as last_seen_at,
      coalesce(ob.board_count, 0)::int as board_count,
      public.derive_acquisition_channel(p.first_source) as acquisition_source,
      ox.last_reached_out_at as last_reached_out_at, coalesce(ox.outreach_count, 0)::int as outreach_count,
      (u.email_confirmed_at is not null) as email_confirmed, coalesce(ostor.bytes, 0)::bigint as storage_bytes,
      nullif(p.country, '') as country,
      greatest(oc.last_card_at, we.last_ev_at) as last_worked_at
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join public.subscriptions s on s.user_id = u.id
    left join public.user_presence pr on pr.user_id = u.id
    left join owner_cards oc on oc.uid = u.id
    left join owner_counts occ on occ.uid = u.id
    left join owner_boards ob on ob.uid = u.id
    left join owner_storage ostor on ostor.uid = u.id
    left join work_ev we on we.uid = u.id
    left join lateral (
      select max(o.reached_at) as last_reached_out_at, count(*)::int as outreach_count
      from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email)
    ) ox on true
    where (case v_v
             when 'verified'   then (u.id in (select ec.entered_id from public._admin_entered_code() ec))
             when 'unverified' then (u.id not in (select ec.entered_id from public._admin_entered_code() ec))
             else true end)
      and (v_q is null or u.email ilike '%' || v_q || '%')
      and (v_t is null or coalesce(p.tier, 'demo') = v_t)
      and (v_s is null or s.status = v_s)
  )
  select * from base
  where (v_o is null or base.acquisition_source = v_o)
    and (v_c is null
         or (v_c = 'yes' and base.last_reached_out_at is not null)
         or (v_c = 'no'  and base.last_reached_out_at is null))
    -- 0460: "active" meant cards OR any cluster, and every account's Studio
    -- is a cluster. It means made something now; see _admin_made_something.
    and (case v_a
           when 'active'   then base.user_id in     (select m.user_id from public._admin_made_something() m)
           when 'inactive' then base.user_id not in (select m.user_id from public._admin_made_something() m)
           else true end)
  order by
    case when v_k = 'recent' then base.created_at end desc nulls last,
    case when v_k = 'active' then base.last_seen_at end desc nulls last,
    case when v_k = 'worked' then base.last_worked_at end desc nulls last,
    case when v_k = 'cards'  then base.card_count end desc nulls last,
    case when v_k = 'spend'  then base.subscription_amount_cents end desc nulls last,
    case when v_k = 'name'   then lower(coalesce(base.display_name, base.email)) end asc nulls last,
    base.created_at desc nulls last
  limit p_limit offset p_offset;
end $function$;

create or replace function public.admin_retention_by_experiment(p_key text, p_window_days integer default 30, p_exclude_internal boolean default true)
returns table (arm text, day_offset integer, eligible integer, active integer, active_pct numeric)
language plpgsql stable security definer set search_path = public
as $function$
declare v_track_start date;
begin
  perform public._require_admin();
  p_window_days := greatest(1, least(p_window_days, 365));
  select min(day) into v_track_start from public.user_active_day;
  v_track_start := coalesce(v_track_start, current_date);
  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup_day,
           p.settings->'experiments'->>p_key as arm
      from auth.users usr
      join public.profiles p on p.user_id = usr.id
     where usr.id in (select ec.entered_id from public._admin_entered_code() ec)
       and p.settings->'experiments'->>p_key is not null
       and (not p_exclude_internal or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  grid as (
    select u.arm, u.user_id, d.day_offset, (u.signup_day + d.day_offset) as cal_day
      from u cross join generate_series(0, p_window_days) as d(day_offset)
     where u.signup_day + d.day_offset <= current_date
       and u.signup_day + d.day_offset >= v_track_start
  ),
  marked as (
    select g.arm, g.day_offset,
           exists(select 1 from public.user_active_day a
                   where a.user_id = g.user_id and a.day = g.cal_day) as is_active
      from grid g
  )
  select m.arm, m.day_offset,
         count(*)::int,
         sum(case when m.is_active then 1 else 0 end)::int,
         round(sum(case when m.is_active then 1 else 0 end)::numeric / nullif(count(*), 0), 4)
    from marked m
   group by m.arm, m.day_offset
   order by m.arm, m.day_offset;
end $function$;

create or replace function public.admin_retention_by_source(p_window_days integer default 30, p_exclude_internal boolean default true, p_verified_only boolean default true)
returns table (source text, day_offset integer, eligible integer, active integer, active_pct numeric)
language plpgsql stable security definer set search_path = public
as $function$
declare v_track_start date;
begin
  perform public._require_admin();
  p_window_days := greatest(1, least(p_window_days, 365));
  select min(day) into v_track_start from public.user_active_day;
  v_track_start := coalesce(v_track_start, current_date);
  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup_day,
           case
             when public.derive_acquisition_channel(p.first_source) ~ '(_ads$|^meta_paid$)' then 'ad'
             when public.derive_acquisition_channel(p.first_source) = 'direct'               then 'organic'
             else 'referral'
           end as source
      from auth.users usr
      left join public.profiles p on p.user_id = usr.id
     where (not p_verified_only or (usr.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and (not p_exclude_internal or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  grid as (
    select u.source, u.user_id, d.day_offset, (u.signup_day + d.day_offset) as cal_day
      from u cross join generate_series(0, p_window_days) as d(day_offset)
     where u.signup_day + d.day_offset <= current_date
       and u.signup_day + d.day_offset >= v_track_start
  ),
  marked as (
    select g.source, g.day_offset,
           exists(select 1 from public.user_active_day a
                   where a.user_id = g.user_id and a.day = g.cal_day) as is_active
      from grid g
  )
  select m.source, m.day_offset,
         count(*)::int,
         sum(case when m.is_active then 1 else 0 end)::int,
         round(sum(case when m.is_active then 1 else 0 end)::numeric / nullif(count(*), 0), 4)
    from marked m
   group by m.source, m.day_offset
   order by m.source, m.day_offset;
end $function$;

create or replace function public.admin_retention_cohort_matrix(p_weeks integer default 13, p_exclude_internal boolean default true, p_verified_only boolean default true, p_require_work boolean default true)
returns table (cohort_week date, week_offset integer, cohort_size integer, active_n integer, active_pct numeric, measurable boolean, work_floor date)
language plpgsql stable security definer set search_path = public
as $function$
#variable_conflict use_column
declare
  v_weeks int := least(greatest(coalesce(p_weeks, 13), 1), 52);
  v_first date := date_trunc('week', now())::date - ((v_weeks - 1) * 7);
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
            or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and (not p_exclude_internal
            or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  sizes as (
    select c.cohort_week, count(*)::int as cohort_size
      from cohorts c group by c.cohort_week
  ),
  grid as (
    select s.cohort_week, s.cohort_size, g.week_offset,
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
end $function$;

create or replace function public.admin_retention_cohorts(p_window_days integer default 60, p_exclude_internal boolean default true, p_verified_only boolean default true)
returns table (cohort_week date, day_offset integer, cohort_size integer, active_n integer, active_pct numeric)
language plpgsql stable security definer set search_path = public
as $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_window_days := greatest(1, least(p_window_days, 365));
  return query
  with cohorts as (
    select date_trunc('week', u.created_at)::date as cohort_week, u.id as user_id
      from auth.users u
     where (not p_verified_only or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and u.created_at >= now() - (p_window_days || ' days')::interval
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

create or replace function public.admin_retention_curve(p_window_days integer default 30, p_exclude_internal boolean default true, p_verified_only boolean default true, p_require_work boolean default false)
returns table (segment text, day_offset integer, eligible integer, active integer, active_pct numeric)
language plpgsql stable security definer set search_path = public
as $function$
#variable_conflict use_column
declare
  v_track_start date;
  v_work_floor  date;
begin
  perform public._require_admin();
  p_window_days := greatest(1, least(p_window_days, 365));
  select min(day) into v_track_start from public.user_active_day;
  v_track_start := coalesce(v_track_start, current_date);
  -- 0410: work was only recorded from the first did_work day; before it every
  -- row reads "no work", which is not the same as "didn't come back".
  if p_require_work then
    select min(a.day) into v_work_floor from public.user_active_day a where a.did_work;
    v_track_start := greatest(v_track_start, coalesce(v_work_floor, current_date));
  end if;
  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup_day,
           coalesce(p.tier, 'demo') as tier
      from auth.users usr
      left join public.profiles p on p.user_id = usr.id
     where (not p_verified_only or (usr.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and (not p_exclude_internal or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  grid as (
    select u.user_id, u.tier, d.day_offset, (u.signup_day + d.day_offset) as cal_day
      from u
      cross join generate_series(0, p_window_days) as d(day_offset)
     where u.signup_day + d.day_offset <= current_date
       and u.signup_day + d.day_offset >= v_track_start
  ),
  marked as (
    select g.day_offset, g.tier,
           exists (select 1 from public.user_active_day a
                    where a.user_id = g.user_id and a.day = g.cal_day
                      and (not p_require_work or a.did_work)) as is_active
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

create or replace function public.admin_return_rate(p_exclude_internal boolean default true, p_verified_only boolean default true, p_require_work boolean default false)
returns table (day_offset integer, eligible integer, returned_on integer, on_pct numeric, returned_within integer, within_pct numeric)
language plpgsql stable security definer set search_path = public
as $function$
declare
  v_track_start date;
  v_work_floor  date;
begin
  perform public._require_admin();
  select min(day) into v_track_start from public.user_active_day;
  v_track_start := coalesce(v_track_start, current_date);
  -- 0399: work was only recorded from the first did_work day; before it every
  -- row reads "no work", which is not the same as "didn't come back".
  if p_require_work then
    select min(a.day) into v_work_floor from public.user_active_day a where a.did_work;
    v_track_start := greatest(v_track_start, coalesce(v_work_floor, current_date));
  end if;
  return query
  with u as (
    select usr.id as user_id, usr.created_at::date as signup_day
      from auth.users usr
     where (not p_verified_only or (usr.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and (not p_exclude_internal or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  offs(day_offset) as (values (1),(7),(30)),
  grid as (
    select u.user_id, o.day_offset, (u.signup_day + o.day_offset) as cal_day
      from u cross join offs o
     where (u.signup_day + o.day_offset) <= current_date
       and (u.signup_day + o.day_offset) >= v_track_start
       -- "within N days" looks at (signup_day, cal_day]: all of it measured.
       and (not p_require_work or u.signup_day >= v_track_start - 1)
  ),
  marked as (
    select g.day_offset,
           exists(select 1 from public.user_active_day a
                   where a.user_id = g.user_id and a.day = g.cal_day
                     and (not p_require_work or a.did_work)) as on_day,
           exists(select 1 from public.user_active_day a
                   where a.user_id = g.user_id
                     and a.day >  (g.cal_day - g.day_offset)
                     and a.day <= g.cal_day
                     and (not p_require_work or a.did_work)) as within_w
      from grid g
  )
  select m.day_offset,
         count(*)::int,
         sum(case when m.on_day then 1 else 0 end)::int,
         round(sum(case when m.on_day then 1 else 0 end)::numeric / nullif(count(*), 0), 4),
         sum(case when m.within_w then 1 else 0 end)::int,
         round(sum(case when m.within_w then 1 else 0 end)::numeric / nullif(count(*), 0), 4)
    from marked m
   group by m.day_offset
   order by m.day_offset;
end $function$;

create or replace function public.admin_signups_by_day(p_days integer default 30, p_verified_only boolean default true, p_exclude_internal boolean default false)
returns table (day date, signups integer)
language plpgsql stable security definer set search_path = public
as $function$
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  return query
  select d::date as day, coalesce(c.n, 0)::int as signups
  from generate_series(
    current_date - (p_days - 1),
    current_date,
    '1 day'::interval
  ) d
  left join (
    select date_trunc('day', u.created_at)::date as day, count(*)::int as n
    from auth.users u
    where (not p_verified_only
           or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
      and (not p_exclude_internal
           or u.id not in (select iu.user_id from public._internal_user_ids() iu))
      and u.created_at >= (current_date - (p_days - 1))::timestamptz
    group by 1
  ) c on c.day = d::date
  order by day asc;
end $function$;

create or replace function public.admin_stats(p_verified_only boolean default true)
returns jsonb
language plpgsql stable security definer set search_path = public
as $function$
declare v_out jsonb;
begin
  perform public._require_admin();

  select jsonb_build_object(
    'total_users',     (select count(*) from auth.users u
                          where (not p_verified_only
                                 or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))),
    'new_users_7d',    (select count(*) from auth.users u
                          where (not p_verified_only
                                 or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
                            and u.created_at >= now() - interval '7 days'),
    'tier_counts',     coalesce((select jsonb_object_agg(tier, n) from (
                          select p.tier, count(*) as n
                          from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where (not p_verified_only
                                 or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
                          group by p.tier
                        ) t), '{}'::jsonb),
    'total_seconds_in_app',
                       (select coalesce(sum(p.seconds_in_app), 0)::bigint
                          from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where (not p_verified_only
                                 or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))),
    'demo_users',      (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where p.tier = 'demo'
                            and not coalesce(p.is_service, false)
                            and (not p_verified_only
                                 or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))),
    'demos_near_cap',  (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          left join public._live_card_counts() l on l.user_id = p.user_id
                          where p.tier = 'demo'
                            and not coalesce(p.is_service, false)
                            and (not p_verified_only
                                 or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
                            and coalesce(l.cards, 0)
                                >= 0.8 * (coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0))),
    'demos_trial_eligible',
                       (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          left join public._live_card_counts() l on l.user_id = p.user_id
                          where p.tier = 'demo'
                            and not coalesce(p.is_service, false)
                            and p.creator_trial_started_at is null
                            and (not p_verified_only
                                 or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
                            and (coalesce(l.cards, 0) >= 13
                                 or coalesce(l.cards, 0)
                                    >= 0.8 * (coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)))),
    'trials_started',  (select count(*) from public.profiles p
                          where p.creator_trial_started_at is not null
                            and not coalesce(p.is_service, false)),
    'trials_converted',(select count(*) from public.profiles p
                          where p.creator_trial_started_at is not null
                            and p.first_paid_at is not null
                            and p.first_paid_at >= p.creator_trial_started_at
                            and not coalesce(p.is_service, false)),
    'sub_counts',      coalesce((select jsonb_object_agg(status, n) from (
                          select status, count(*) as n
                          from public.subscriptions
                          where status is not null
                          group by status
                        ) s), '{}'::jsonb),
    'mrr_cents',       coalesce((
                          select sum(coalesce(
                            monthly_amount_cents,
                            case when plan = 'monthly' then 2500
                                 when plan = 'annual'  then 2000
                                 else 0 end
                          ))::int
                          from public.subscriptions
                          where status = 'active'
                        ), 0),
    'trialing_subs',   (select count(*) from public.subscriptions where status = 'trialing'),
    'comped_paid',     (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where p.tier = 'paid'
                            and (not p_verified_only
                                 or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
                            and not exists (
                              select 1 from public.subscriptions s
                              where s.user_id = p.user_id and s.status in ('active', 'trialing')
                            )),
    'subscribed_paid', (select count(*) from public.profiles p
                          join auth.users u on u.id = p.user_id
                          where p.tier = 'paid'
                            and (not p_verified_only
                                 or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
                            and exists (
                              select 1 from public.subscriptions s
                              where s.user_id = p.user_id and s.status in ('active', 'trialing')
                            )),
    'discounted_subs', (select count(*) from public.subscriptions
                          where status in ('active', 'trialing') and discount is not null),
    'waitlist_pending',(select count(*) from public.waitlist_entries where status = 'pending'),
    'waitlist_total',  (select count(*) from public.waitlist_entries)
  ) into v_out;
  return v_out;
end;
$function$;

create or replace function public.admin_tier_usage_compare(p_days integer, p_exclude_internal boolean default true, p_verified_only boolean default true)
returns table (tier text, users bigint, avg_cards numeric, avg_boards numeric, total_cards bigint, total_boards bigint)
language plpgsql stable security definer set search_path = public
as $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  return query
  with user_stats as (
    select
      coalesce(p.tier, 'demo')::text as t_tier,
      u.id as user_id,
      coalesce((select count(*) from public.boards b
                 where b.created_by = u.id and b.deleted_at is null), 0)::bigint as board_count,
      coalesce((select c.live_cards from public._owner_card_counts c
                 where c.user_id = u.id), 0)::bigint as card_count
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    where (not p_verified_only or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
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

create or replace function public.admin_time_to_first_card(p_days integer default 30, p_exclude_internal boolean default true)
returns jsonb
language plpgsql stable security definer set search_path = public
as $function$
#variable_conflict use_column
declare v jsonb;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  with su as (
    select u.id as uid, u.created_at as signup, p.first_card_at,
           case when p.first_card_at is not null and p.first_card_at >= u.created_at
                then extract(epoch from (p.first_card_at - u.created_at)) end as delta_sec,
           case
             when (p.first_source->>'fbclid') is not null
                  or lower(coalesce(p.first_source->>'utm_source','')) ~ '(facebook|instagram|meta|fb|ig)'
                  or lower(coalesce(p.first_source->>'utm_medium','')) ~ '(cpc|paid|ad|social)' then 'ad'
             when coalesce(nullif(p.first_source->>'utm_source',''), nullif(p.first_source->>'referrer','')) is not null then 'referral'
             else 'organic'
           end as source
      from auth.users u
      left join public.profiles p on p.user_id = u.id
     where u.id in (select ec.entered_id from public._admin_entered_code() ec)
       and u.created_at >= now() - (p_days || ' days')::interval
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  dev as (
    select distinct on (e.user_id) e.user_id,
           coalesce(nullif(e.props->>'device_type',''),'unknown') as device
      from public.analytics_events e
     where e.user_id in (select uid from su) and nullif(e.props->>'device_type','') is not null
     order by e.user_id, e.occurred_at desc
  ),
  per_user as (
    select su.uid, su.signup, su.first_card_at, su.delta_sec, su.source,
           coalesce(d.device,'unknown') as device,
           case
             when su.delta_sec is null then
               case when su.first_card_at is null and su.signup <= now() - interval '30 minutes' then 'never' end
             when su.delta_sec < 30   then '<30s'
             when su.delta_sec < 60   then '30-60s'
             when su.delta_sec < 300  then '1-5m'
             when su.delta_sec < 1800 then '5-30m'
             else '>30m'
           end as bucket
      from su left join dev d on d.user_id = su.uid
  ),
  bdefs(label, ord) as (
    values ('<30s',1),('30-60s',2),('1-5m',3),('5-30m',4),('>30m',5),('never',6)
  )
  select jsonb_build_object(
    'total_signed_up', (select count(*) from per_user),
    'with_card',       (select count(*) from per_user where delta_sec is not null),
    'never',           (select count(*) from per_user where bucket = 'never'),
    'pending',         (select count(*) from per_user where bucket is null),
    'p50_sec', (select round(percentile_cont(0.5)  within group (order by delta_sec)::numeric, 1) from per_user where delta_sec is not null),
    'p90_sec', (select round(percentile_cont(0.9)  within group (order by delta_sec)::numeric, 1) from per_user where delta_sec is not null),
    'p95_sec', (select round(percentile_cont(0.95) within group (order by delta_sec)::numeric, 1) from per_user where delta_sec is not null),
    'buckets', coalesce((select jsonb_agg(jsonb_build_object('label', bd.label, 'ord', bd.ord,
                 'users', (select count(*)::int from per_user pu where pu.bucket = bd.label)) order by bd.ord)
               from bdefs bd), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', s.source, 'total', s.total, 'buckets', s.buckets) order by s.source)
                 from (
                   select g.source,
                          (select count(*) from per_user pu where pu.source = g.source)::int as total,
                          coalesce((select jsonb_agg(jsonb_build_object('label', bd.label, 'ord', bd.ord,
                              'users', (select count(*)::int from per_user pu where pu.source = g.source and pu.bucket = bd.label)) order by bd.ord)
                            from bdefs bd), '[]'::jsonb) as buckets
                     from (select distinct source from per_user) g
                 ) s), '[]'::jsonb),
    'by_device', coalesce((select jsonb_agg(jsonb_build_object('device', s.device, 'total', s.total, 'buckets', s.buckets) order by s.total desc)
                 from (
                   select g.device,
                          (select count(*) from per_user pu where pu.device = g.device)::int as total,
                          coalesce((select jsonb_agg(jsonb_build_object('label', bd.label, 'ord', bd.ord,
                              'users', (select count(*)::int from per_user pu where pu.device = g.device and pu.bucket = bd.label)) order by bd.ord)
                            from bdefs bd), '[]'::jsonb) as buckets
                     from (select distinct device from per_user) g
                 ) s), '[]'::jsonb)
  ) into v;
  return v;
end $function$;

create or replace function public.admin_top_users(p_tier text default null, p_limit integer default 20, p_exclude_internal boolean default true, p_verified_only boolean default true)
returns table (user_id uuid, email text, tier text, card_count bigint, board_count bigint, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public
as $function$
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
      (select count(*) from public.boards b
        where b.created_by = u.id and b.deleted_at is null) as board_count,
      (select coalesce(c.live_cards, 0) from public._owner_card_counts c
        where c.user_id = u.id) as card_count
  ) stats on true
  where (v_t is null or coalesce(p.tier, 'demo') = v_t)
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
    and (not p_verified_only or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
  order by stats.card_count desc nulls last
  limit p_limit;
end;
$function$;

create or replace function public.admin_user_count(p_query text default null, p_tier text default null, p_status text default null, p_source text default null, p_contacted text default null, p_verification text default 'verified', p_activity text default 'all')
returns bigint
language plpgsql stable security definer set search_path = public
as $function$
declare
  v_q text := nullif(trim(coalesce(p_query,     '')), '');
  v_t text := nullif(trim(coalesce(p_tier,      '')), '');
  v_s text := nullif(trim(coalesce(p_status,    '')), '');
  v_o text := nullif(trim(coalesce(p_source,    '')), '');
  v_c text := nullif(trim(coalesce(p_contacted, '')), '');
  v_v text := lower(coalesce(nullif(trim(p_verification), ''), 'verified'));
  v_a text := lower(coalesce(nullif(trim(p_activity), ''), 'all'));
  v_n bigint;
begin
  perform public._require_admin();
  with base as (
    select public.derive_acquisition_channel(p.first_source) as acquisition_source
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join public.subscriptions s on s.user_id = u.id
    where (case v_v
             when 'verified'   then (u.id in (select ec.entered_id from public._admin_entered_code() ec))
             when 'unverified' then (u.id not in (select ec.entered_id from public._admin_entered_code() ec))
             else true end)
      and (v_q is null or u.email ilike '%' || v_q || '%')
      and (v_t is null or coalesce(p.tier, 'demo') = v_t)
      and (v_s is null or s.status = v_s)
      and (v_c is null
           or (v_c = 'yes' and     exists (select 1 from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email)))
           or (v_c = 'no'  and not exists (select 1 from public.user_outreach o where o.user_id = u.id or lower(o.email) = lower(u.email))))
      -- 0460: the list's own predicate, from the one helper both read.
      and (case v_a
             when 'active'   then u.id in     (select m.user_id from public._admin_made_something() m)
             when 'inactive' then u.id not in (select m.user_id from public._admin_made_something() m)
             else true end)
  )
  select count(*) into v_n from base where (v_o is null or base.acquisition_source = v_o);
  return v_n;
end $function$;

create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $function$
declare
  v_out jsonb;
begin
  perform public._require_admin();

  if p_user_id is null then
    raise exception 'user id required' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'user_id', u.id,
    'email',   u.email::text,
    'flags', jsonb_build_object(
      'banned',          (p.banned_at is not null),
      'is_internal',     exists (select 1 from public._internal_user_ids() iu(id) where iu.id = u.id),
      'email_confirmed', (u.email_confirmed_at is not null),
      'last_sign_in_at', u.last_sign_in_at,
      'verified',        (u.id in (select ec.entered_id from public._admin_entered_code() ec))
    ),
    'identity', jsonb_build_object(
      'display_name', nullif(p.display_name, ''),
      'avatar_url',   nullif(p.avatar_url, ''),
      'color',        nullif(p.color, ''),
      'tier',         coalesce(p.tier, 'demo'),
      'banned',       (p.banned_at is not null),
      'banned_at',    p.banned_at,
      'banned_by',    p.banned_by,
      'banned_by_email', (select bu.email::text from auth.users bu where bu.id = p.banned_by),
      'banned_reason',   p.banned_reason
    ),
    'acquisition', jsonb_build_object(
      'label',         public.derive_acquisition_channel(p.first_source),
      'utm_source',    nullif(p.first_source->>'utm_source', ''),
      'utm_medium',    nullif(p.first_source->>'utm_medium', ''),
      'utm_campaign',  nullif(p.first_source->>'utm_campaign', ''),
      'utm_content',   nullif(p.first_source->>'utm_content', ''),
      'utm_term',      nullif(p.first_source->>'utm_term', ''),
      'referrer',      nullif(p.first_source->>'referrer', ''),
      'referrer_host', nullif(p.first_source->>'referrer_host', ''),
      'landing_path',  nullif(p.first_source->>'landing_path', ''),
      'fbclid',        nullif(p.first_source->>'fbclid', ''),
      'gclid',         nullif(p.first_source->>'gclid', ''),
      'wbraid',        nullif(p.first_source->>'wbraid', ''),
      'gbraid',        nullif(p.first_source->>'gbraid', ''),
      'msclkid',       nullif(p.first_source->>'msclkid', ''),
      'ttclid',        nullif(p.first_source->>'ttclid', ''),
      'twclid',        nullif(p.first_source->>'twclid', ''),
      'rdt_cid',       nullif(p.first_source->>'rdt_cid', ''),
      'li_fat_id',     nullif(p.first_source->>'li_fat_id', ''),
      'epik',          nullif(p.first_source->>'epik', ''),
      'sccid',         nullif(p.first_source->>'sccid', ''),
      'share_token',   nullif(p.first_source->>'share_token', ''),
      'public_slug',   nullif(p.first_source->>'public_slug', ''),
      'share',         sh.info,
      'last_touch', case when lt.bag is null then null
        else (lt.bag
              || jsonb_build_object('channel', public.derive_acquisition_channel(lt.bag))
              || (case when lt.touched_at is not null then jsonb_build_object('at', lt.touched_at) else '{}'::jsonb end))
        end,
      'raw',           coalesce(p.first_source, '{}'::jsonb)
    ),
    'activation', jsonb_build_object(
      'created_at',        u.created_at,
      'first_board_at',    p.first_board_at,
      'first_card_at',     p.first_card_at,
      'first_share_at',    p.first_share_at,
      'first_backlink_at', p.first_backlink_at,
      'first_paid_at',     p.first_paid_at,
      'milestones', coalesce((
        select jsonb_agg(jsonb_build_object('key', m.key, 'at', m.at) order by m.at asc)
        from (
          values
            ('signed_up',     u.created_at),
            ('first_board',   p.first_board_at),
            ('first_card',    p.first_card_at),
            ('first_share',   p.first_share_at),
            ('first_backlink',p.first_backlink_at),
            ('first_paid',    p.first_paid_at)
        ) as m(key, at)
        where m.at is not null
      ), '[]'::jsonb)
    ),
    'engagement', jsonb_build_object(
      'seconds_in_app',  coalesce(p.seconds_in_app, 0),
      'last_seen_at',    pr.last_seen_at,
      'online',          (pr.last_seen_at is not null and pr.last_seen_at > now() - interval '5 minutes'),
      'card_count',         coalesce(occ.live_cards, 0),
      'discarded_cards',    coalesce(occ.discarded_cards, 0),
      'discarded_clusters', coalesce(occ.discarded_clusters, 0),
      'guest_cards',        coalesce(occ.guest_cards, 0),
      'guest_clusters',     coalesce(occ.guest_clusters, 0),
      'guest_workspaces',   coalesce(occ.guest_workspaces, 0),
      'board_count',     coalesce(ob.board_count, 0),
      -- 0460: the clusters they made, and the Studios they were given.
      'clusters_made',   coalesce(ob.clusters_made, 0),
      'studios',         coalesce(ob.studios, 0),
      -- 0460: days in the app, and the ones with real work in them.
      'active_days',      coalesce(ad.active_days, 0),
      'work_days',        coalesce(ad.work_days, 0),
      'first_active_day', ad.first_day,
      'last_active_day',  ad.last_day,
      'demo_card_cap',   (coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)),
      'card_cap_base',   coalesce(p.card_cap_base, 50),
      'bonus_card_credits',   coalesce(p.bonus_card_credits, 0),
      'effective_card_limit', (coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)),
      'storage', jsonb_build_object(
        'used_bytes',  coalesce(st.used_bytes, 0),
        'quota_bytes', public._storage_quota_bytes(),
        'image_count', coalesce(st.image_count, 0)
      )
    ),
    'device', jsonb_build_object(
      'last', (
        select jsonb_build_object(
          'device_type', e.props->>'device_type',
          'os',          e.props->>'os',
          'browser',     e.props->>'browser',
          'at',          e.occurred_at
        )
        from public.analytics_events e
        where e.user_id = u.id and nullif(e.props->>'device_type', '') is not null
        order by e.occurred_at desc
        limit 1
      ),
      'breakdown', coalesce((
        select jsonb_agg(jsonb_build_object('device_type', d.dt, 'events', d.n) order by d.n desc)
        from (
          select coalesce(nullif(e.props->>'device_type', ''), 'unknown') as dt, count(*)::int as n
          from public.analytics_events e
          where e.user_id = u.id and nullif(e.props->>'device_type', '') is not null
          group by 1
        ) d
      ), '[]'::jsonb)
    ),
    'geo', jsonb_build_object(
      'signup_country', nullif(p.signup_country, ''),
      'country',        nullif(p.country, ''),
      'breakdown', coalesce((
        select jsonb_agg(jsonb_build_object('country', g.cc, 'events', g.n) order by g.n desc)
        from (
          select e.country as cc, count(*)::int as n
          from public.analytics_events e
          where e.user_id = u.id and nullif(e.country, '') is not null
          group by 1
        ) g
      ), '[]'::jsonb)
    ),
    'billing', case when s.user_id is null then null else jsonb_build_object(
      'plan',                  s.plan,
      'status',                s.status,
      'trialing',              (s.status = 'trialing'),
      'monthly_amount_cents',  s.monthly_amount_cents,
      'discount',              s.discount,
      'discounted',            (s.discount is not null),
      'cancel_at_period_end',  coalesce(s.cancel_at_period_end, false),
      'current_period_end',    s.current_period_end,
      'stripe_customer_id',    s.stripe_customer_id,
      'stripe_subscription_id',s.stripe_subscription_id,
      'updated_at',            s.updated_at
    ) end,
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email',            g.email,
        'status',           public._grant_status(g.revoked_at, g.expires_at),
        'expires_at',       g.expires_at,
        'granted_at',       g.granted_at,
        'granted_by_email', g.granted_by_email,
        'revoked_at',       g.revoked_at,
        'note',             g.note
      ) order by
        case when g.revoked_at is null then 0 else 1 end asc,
        g.granted_at desc)
      from public.paid_grants g
      where g.user_id = u.id or lower(g.email) = lower(u.email)
    ), '[]'::jsonb),
    'outreach', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',               o.id,
        'email',            o.email,
        'reached_at',       o.reached_at,
        'reached_by_email', o.reached_by_email,
        'note',             o.note
      ) order by o.reached_at desc)
      from public.user_outreach o
      where o.user_id = u.id or lower(o.email) = lower(u.email)
    ), '[]'::jsonb)
  )
  into v_out
  from auth.users u
  left join public.profiles      p  on p.user_id  = u.id
  left join public.subscriptions s  on s.user_id  = u.id
  left join public.user_presence pr on pr.user_id = u.id
  left join public._owner_card_counts occ on occ.user_id = u.id
  left join lateral (
    select count(*)::int as board_count,
           (count(*) filter (where b.parent_board_id is not null))::int as clusters_made,
           (count(*) filter (where b.parent_board_id is null))::int     as studios
    from public.boards b
    where b.created_by = u.id and b.deleted_at is null
  ) ob on true
  left join lateral (
    select count(*)::int as active_days,
           (count(*) filter (where a.did_work))::int as work_days,
           min(a.day) as first_day,
           max(a.day) as last_day
    from public.user_active_day a
    where a.user_id = u.id
  ) ad on true
  left join lateral (
    select coalesce(sum(i.size_bytes), 0)::bigint as used_bytes, count(*)::bigint as image_count
    from public.images i
    join public.workspaces w on w.id = i.workspace_id
    where w.created_by = u.id and i.deleted_at is null
  ) st on true
  left join lateral (
    select case
      when nullif(p.first_source->>'share_token','') is not null then (
        select jsonb_build_object(
          'kind',            'share_link',
          'token',           p.first_source->>'share_token',
          'board_id',        psl.board_id,
          'board_title',     b2.name,
          'shared_by_email', su.email::text,
          'link_kind',       psl.kind,
          'link_role',       psl.role,
          'link_created_at', psl.created_at,
          'link_revoked_at', psl.revoked_at,
          'cohort_signups',  (select count(*) from public.profiles p2
                               where p2.first_source->>'share_token' = p.first_source->>'share_token')
        )
        from public.public_share_links psl
        left join public.boards b2 on b2.id = psl.board_id
        left join auth.users su on su.id = psl.created_by
        where psl.token::text = p.first_source->>'share_token'
        limit 1
      )
      when nullif(p.first_source->>'public_slug','') is not null then (
        select jsonb_build_object(
          'kind',            'public_board',
          'slug',            p.first_source->>'public_slug',
          'board_id',        pb.board_id,
          'board_title',     b3.name,
          'shared_by_email', su2.email::text,
          'cohort_signups',  (select count(*) from public.profiles p3
                               where p3.first_source->>'public_slug' = p.first_source->>'public_slug')
        )
        from public.public_boards pb
        left join public.boards b3 on b3.id = pb.board_id
        left join auth.users su2 on su2.id = pb.created_by
        where pb.slug = p.first_source->>'public_slug'
        limit 1
      )
      else null
    end as info
  ) sh on true
  left join lateral (
    select (select jsonb_object_agg(substr(k, 4), val)
              from jsonb_each_text(e.props) kv(k, val)
             where starts_with(k, 'lt_') and k <> 'lt_last_touch_at') as bag,
           e.props->>'lt_last_touch_at' as touched_at
    from public.analytics_events e
    where e.user_id = u.id and e.props ? 'lt_last_touch_at'
    order by e.occurred_at desc
    limit 1
  ) lt on true
  where u.id = p_user_id;

  if v_out is null then
    raise exception 'user not found: %', p_user_id using errcode = 'P0002';
  end if;

  return v_out;
end $function$;

create or replace function public.admin_user_dormancy(p_exclude_internal boolean default true, p_verified_only boolean default true)
returns table (user_id uuid, email text, tier text, signup date, last_active_day date, days_dormant integer, active_day_count integer, did_card boolean, did_populated_board boolean, resurrected boolean)
language plpgsql stable security definer set search_path = public
as $function$
begin
  perform public._require_admin();
  return query
  with base as (
    select u.id as uid, u.email::text as email, coalesce(p.tier, 'demo') as tier,
           u.created_at::date as signup,
           p.first_card_at is not null as did_card,
           p.first_populated_board_at is not null as did_pop
      from auth.users u
      left join public.profiles p on p.user_id = u.id
     where (not p_verified_only or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  agg as (
    select a.user_id as uid, max(a.day) as last_day, count(distinct a.day)::int as ndays
      from public.user_active_day a group by a.user_id
  ),
  gaps as (
    select uid, bool_or(gap >= 7) as resurrected from (
      select a.user_id as uid,
             (a.day - lag(a.day) over (partition by a.user_id order by a.day)) as gap
        from public.user_active_day a
    ) s group by uid
  )
  select b.uid, b.email, b.tier, b.signup,
         ag.last_day,
         case when ag.last_day is not null then (current_date - ag.last_day) end,
         coalesce(ag.ndays, 0),
         b.did_card, b.did_pop,
         coalesce(g.resurrected, false)
    from base b
    left join agg ag on ag.uid = b.uid
    left join gaps g on g.uid = b.uid
   order by (case when ag.last_day is not null then (current_date - ag.last_day) end) desc nulls last, b.signup;
end $function$;

create or replace function public.admin_user_lifespan(p_exclude_internal boolean default true, p_verified_only boolean default true)
returns jsonb
language plpgsql stable security definer set search_path = public
as $function$
declare
  v jsonb;
begin
  perform public._require_admin();
  with per_user as (
    select u.id as user_id, count(distinct a.day) as active_days
      from auth.users u
      left join public.user_active_day a on a.user_id = u.id
     where (not p_verified_only or (u.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
     group by u.id
  ),
  bucketed as (
    select case
             when active_days <= 1  then '0-1'
             when active_days <= 2  then '2'
             when active_days <= 4  then '3-4'
             when active_days <= 7  then '5-7'
             when active_days <= 14 then '8-14'
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

create or replace function public.capture_metrics_daily(p_day date default current_date)
returns void
language plpgsql volatile security definer set search_path = public
as $function$
begin
  if p_day is null or p_day > current_date or p_day < current_date - 1 then
    raise exception 'capture_metrics_daily: only today or yesterday, not %', p_day using errcode = '22023';
  end if;

  insert into public.metrics_daily (
    day, mrr_cents, total_users, paid_users, trialing_users, demo_users,
    waitlist_users, admin_users, signups, active_users, captured_at
  )
  select
    p_day,
    coalesce((
      select sum(coalesce(monthly_amount_cents,
               case when plan = 'monthly' then 2500
                    when plan = 'annual'  then 2000
                    else 0 end))::int
      from public.subscriptions where status = 'active'
    ), 0),
    (select count(*) from auth.users
       where id in (select ec.entered_id from public._admin_entered_code() ec))::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.id in (select ec.entered_id from public._admin_entered_code() ec)
         and p.tier = 'paid'
         and not exists (select 1 from public.subscriptions s
                          where s.user_id = p.user_id and s.status = 'trialing'))::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.id in (select ec.entered_id from public._admin_entered_code() ec)
         and exists (select 1 from public.subscriptions s
                      where s.user_id = p.user_id and s.status = 'trialing'))::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.id in (select ec.entered_id from public._admin_entered_code() ec) and p.tier = 'demo')::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.id in (select ec.entered_id from public._admin_entered_code() ec) and p.tier = 'waitlist')::int,
    (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
       where u.id in (select ec.entered_id from public._admin_entered_code() ec) and p.tier = 'admin')::int,
    -- 0460: the day's own signups and active users, not "since midnight".
    (select count(*) from auth.users
       where id in (select ec.entered_id from public._admin_entered_code() ec)
         and created_at >= p_day and created_at < p_day + 1)::int,
    (select count(*) from public.user_active_day where day = p_day)::int,
    now()
  on conflict (day) do update set
    mrr_cents      = excluded.mrr_cents,
    total_users    = excluded.total_users,
    paid_users     = excluded.paid_users,
    trialing_users = excluded.trialing_users,
    demo_users     = excluded.demo_users,
    waitlist_users = excluded.waitlist_users,
    admin_users    = excluded.admin_users,
    signups        = excluded.signups,
    active_users   = excluded.active_users,
    captured_at    = excluded.captured_at;
end;
$function$;

-- ── 3. The hand edits ───────────────────────────────────────────────────────

-- admin_journey_dropoff: the live body, with 'setup' ordered between
-- ad_welcome and app_enter.
create or replace function public.admin_journey_dropoff(p_days integer default 30, p_exclude_internal boolean default true)
returns jsonb
language plpgsql stable security definer set search_path = public
as $function$
declare v jsonb;
begin
  perform public._require_admin();
  with ps as (
    select coalesce(e.props->>'jid', e.session_id::text) as jid,
           e.props->>'phase'                   as phase,
           nullif(e.props->>'seq','')::bigint  as seq,
           nullif(e.props->>'t_ms','')::bigint as t_ms,
           e.occurred_at
    from public.analytics_events e
    where e.event like 'ps\_%' escape '\'
      and e.props ? 'phase'
      and e.occurred_at >= now() - make_interval(days => greatest(1, least(p_days, 365)))
      and (not p_exclude_internal or e.session_id is null
           or e.session_id not in (select session_id from public._internal_session_ids()))
  ),
  phase_entry as (
    select distinct on (jid, phase) jid, phase, t_ms as entry_t_ms, occurred_at, seq
    from ps where phase is not null
    order by jid, phase, seq nulls last, occurred_at
  ),
  jp as (
    select pe.*,
      lead(entry_t_ms) over (partition by jid order by entry_t_ms, seq nulls last) as next_t_ms,
      row_number() over (partition by jid order by entry_t_ms desc nulls last, seq desc nulls last) as rn_desc
    from phase_entry pe
  ),
  -- 0461: 'setup' (the first-run setup steps) sits between ad_welcome and
  -- app_enter, in the order JOURNEY_PHASE_ORDER gives in analyticsEvents.js.
  ord(phase, ordn) as (values
    ('signup',1),('boot',2),('tier_gate',3),('waitlist',4),('ad_welcome',5),
    ('setup',6),('app_enter',7),('seed',8),('coachmark',9),('first_intent',10),
    ('blocked',11),('stuck',12),('first_card',13),('nest',14),('populated',15)),
  per_phase as (
    select phase,
      count(*)                              as entered,
      count(*) filter (where rn_desc > 1)   as advanced,
      count(*) filter (where rn_desc = 1)   as dropped,
      percentile_cont(0.5) within group (order by entry_t_ms) as p50_entry_ms,
      percentile_cont(0.9) within group (order by entry_t_ms) as p90_entry_ms,
      percentile_cont(0.5) within group (order by (next_t_ms - entry_t_ms))
        filter (where next_t_ms is not null) as median_dwell_ms
    from jp group by phase
  ),
  last_phase as (
    select phase, count(*) as journeys from jp where rn_desc = 1 group by phase
  )
  select jsonb_build_object(
    'total_journeys', (select count(distinct jid) from ps),
    'phases', (select coalesce(jsonb_agg(jsonb_build_object(
         'phase', o.phase, 'ord', o.ordn,
         'entered',  coalesce(pp.entered, 0),
         'advanced', coalesce(pp.advanced, 0),
         'dropped',  coalesce(pp.dropped, 0),
         'p50_entry_ms',    round(pp.p50_entry_ms),
         'p90_entry_ms',    round(pp.p90_entry_ms),
         'median_dwell_ms', round(pp.median_dwell_ms)
       ) order by o.ordn), '[]'::jsonb)
       from ord o left join per_phase pp on pp.phase = o.phase),
    'last_phase_reached', (select coalesce(jsonb_object_agg(phase, journeys), '{}'::jsonb) from last_phase)
  ) into v;
  return v;
end $function$;

-- admin_return_predictors: the live body, with the helper's predicate and its
-- day-one signals read in one pass (same rows, a fraction of the time).
create or replace function public.admin_return_predictors(p_since date default '2026-06-16', p_min_age_days integer default 14, p_exclude_internal boolean default true, p_verified_only boolean default true)
returns table (signal text, band text, band_ord integer, with_n integer, with_ret integer, without_n integer, without_ret integer)
language plpgsql stable security definer set search_path = public
as $function$
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
            or (usr.id in (select ec.entered_id from public._admin_entered_code() ec)))
       and (not p_exclude_internal
            or usr.id not in (select iu.user_id from public._internal_user_ids() iu))
  ),
  -- 0461: the signup day as a range, so the (user_id, occurred_at) index reads
  -- only that day, and only the props the signals below look at.
  ev as (
    select e.user_id, e.event,
           e.props->>'n'           as n,
           e.props->>'kind'        as kind,
           e.props->>'n_files'     as n_files,
           e.props->>'n_selected'  as n_selected,
           e.props->>'device_type' as device_type,
           e.props->>'board_id'    as board_id
      from public.analytics_events e
      join u on u.user_id = e.user_id
     where e.occurred_at >= u.signup and e.occurred_at < u.signup + 1
  ),
  err as (
    select distinct c.user_id
      from public.client_errors c
      join u on u.user_id = c.user_id
     where c.occurred_at::date = u.signup
  ),
  -- 0461: every day-one signal in one pass over ev. Asking ev again for each
  -- signal and each person grew with the square of the signups, and ran past
  -- the API's statement timeout, so the Retention panel came back empty.
  per_user as (
    select e.user_id,
           sum(e.n::int) filter (where e.event = 'card_placed')                    as cards,
           bool_or(e.kind in ('note', 'doc', 'script'))
             filter (where e.event = 'card_placed')                                as wrote_text,
           bool_or(true) filter (where e.event = 'onboarding_nest')                as nested,
           bool_or(coalesce(e.n_files::int, e.n_selected::int, 0) >= 3)
             filter (where e.event in ('import_batch', 'photo_pick_commit'))       as batch_upload,
           bool_or(e.device_type = 'mobile')                                       as mobile,
           bool_or(true) filter (where e.event = 'onboarding_intent')              as answered_intent,
           bool_or(true) filter (where e.event in ('share_open', 'share_link_copied', 'share_link_created',
                                                   'invite_link_created', 'invite_sent', 'share_ask_taken'))
                                                                                   as shared,
           bool_or(true) filter (where e.event in ('card_create_stuck', 'card_create_blocked'))
                                                                                   as hit_friction,
           count(distinct e.board_id) filter (where e.event = 'board_open')        as boards_opened
      from ev e
     group by e.user_id
  ),
  outcome as (
    select u.user_id, (count(distinct a.day) > 1) as returned
      from u
      left join public.user_active_day a on a.user_id = u.user_id
     group by u.user_id
  ),
  flags as (
    select u.user_id, coalesce(p.cards, 0) as cards, o.returned,
           coalesce(p.wrote_text, false)            as wrote_text,
           coalesce(p.nested, false)                as nested,
           coalesce(p.batch_upload, false)          as batch_upload,
           coalesce(p.mobile, false)                as mobile,
           (u.user_id in (select user_id from err)) as day1_error,
           coalesce(p.answered_intent, false)       as answered_intent,
           coalesce(p.shared, false)                as shared,
           coalesce(p.hit_friction, false)          as hit_friction,
           coalesce(p.boards_opened, 0) > 1         as multi_board
      from u
      join outcome o on o.user_id = u.user_id
      left join per_user p on p.user_id = u.user_id
  ),
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
end $function$;

-- admin_signup_funnel: the live body, with the code steps named for what they
-- count and one derived leak row, 'code_never_entered'.
create or replace function public.admin_signup_funnel(p_days integer default 30, p_source text default null, p_campaign text default null, p_content text default null, p_exclude_internal boolean default true, p_has_fbclid boolean default null)
returns table (ord integer, step text, label text, branch text, sessions bigint, users bigint)
language plpgsql stable security definer set search_path = public set work_mem = '16MB'
as $function$
#variable_conflict use_column
declare
  v_since timestamptz := now() - (greatest(1, least(p_days, 365)) || ' days')::interval;
  v_src   text := nullif(trim(coalesce(p_source,   '')), '');
  v_camp  text := nullif(trim(coalesce(p_campaign, '')), '');
  v_cont  text := nullif(trim(coalesce(p_content,  '')), '');
  v_has_fbclid boolean := p_has_fbclid;
begin
  perform public._require_admin();
  return query
  with
  ev as (
    select e.session_id, e.user_id, e.event, e.occurred_at,
           (e.props->>'fbclid' is not null or e.props->>'fbc' is not null) as has_fbc,
           e.props->>'utm_source'   as utm_source,
           e.props->>'utm_campaign' as utm_campaign,
           e.props->>'utm_content'  as utm_content
    from public.analytics_events e
    where e.occurred_at >= v_since
      and e.session_id is not null
      and (not p_exclude_internal
           or e.session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  sessions_all as (select distinct session_id from ev),
  fbc_src as (select distinct e.session_id from ev e where e.has_fbc),
  attr_src as (
    select distinct on (e.session_id)
      e.session_id, e.utm_source as src, e.utm_campaign as campaign, e.utm_content as content
    from ev e where e.utm_source is not null order by e.session_id, e.occurred_at asc
  ),
  sess_user as (
    select distinct on (session_id) session_id, user_id from ev where user_id is not null order by session_id, occurred_at desc
  ),
  attr as (
    select s.session_id,
      coalesce(a.src, pr.first_source->>'utm_source') as src,
      coalesce(a.campaign, pr.first_source->>'utm_campaign') as campaign,
      coalesce(a.content, pr.first_source->>'utm_content') as content,
      (fb.session_id is not null) or (pr.first_source->>'fbclid' is not null) as has_fbclid
    from sessions_all s
    left join attr_src a on a.session_id = s.session_id
    left join sess_user su on su.session_id = s.session_id
    left join public.profiles pr on pr.user_id = su.user_id
    left join fbc_src fb on fb.session_id = s.session_id
  ),
  sel as (
    select a.session_id from attr a
    where (v_src is null or lower(a.src) = lower(v_src))
      and (v_camp is null or lower(a.campaign) = lower(v_camp))
      and (v_cont is null or a.content = v_cont)
      and (v_has_fbclid is null or a.has_fbclid = v_has_fbclid)
  ),
  steps(ord, step, label, branch) as (
    values
      (1,  'landing_view',        'Landing view',           'core'),
      (2,  'email_submit',        'Asked for a code',       'core'),
      (3,  'otp_verify',          'Entered the code',       'core'),
      (4,  'welcome_view',        'Welcome page',           'core'),
      (5,  'submit_socials_open', 'Opened waitlist form',   'waitlist'),
      (6,  'submit_socials_done', 'Joined waitlist',        'waitlist'),
      (7,  'pricing_view',        'Viewed pricing',         'pricing'),
      (8,  'checkout_open',       'Opened checkout',        'pricing'),
      (9,  'checkout_success',    'Completed payment',      'pricing'),
      (20, 'email_submit_error',  'Code request failed',    'leak'),
      (21, 'otp_verify_error',    'Code not accepted',      'leak'),
      (22, 'waitlist_abandon',    'Abandoned waitlist form','leak'),
      (23, 'pricing_abandon',     'Abandoned pricing',      'leak'),
      (24, 'checkout_error',      'Checkout failed',        'leak'),
      -- 0461: not an event. The browsers that asked for a code and never
      -- entered one, which the counts CTE derives from steps 2 and 3.
      (25, 'code_never_entered',  'Never entered the code', 'leak')
  ),
  counts as (
    select e.event, count(distinct e.session_id) as sessions, count(distinct e.user_id) as users
    from ev e join sel on sel.session_id = e.session_id group by e.event
    union all
    select 'code_never_entered', count(*), 0
      from (select e.session_id
              from ev e join sel on sel.session_id = e.session_id
             where e.event in ('email_submit', 'otp_verify')
             group by e.session_id
            having not bool_or(e.event = 'otp_verify')) asked
  )
  select st.ord, st.step, st.label, st.branch,
         coalesce(c.sessions, 0)::bigint as sessions, coalesce(c.users, 0)::bigint as users
  from steps st left join counts c on c.event = st.step order by st.ord;
end $function$;

-- admin_universe_stats: the live body, with people counted once, from the
-- helper, for all three of its windows. The party worker reads it every
-- second while the Universe is open.
create or replace function public.admin_universe_stats()
returns jsonb
language plpgsql stable security definer set search_path = public
as $function$
declare
  v_midnight timestamptz := date_trunc('day', now());
  v_since    timestamptz := now() - interval '24 hours';
  v_totals   jsonb;
  v_24h      jsonb;
  v_today    jsonb;
  v_people   record;
begin
  perform public._require_admin();

  -- 0461: people count once they have entered the emailed code. One pass
  -- serves all three windows, because the party worker reads this payload
  -- every second while the Universe is open and the helper is the costly part.
  select count(*)                                          as total,
         count(*) filter (where u.created_at >= v_since)    as last_24h,
         count(*) filter (where u.created_at >= v_midnight) as today
    into v_people
    from auth.users u
   where u.id in (select ec.entered_id from public._admin_entered_code() ec);

  v_totals := jsonb_build_object(
    'total_users',          v_people.total,
    'total_workspaces',     (select count(*) from public.workspaces),
    'total_boards',         (select count(*) from public.boards where deleted_at is null),
    'total_clusters_made',  (select count(*) from public.boards where deleted_at is null and parent_board_id is not null),
    'total_studios',        (select count(*) from public.boards where deleted_at is null and parent_board_id is null),
    'total_cards',          (select count(*) from public.card_index ci join public.boards b on b.id = ci.board_id where b.deleted_at is null),
    'total_links',          (select count(*) from public.entity_links) + (select count(*) from public.doc_backlinks),
    'total_seconds_in_app', (select coalesce(sum(seconds_in_app), 0) from public.profiles)
  );

  v_24h := jsonb_build_object(
    'users',         v_people.last_24h,
    'workspaces',    (select count(*) from public.workspaces where created_at >= v_since),
    'boards',        (select count(*) from public.boards where deleted_at is null and created_at >= v_since),
    'clusters_made', (select count(*) from public.boards
                       where deleted_at is null and parent_board_id is not null and created_at >= v_since),
    'cards',         (select count(*) from public.card_index ci join public.boards b on b.id = ci.board_id
                       where b.deleted_at is null and ci.created_at >= v_since)
  );

  -- Unchanged since 0254: the Command Center's chart puts today.cards in place
  -- of admin_cards_per_day's last bar, so the two must count the same thing.
  v_today := jsonb_build_object(
    'users',      v_people.today,
    'workspaces', (select count(*) from public.workspaces where created_at >= v_midnight),
    'boards',     (select count(*) from public.boards  where created_at >= v_midnight and deleted_at is null),
    -- card-count-lint: activity — made since midnight, trashed clusters included.
    'cards',      (select count(*) from public.card_index where created_at >= v_midnight),
    'tags',       (select count(*) from public.entity_links where created_at >= v_midnight),
    'links',      (select count(*) from public.doc_backlinks where updated_at >= v_midnight)
  );

  return v_totals || jsonb_build_object(
    -- The galaxy's own definition of a new node, in the last 24 hours.
    'nodes_created_24h', (v_24h->>'users')::bigint + (v_24h->>'workspaces')::bigint
                       + (v_24h->>'boards')::bigint + (v_24h->>'cards')::bigint,
    'last_24h', v_24h,
    'today',    v_today
  );
end $function$;

-- ── 4. History moves with the definition ───────────────────────────────────
-- Each day's signups, and the running total of people who had signed up by its
-- end and still have an account, counted the way capture_metrics_daily counts
-- them from today on. The tier and money columns stay as they were: they were
-- snapshots, and nothing here draws them over time.

with signed as (
  select u.created_at
    from auth.users u
   where u.id in (select ec.entered_id from public._admin_entered_code() ec)
)
update public.metrics_daily m
   set signups     = (select count(*) from signed s
                       where s.created_at >= m.day and s.created_at < m.day + 1)::int,
       total_users = (select count(*) from signed s where s.created_at < m.day + 1)::int;

-- ── 5. Proof ────────────────────────────────────────────────────────────────

do $proof$
declare
  v_fn  regprocedure;
  v_src text;
  -- The definer-only helpers and the cron entry point, which no client role
  -- has ever had.
  v_closed regprocedure[] := array[
    'public._admin_people(boolean,boolean)',
    'public._admin_visits(date,boolean,boolean,integer)',
    'public.capture_metrics_daily(date)'
  ]::regprocedure[];
  v_readers regprocedure[] := array[
    'public._admin_people(boolean,boolean)',
    'public._admin_visits(date,boolean,boolean,integer)',
    'public.admin_acquisition_breakdown(integer,boolean,boolean)',
    'public.admin_acquisition_channels(text,text)',
    'public.admin_activation_by_experiment(text,integer,boolean)',
    'public.admin_activation_funnel(integer,boolean,boolean)',
    'public.admin_activation_funnel(integer,boolean,boolean,text)',
    'public.admin_avg_time_to_paid(boolean)',
    'public.admin_engaged_weeks(date,date,boolean,boolean,integer)',
    'public.admin_event_coverage(integer,boolean,boolean)',
    'public.admin_feature_reach(date,integer,boolean,boolean)',
    'public.admin_first_session_compare(date,integer,boolean,boolean)',
    'public.admin_geo_breakdown(integer,boolean)',
    'public.admin_landing_scorecard(integer,boolean)',
    'public.admin_list_users(integer,integer,text,text,text,text,text,text,text,text)',
    'public.admin_retention_by_experiment(text,integer,boolean)',
    'public.admin_retention_by_source(integer,boolean,boolean)',
    'public.admin_retention_cohort_matrix(integer,boolean,boolean,boolean)',
    'public.admin_retention_cohorts(integer,boolean,boolean)',
    'public.admin_retention_curve(integer,boolean,boolean,boolean)',
    'public.admin_return_predictors(date,integer,boolean,boolean)',
    'public.admin_return_rate(boolean,boolean,boolean)',
    'public.admin_signups_by_day(integer,boolean,boolean)',
    'public.admin_stats(boolean)',
    'public.admin_tier_usage_compare(integer,boolean,boolean)',
    'public.admin_time_to_first_card(integer,boolean)',
    'public.admin_top_users(text,integer,boolean,boolean)',
    'public.admin_universe_stats()',
    'public.admin_user_count(text,text,text,text,text,text,text)',
    'public.admin_user_detail(uuid)',
    'public.admin_user_dormancy(boolean,boolean)',
    'public.admin_user_lifespan(boolean,boolean)',
    'public.capture_metrics_daily(date)'
  ]::regprocedure[];
begin
  if has_function_privilege('anon', 'public._admin_entered_code()', 'execute')
     or has_function_privilege('authenticated', 'public._admin_entered_code()', 'execute')
     or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                 where p.oid = 'public._admin_entered_code()'::regprocedure and a.grantee = 0) then
    raise exception '0461: _admin_entered_code() is callable outside definer functions';
  end if;
  if not has_function_privilege('service_role', 'public._admin_entered_code()', 'execute') then
    raise exception '0461: service_role cannot execute _admin_entered_code()';
  end if;

  foreach v_fn in array v_readers loop
    select p.prosrc into v_src from pg_proc p where p.oid = v_fn;
    if v_src !~ 'public\._admin_entered_code\(\)' then
      raise exception '0461: % does not ask _admin_entered_code()', v_fn;
    end if;
    if v_src ~* 'email_confirmed_at\s+is\s+(not\s+)?null\s+(and|or)\s+([a-z_]+\.)?last_sign_in_at' then
      raise exception '0461: % still counts by 0149''s verified rule', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0461: anon can execute %', v_fn;
    end if;
    if has_function_privilege('authenticated', v_fn, 'execute') = (v_fn = any (v_closed)) then
      raise exception '0461: authenticated EXECUTE on % is not what it was', v_fn;
    end if;
  end loop;

  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.admin_journey_dropoff(integer,boolean)'::regprocedure;
  if v_src !~ '\(''ad_welcome'',5\),\s*\(''setup'',6\),\(''app_enter'',7\)' then
    raise exception '0461: admin_journey_dropoff does not order setup between ad_welcome and app_enter';
  end if;

  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.admin_signup_funnel(integer,text,text,text,boolean,boolean)'::regprocedure;
  if v_src !~ '\(25, ''code_never_entered''' then
    raise exception '0461: admin_signup_funnel has no never-entered row';
  end if;

  foreach v_fn in array array[
    'public.admin_journey_dropoff(integer,boolean)',
    'public.admin_signup_funnel(integer,text,text,text,boolean,boolean)'
  ]::regprocedure[] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0461: the grants on % moved', v_fn;
    end if;
  end loop;
end $proof$;

notify pgrst, 'reload schema';

commit;
