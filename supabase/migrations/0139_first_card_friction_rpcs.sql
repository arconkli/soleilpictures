-- 0139_first_card_friction_rpcs.sql
--
-- The admin First-Card Friction view. The activation funnel (0120) tells you HOW
-- MANY users placed a first card; these RPCs tell you WHERE the ones who didn't
-- got stuck — the missing half of the funnel (attempts + failures, not just
-- successes). They read the new friction events the client now emits:
--
--   card_create_intent  {method}   — every "make a card" gesture (fired BEFORE
--                                     the mutator, so a blocked create still has a
--                                     preceding intent to correlate)
--   card_create_blocked {reason}   — an intent that produced no card (the silent
--                                     canvas dead-ends, now instrumented)
--   card_create_stuck   {reason}   — frictionSignal.js fired (rage / timeout)
--   onboarding_*_failed            — previously-silent seed/persist/first-source
--                                     failures
--
-- DEPENDENCY: these events do not exist before the App.jsx/CanvasSurface emit
-- changes ship. Until then the RPCs return zeros/empty arrays (never error), and
-- the widgets render their "still collecting" placeholders — so this migration is
-- safe to apply ahead of, or alongside, the client change.
--
-- Conventions mirror 0120/0117/0110/0121 verbatim: perform _require_admin();
-- p_days clamp; internal exclusion (_internal_user_ids for profile-keyed RPCs,
-- _internal_session_ids for event-keyed ones); stable security definer; revoke
-- all from public + grant execute to authenticated.

------------------------------------------------------------------
-- 1. admin_time_to_first_card — distribution of (first_card_at - signup).
--    Profile-keyed (first_card_at lives on profiles, de-contaminated of onb-*
--    seeds by 0120's _stamp_first_card), so internal exclusion uses
--    _internal_user_ids(). Returns percentiles + a right-censoring-aware
--    histogram, plus by-source and by-device sub-histograms for the widget's
--    segment toggle. The 'never' bucket counts ONLY users whose signup is older
--    than the largest finite bucket (>30m); a user who signed up 2 minutes ago
--    with no card yet is 'pending' (un-elapsed), not a failure.
------------------------------------------------------------------
create or replace function public.admin_time_to_first_card(
  p_days integer default 30, p_exclude_internal boolean default true
)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
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
     where u.email_confirmed_at is not null
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
revoke all on function public.admin_time_to_first_card(integer, boolean) from public;
grant execute on function public.admin_time_to_first_card(integer, boolean) to authenticated;

------------------------------------------------------------------
-- 2. admin_first_card_friction — intent → success vs blocked-by-reason for the
--    new-user friction events. Event-keyed (analytics_events), so internal
--    exclusion is session-level (_internal_session_ids), and the join key is
--    session_id (pre-auth intent rows can have a null user_id — same idiom as
--    admin_signup_funnel). Success = onboarding_first_card / card_placed (both
--    already seed-excluded on the client), NOT raw card_index inserts.
------------------------------------------------------------------
create or replace function public.admin_first_card_friction(
  p_days integer default 30, p_exclude_internal boolean default true
)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
#variable_conflict use_column
declare v jsonb;
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  with ev as (
    select e.session_id, e.user_id, e.event, e.props
      from public.analytics_events e
     where e.occurred_at >= now() - (p_days || ' days')::interval
       and e.event in ('card_create_intent','card_create_blocked','card_create_stuck','onboarding_first_card','card_placed')
       and (not p_exclude_internal or e.session_id is null
            or e.session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  sess as (
    select e.session_id,
           bool_or(e.event = 'card_create_intent') as has_intent,
           bool_or(e.event in ('onboarding_first_card','card_placed')) as has_success,
           bool_or(e.event = 'card_create_stuck') as has_stuck,
           max(case
                 when (e.props->>'fbclid') is not null
                      or lower(coalesce(e.props->>'utm_source','')) ~ '(facebook|instagram|meta|fb|ig)'
                      or lower(coalesce(e.props->>'utm_medium','')) ~ '(cpc|paid|ad|social)' then 'ad'
                 when coalesce(nullif(e.props->>'utm_source',''), nullif(e.props->>'referrer','')) is not null then 'referral'
                 else 'organic'
               end) as source,
           max(coalesce(nullif(e.props->>'device_type',''),'unknown')) as device
      from ev e
     where e.session_id is not null
     group by e.session_id
  ),
  by_method as (
    select coalesce(nullif(e.props->>'method',''),'unknown') as method,
           count(distinct e.session_id)::int as sessions, count(distinct e.user_id)::int as users
      from ev e where e.event = 'card_create_intent' group by 1
  ),
  by_reason as (
    select coalesce(nullif(e.props->>'reason',''),'unknown') as reason,
           count(distinct e.session_id)::int as sessions, count(distinct e.user_id)::int as users
      from ev e where e.event = 'card_create_blocked' group by 1
  )
  select jsonb_build_object(
    'intents_total',      (select count(*) from ev where event = 'card_create_intent'),
    'intent_sessions',    (select count(*) from sess where has_intent),
    'converted_sessions', (select count(*) from sess where has_intent and has_success),
    'stuck_sessions',     (select count(*) from sess where has_stuck),
    'intent_to_card_pct', (select round(count(*) filter (where has_intent and has_success)::numeric
                                       / nullif(count(*) filter (where has_intent), 0), 4) from sess),
    'intents_by_method',  coalesce((select jsonb_agg(jsonb_build_object('method', method, 'sessions', sessions, 'users', users) order by sessions desc) from by_method), '[]'::jsonb),
    'blocked_by_reason',  coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'sessions', sessions, 'users', users) order by sessions desc) from by_reason), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', source,
                     'intent_sessions', isess, 'converted_sessions', csess) order by source)
                   from (select source,
                            count(*) filter (where has_intent)::int as isess,
                            count(*) filter (where has_intent and has_success)::int as csess
                         from sess group by source) s), '[]'::jsonb),
    'by_device', coalesce((select jsonb_agg(jsonb_build_object('device', device,
                     'intent_sessions', isess, 'converted_sessions', csess) order by isess desc)
                   from (select device,
                            count(*) filter (where has_intent)::int as isess,
                            count(*) filter (where has_intent and has_success)::int as csess
                         from sess group by device) d), '[]'::jsonb)
  ) into v;
  return v;
end $function$;
revoke all on function public.admin_first_card_friction(integer, boolean) from public;
grant execute on function public.admin_first_card_friction(integer, boolean) to authenticated;

------------------------------------------------------------------
-- 3. admin_onboarding_error_coverage — volume of the previously-silent
--    onboarding/friction error events. A SEPARATE function from
--    admin_event_coverage (0120): those reconcile client events against a
--    server-side TRUTH column; these errors have no server truth to reconcile,
--    so this is a curated breakdown (modeled on admin_event_breakdown, 0110),
--    with top_reason = the most common reason/stage for that event.
------------------------------------------------------------------
create or replace function public.admin_onboarding_error_coverage(
  p_days integer default 30, p_exclude_internal boolean default true
)
returns table(event text, sessions integer, users integer, total integer, top_reason text, ord integer)
language plpgsql stable security definer set search_path to 'public' as $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 36500));
  return query
  with ev as (
    select * from public.analytics_events
     where occurred_at >= now() - (p_days || ' days')::interval
       and (not p_exclude_internal or session_id is null
            or session_id not in (select isess.session_id from public._internal_session_ids() isess))
  ),
  curated(event, reason_key, ord) as (
    values
      ('card_create_blocked',                 'reason', 1),
      ('card_create_stuck',                   'reason', 2),
      ('onboarding_seed_failed',              'stage',  3),
      ('onboarding_settings_persist_failed',  'op',     4),
      ('onboarding_first_source_failed',      'reason', 5)
  ),
  top_r as (
    select e.event, e.props->>c.reason_key as r,
           row_number() over (partition by e.event order by count(*) desc) as rn
      from ev e join curated c on c.event = e.event
     where e.props->>c.reason_key is not null
     group by e.event, e.props->>c.reason_key
  )
  select c.event,
         count(distinct ev.session_id)::int as sessions,
         count(distinct ev.user_id)::int as users,
         count(ev.*)::int as total,
         (select tr.r from top_r tr where tr.event = c.event and tr.rn = 1) as top_reason,
         c.ord
    from curated c
    left join ev on ev.event = c.event
   group by c.event, c.ord
   order by c.ord;
end $function$;
revoke all on function public.admin_onboarding_error_coverage(integer, boolean) from public;
grant execute on function public.admin_onboarding_error_coverage(integer, boolean) to authenticated;
