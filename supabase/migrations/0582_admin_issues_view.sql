-- 0582_admin_issues_view.sql
--
-- STATUS: applied 2026-10-24 through the MCP in seven records,
-- admin_issues_view_part1 … part7 (the proof is the seventh). Every function
-- body live is this file's, byte for byte.
--
-- The reads behind Admin, Errors, rebuilt as the Issues view. The owner
-- decided on 2026-10-24 that nothing routine is emailed (0581 emails only what
-- is super breaking), so this view is where every other problem waits. It has
-- to answer, at a glance: what is failing, for how many people, since when, is
-- it getting worse, and what were they doing when it happened.
--
-- Every read is admin-only (_require_admin) and leaves staff accounts out by
-- default: a row whose user is internal, or whose browser was ever signed in
-- as staff (_internal_session_ids). "People" counts what 0581 counts: a
-- browser's session, else its user, else its app session.
--
--   admin_error_groups          the problems seen in a window, by group (0580's
--                               fingerprint), each with its people, a 14-day
--                               spark and its badges (new, returned, breaking),
--                               plus what 0581 would email right now and what
--                               it has emailed this week. A lens picks the
--                               slice: problems (everything but the monitors),
--                               crashes, requests, stuck & slow, servers,
--                               monitors (CSP, perf and the SEO/AEO probes,
--                               which have channels of their own), all.
--   admin_error_group           one problem: its trend, releases, browsers,
--                               paths and context, and its latest occurrences
--                               with the steps that led to each.
--   admin_error_session_trail   one browser's errors, analytics events and
--                               feedback, 15 minutes either side of a moment.
--   admin_set_error_group_status  open | resolved | muted. Resolving remembers
--                               the releases it was seen on, so 0580's refresh
--                               reopens it when a new one brings it back.
--   admin_user_errors           what one person ran into (AdminUserDetail).
--   admin_failure_events        actions that failed without throwing, from
--                               analytics: sign-in, checkout, imports, moves...
--   admin_click_friction        clicks that did nothing and rage clicks, by
--                               what was clicked (appTrace.js and its twins).
--
-- Nothing here writes except admin_set_error_group_status. The older reads
-- (admin_error_summary, admin_recent_errors, admin_mute_error, 0133) stay
-- until the production client stops calling them.

-- ── 1. Helpers ───────────────────────────────────────────────────────────────

-- A browser and its platform, from a user agent: "Safari · iOS".
create or replace function public._ua_family(p_ua text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case when coalesce(p_ua, '') = '' then 'Unknown' else
    (case
       when p_ua ~* '(FBAN|FBAV|Instagram|TikTok|Snapchat|LinkedInApp|GSA/|Line/)' then 'In-app'
       when p_ua ~* 'Edg(e|A|iOS)?/' then 'Edge'
       when p_ua ~* '(OPR/|Opera)' then 'Opera'
       when p_ua ~* 'SamsungBrowser' then 'Samsung'
       when p_ua ~* '(Firefox/|FxiOS)' then 'Firefox'
       when p_ua ~* '(CriOS|Chrome/|Chromium)' then 'Chrome'
       when p_ua ~* 'Safari/' then 'Safari'
       else 'Other' end)
    || ' · ' ||
    (case
       when p_ua ~* '(iPhone|iPad|iPod)' then 'iOS'
       when p_ua ~* 'Android' then 'Android'
       when p_ua ~* 'CrOS' then 'ChromeOS'
       when p_ua ~* '(Mac OS X|Macintosh)' then 'Mac'
       when p_ua ~* 'Windows' then 'Windows'
       when p_ua ~* 'Linux' then 'Linux'
       else 'Other' end)
  end
$$;

-- A path as a template: no query, no fragment, ids and numbers as :id and :n.
-- Link tokens are already :token (0474 redacts them on insert).
create or replace function public._error_path_template(p_path text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select nullif(left(regexp_replace(regexp_replace(
           split_part(split_part(coalesce(p_path, ''), '?', 1), '#', 1),
           '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', ':id', 'gi'),
           '/[0-9]+(?=/|$)', '/:n', 'g'), 80), '')
$$;

-- Which rows a lens shows. The monitors have channels of their own, and a
-- crawler is nobody's problem, so neither is in any lens but theirs and all.
create or replace function public._error_lens_ok(p_lens text, p_kind text, p_source text,
                                                 p_severity text, p_message text, p_user_agent text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select case coalesce(p_lens, 'problems')
    when 'all' then true
    when 'monitors' then coalesce(p_kind, '') in ('csp_violation', 'perf', 'seo_health', 'discovery_pipeline', 'aeo_probe')
    else coalesce(p_kind, '') not in ('csp_violation', 'perf', 'seo_health', 'discovery_pipeline', 'aeo_probe')
         and not public._error_is_bot_ua(p_user_agent)
         and case p_lens
               when 'crashes'  then p_severity = 'crash'
               when 'requests' then p_kind = 'http'
               when 'stuck'    then p_kind in ('stuck', 'sync')
                                    or (p_kind = 'http' and coalesce(p_message, '') like '%: slow%')
               when 'servers'  then p_source <> 'client'
               else true end
  end
$$;

-- The events that carry their own outcome in props: ok, outcome, result,
-- status or failed. adminIssuesMigration.test.mjs reads every logEvent call that
-- passes one of those and fails when its event is missing here.
create or replace function public._outcome_events()
returns text[]
language sql
immutable
set search_path to 'public'
as $$
  select array['checkout_verify_result', 'editor_limit_make_room', 'files_delete', 'files_move',
               'files_put', 'folder_import', 'import_job', 'invite_link_claim_result', 'invite_sent',
               'msg_action', 'msg_send', 'scout_signup_ok', 'shared_file_save', 'shared_file_shortcut',
               'web_image_save', 'workspace_link_claim_result', 'workspace_link_landed']
$$;

-- An analytics event that says something failed: by its name (EMAIL_SUBMIT_ERROR,
-- CARDS_MOVE_FAIL, ONBOARDING_SEED_FAILED, CARD_CREATE_STUCK...), as one of
-- featureEvents.js's failures, or by its outcome (ok:false, outcome:'failed',
-- status:'error', failed:3...).
create or replace function public._event_is_failure(p_event text, p_props jsonb)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(
       coalesce(p_event, '') ~ '(_error|_fail|_failed|_stuck)$'
    or coalesce(p_event, '') in ('editor_limit_refused', 'mobile_lift_cancelled')
    or (p_event = any(public._outcome_events()) and jsonb_typeof(p_props) = 'object' and (
           p_props->>'ok' = 'false'
        or p_props->>'outcome' in ('failed', 'error')
        or p_props->>'result' in ('failed', 'error')
        or p_props->>'status' in ('failed', 'error')
        or (jsonb_typeof(p_props->'failed') = 'number' and (p_props->>'failed')::numeric > 0))),
    false)
$$;

-- Every event name that can be a failure, found by stepping through the
-- (event, occurred_at) index one name at a time: a few hundred probes, where
-- testing each row's props would read the whole table.
create or replace function public._failure_event_names()
returns text[]
language sql
stable
set search_path to 'public'
as $$
  with recursive names(event) as (
    (select a.event from public.analytics_events a where a.event is not null order by a.event limit 1)
    union all
    select (select a.event from public.analytics_events a where a.event > n.event order by a.event limit 1)
      from names n
     where n.event is not null
  )
  select coalesce(array_agg(n.event), '{}')
    from names n
   where n.event ~ '(_error|_fail|_failed|_stuck)$'
      or n.event in ('editor_limit_refused', 'mobile_lift_cancelled')
      or n.event = any(public._outcome_events())
$$;

-- An event's props in a trail, without the attribution every event carries.
create or replace function public._trail_props(p jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select case when jsonb_typeof(p) = 'object' then
    nullif((select coalesce(jsonb_object_agg(j.k, j.v), '{}'::jsonb)
              from jsonb_each(p) j(k, v)
             where j.k !~ '^(lt_|utm_|exp_|referrer)'
               and j.k not in ('browser', 'os', 'device_type', 'build', 'tier', 'landing_path',
                               'session_seq', 'is_webview', 'webview_app')), '{}'::jsonb)
  end
$$;

revoke all on function public._ua_family(text) from public, anon, authenticated;
revoke all on function public._error_path_template(text) from public, anon, authenticated;
revoke all on function public._error_lens_ok(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public._outcome_events() from public, anon, authenticated;
revoke all on function public._event_is_failure(text, jsonb) from public, anon, authenticated;
revoke all on function public._failure_event_names() from public, anon, authenticated;
revoke all on function public._trail_props(jsonb) from public, anon, authenticated;

-- ── 2. The problems ──────────────────────────────────────────────────────────
create or replace function public.admin_error_groups(
  p_days             integer default 7,
  p_lens             text    default 'problems',
  p_status           text    default 'open',
  p_env              text    default 'prod',
  p_kind             text    default null,
  p_exclude_internal boolean default true,
  p_limit            integer default 200)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_days      integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_limit     integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_lens      text := coalesce(nullif(p_lens, ''), 'problems');
  v_status    text := coalesce(nullif(p_status, ''), 'open');
  v_env       text := coalesce(nullif(p_env, ''), 'prod');
  v_since     timestamptz := now() - make_interval(days => v_days);
  v_today     date := (now() at time zone 'utc')::date;
  v_from      timestamptz;
  v_breaking  jsonb := '[]'::jsonb;
  v_hot       text[] := '{}';
  v_out       jsonb;
begin
  perform public._require_admin();
  if v_lens not in ('problems', 'crashes', 'requests', 'stuck', 'servers', 'monitors', 'all') then
    raise exception 'unknown lens %', v_lens using errcode = '22023';
  end if;
  if v_status not in ('open', 'resolved', 'muted', 'all') then
    raise exception 'unknown status %', v_status using errcode = '22023';
  end if;
  if v_env not in ('prod', 'preview', 'dev', 'all') then
    raise exception 'unknown env %', v_env using errcode = '22023';
  end if;
  -- The spark is the last 14 days whatever the window, so read the longer.
  v_from := least(v_since, (v_today - 13)::timestamp at time zone 'utc');

  -- What 0581 would email this minute; its dry run sends nothing. A failing
  -- check says so here rather than taking the view down with it.
  begin
    select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb),
           coalesce(array_agg(b.problem) filter (where b.rule = 'widespread'), '{}')
      into v_breaking, v_hot
      from public.check_breaking(true) b;
  exception when others then
    v_breaking := jsonb_build_array(jsonb_build_object(
      'rule', 'check_failed', 'title', 'The breaking check failed: ' || left(sqlerrm, 200)));
  end;

  with internal_users as materialized (
    select iu.user_id from public._internal_user_ids() iu where p_exclude_internal
  ), internal_sessions as materialized (
    select s.session_id from public._internal_session_ids() s where p_exclude_internal
  ), seen as materialized (
    select e.fingerprint, e.kind, e.source, e.severity, e.received_at, e.user_id,
           coalesce(e.session_id::text, e.user_id::text, e.app_session_id::text) as person
      from public.client_errors e
     where e.received_at > v_from
       and e.fingerprint is not null
       and (v_env = 'all' or coalesce(e.env, 'prod') = v_env)
       and public._error_lens_ok(v_lens, e.kind, e.source, e.severity, e.message, e.user_agent)
       and (e.user_id is null or not exists (select 1 from internal_users i where i.user_id = e.user_id))
       and (e.session_id is null or not exists (select 1 from internal_sessions s where s.session_id = e.session_id))
  ), win as (
    select * from seen where received_at > v_since
  ), agg as (
    select w.fingerprint, count(*)::integer as n, count(distinct w.person)::integer as people,
           count(distinct w.user_id)::integer as users, max(w.received_at) as last_at,
           max(w.kind) as row_kind, max(w.source) as row_source,
           -- 'crash' < 'error' < 'warning': the worst one seen.
           min(w.severity) as row_severity
      from win w
     where p_kind is null or w.kind = p_kind
     group by w.fingerprint
  ), kept as (
    select a.fingerprint, a.n, a.people, a.users, a.last_at,
           coalesce(g.kind, a.row_kind) as kind, coalesce(g.source, a.row_source) as source,
           coalesce(g.severity, a.row_severity) as severity,
           g.sample_message, g.sample_path, g.first_seen, g.first_release, g.last_release,
           coalesce(g.status, 'open') as status, g.status_at, g.returned_at, g.occurrences as all_time,
           a.fingerprint = any(v_hot) as breaking
      from agg a
      left join public.client_error_groups g on g.fingerprint = a.fingerprint
     where v_status = 'all' or coalesce(g.status, 'open') = v_status
  ), top as (
    select * from kept k
     order by k.breaking desc, k.people desc,
              case k.severity when 'crash' then 0 when 'error' then 1 else 2 end, k.n desc, k.last_at desc
     limit v_limit
  ), daily as (
    select s.fingerprint, (s.received_at at time zone 'utc')::date as day, count(*)::integer as n
      from seen s
     where s.fingerprint in (select t.fingerprint from top t)
       and s.received_at >= (v_today - 13)::timestamp at time zone 'utc'
     group by 1, 2
  )
  select jsonb_build_object(
    'days', v_days,
    'since', v_since,
    'totals', jsonb_build_object(
      'problems',     (select count(*) from kept),
      'occurrences',  (select coalesce(sum(k.n), 0) from kept k),
      'people',       (select count(distinct w.person) from win w join kept k on k.fingerprint = w.fingerprint),
      'crash_people', (select count(distinct w.person) from win w join kept k on k.fingerprint = w.fingerprint
                        where w.severity = 'crash'),
      'new',          (select count(*) from kept k where k.first_seen > now() - interval '48 hours'),
      'returned',     (select count(*) from kept k where k.returned_at > v_since)),
    'kinds', (select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'n', x.n, 'groups', x.groups)
                                        order by x.n desc), '[]'::jsonb)
                from (select w.kind, count(*)::integer as n, count(distinct w.fingerprint)::integer as groups
                        from win w group by w.kind) x),
    'breaking', v_breaking,
    'alerts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'at', a.created_at, 'kind', a.kind,
                                                            'title', a.title, 'paged_at', a.paged_at)
                                         order by a.created_at desc), '[]'::jsonb)
                 from (select * from public.ops_alerts a
                        where a.kind in ('something_is_breaking', 'error_watch_is_failing') and a.page
                          and a.created_at > now() - interval '7 days'
                        order by a.created_at desc limit 20) a),
    'groups', (select coalesce(jsonb_agg(jsonb_build_object(
                 'fingerprint', t.fingerprint, 'kind', t.kind, 'source', t.source, 'severity', t.severity,
                 'message', coalesce(t.sample_message,
                                     (select e.message from public.client_errors e
                                       where e.fingerprint = t.fingerprint order by e.occurred_at desc limit 1)),
                 'path', public._error_path_template(t.sample_path),
                 'first_seen', t.first_seen, 'first_release', t.first_release, 'last_release', t.last_release,
                 'last_at', t.last_at, 'status', t.status, 'status_at', t.status_at, 'returned_at', t.returned_at,
                 'n', t.n, 'people', t.people, 'users', t.users, 'all_time', t.all_time,
                 'breaking', t.breaking,
                 'is_new', coalesce(t.first_seen > now() - interval '48 hours', true),
                 'returned', coalesce(t.returned_at > v_since, false),
                 'spark', (select jsonb_agg(coalesce(d.n, 0) order by g.day)
                             from generate_series((v_today - 13)::timestamp, v_today::timestamp, interval '1 day') g(day)
                             left join daily d on d.fingerprint = t.fingerprint and d.day = g.day::date))
               order by t.breaking desc, t.people desc,
                        case t.severity when 'crash' then 0 when 'error' then 1 else 2 end, t.n desc, t.last_at desc),
               '[]'::jsonb)
                 from top t)
  ) into v_out;
  return v_out;
end;
$$;

-- ── 3. One problem ───────────────────────────────────────────────────────────
create or replace function public.admin_error_group(
  p_fingerprint      text,
  p_days             integer default 30,
  p_exclude_internal boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_days  integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_today date := (now() at time zone 'utc')::date;
  v_out   jsonb;
begin
  perform public._require_admin();
  with internal_users as materialized (
    select iu.user_id from public._internal_user_ids() iu where p_exclude_internal
  ), internal_sessions as materialized (
    select s.session_id from public._internal_session_ids() s where p_exclude_internal
  ), occ as materialized (
    select e.*, coalesce(e.session_id::text, e.user_id::text, e.app_session_id::text) as person
      from public.client_errors e
     where e.fingerprint = p_fingerprint
       and e.received_at > v_since
       and (e.user_id is null or not exists (select 1 from internal_users i where i.user_id = e.user_id))
       and (e.session_id is null or not exists (select 1 from internal_sessions s where s.session_id = e.session_id))
  ), facets as (
    select f.k, f.v, count(*)::integer as n,
           row_number() over (partition by f.k order by count(*) desc, f.v) as rk
      from (select 'op' as k, o.context->>'op' as v from occ o
            union all select 'code', o.context->>'code' from occ o
            union all select 'phase', o.context->>'phase' from occ o
            union all select 'surface', o.context->>'surface' from occ o
            union all select 'route', (o.context->'http'->>'svc') || '/' || (o.context->'http'->>'route') from occ o
            union all select 'status', o.context->'http'->>'status' from occ o
            union all select 'pg', o.context->'http'->>'pg' from occ o) f
     where f.v is not null
     group by f.k, f.v
  )
  select jsonb_build_object(
    'days', v_days,
    'group', (select to_jsonb(g) - 'status_by' - 'sample_stack'
                     || jsonb_build_object('sample_path', public._error_path_template(g.sample_path),
                                           'status_by_email', u.email)
                from public.client_error_groups g
                left join auth.users u on u.id = g.status_by
               where g.fingerprint = p_fingerprint),
    'totals', (select jsonb_build_object('n', count(*), 'people', count(distinct o.person),
                                         'users', count(distinct o.user_id)) from occ o),
    'trend', (select jsonb_agg(jsonb_build_object('day', d.day::date, 'n', coalesce(t.n, 0), 'people', coalesce(t.people, 0))
                               order by d.day)
                from generate_series((v_since at time zone 'utc')::date::timestamp, v_today::timestamp, interval '1 day') d(day)
                left join (select (o.received_at at time zone 'utc')::date as day, count(*)::integer as n,
                                  count(distinct o.person)::integer as people
                             from occ o group by 1) t on t.day = d.day::date),
    'releases', (select coalesce(jsonb_agg(x order by x.last_at desc), '[]'::jsonb)
                   from (select coalesce(o.release, '') as release, count(*)::integer as n,
                                count(distinct o.person)::integer as people,
                                min(o.received_at) as first_at, max(o.received_at) as last_at
                           from occ o group by 1 order by max(o.received_at) desc limit 12) x),
    'browsers', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb)
                   from (select public._ua_family(o.user_agent) as ua, count(*)::integer as n,
                                count(distinct o.person)::integer as people
                           from occ o group by 1 order by count(*) desc limit 10) x),
    'paths', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb)
                from (select coalesce(public._error_path_template(o.path), '') as path, count(*)::integer as n,
                             count(distinct o.person)::integer as people
                        from occ o group by 1 order by count(*) desc limit 10) x),
    'envs', (select coalesce(jsonb_object_agg(x.env, x.n), '{}'::jsonb)
               from (select coalesce(o.env, 'prod') as env, count(*)::integer as n from occ o group by 1) x),
    'context', (select coalesce(jsonb_object_agg(y.k, y.vals), '{}'::jsonb)
                  from (select f.k, jsonb_agg(jsonb_build_object('v', f.v, 'n', f.n) order by f.n desc, f.v) as vals
                          from facets f where f.rk <= 6 group by f.k) y),
    'occurrences', (select coalesce(jsonb_agg(x order by x.at desc), '[]'::jsonb)
                      from (select o.id, o.received_at as at, o.occurred_at, o.kind, o.severity, o.source, o.env,
                                   o.name, o.message, public._error_path_template(o.path) as path, o.release,
                                   public._ua_family(o.user_agent) as ua, o.context, o.breadcrumbs,
                                   left(o.stack, 4000) as stack, left(o.component_stack, 2000) as component_stack,
                                   o.user_id, u.email, o.session_id, o.app_session_id
                              from occ o
                              left join auth.users u on u.id = o.user_id
                             order by o.received_at desc limit 30) x)
  ) into v_out;
  return v_out;
end;
$$;

-- ── 4. What one browser was doing ────────────────────────────────────────────
create or replace function public.admin_error_session_trail(
  p_session_id uuid,
  p_at         timestamptz default null,
  p_minutes    integer     default 15)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_min  integer := least(greatest(coalesce(p_minutes, 15), 1), 240);
  v_at   timestamptz := p_at;
  v_from timestamptz;
  v_to   timestamptz;
  v_user uuid;
  v_out  jsonb;
begin
  perform public._require_admin();
  if p_session_id is null then
    return null;
  end if;
  if v_at is null then
    select max(e.received_at) into v_at from public.client_errors e where e.session_id = p_session_id;
  end if;
  if v_at is null then
    select max(a.occurred_at) into v_at from public.analytics_events a where a.session_id = p_session_id;
  end if;
  if v_at is null then
    return jsonb_build_object('session_id', p_session_id, 'errors', '[]'::jsonb,
                              'events', '[]'::jsonb, 'feedback', '[]'::jsonb);
  end if;
  v_from := v_at - make_interval(mins => v_min);
  v_to   := v_at + make_interval(mins => v_min);
  select coalesce(
           (select e.user_id from public.client_errors e
             where e.session_id = p_session_id and e.user_id is not null
             order by e.received_at desc limit 1),
           (select a.user_id from public.analytics_events a
             where a.session_id = p_session_id and a.user_id is not null
             order by a.occurred_at desc limit 1))
    into v_user;

  select jsonb_build_object(
    'session_id', p_session_id, 'at', v_at, 'from', v_from, 'to', v_to,
    'user', (select jsonb_build_object('user_id', u.id, 'email', u.email) from auth.users u where u.id = v_user),
    'device', (select jsonb_strip_nulls(jsonb_build_object(
                        'browser', a.props->>'browser', 'os', a.props->>'os',
                        'device_type', a.props->>'device_type', 'build', a.props->>'build',
                        'tier', a.props->>'tier'))
                 from public.analytics_events a
                where a.session_id = p_session_id and a.occurred_at <= v_to
                order by a.occurred_at desc limit 1),
    'errors', (select coalesce(jsonb_agg(x order by x.at), '[]'::jsonb)
                 from (select e.id, e.received_at as at, e.kind, e.severity, e.source, e.name, e.message,
                              public._error_path_template(e.path) as path, e.release, e.fingerprint, e.context
                         from public.client_errors e
                        where e.session_id = p_session_id and e.received_at between v_from and v_to
                        order by e.received_at limit 100) x),
    'events', (select coalesce(jsonb_agg(x order by x.at), '[]'::jsonb)
                 from (select a.occurred_at as at, a.event, public._error_path_template(a.path) as path,
                              public._trail_props(a.props) as props
                         from public.analytics_events a
                        where a.session_id = p_session_id and a.occurred_at between v_from and v_to
                        order by a.occurred_at limit 300) x),
    -- Feedback has no session; it is the same person's, inside the same window.
    'feedback', (select coalesce(jsonb_agg(x order by x.at), '[]'::jsonb)
                   from (select f.id, f.created_at as at, f.kind, f.choice, left(f.message, 500) as message
                           from public.feedback f
                          where v_user is not null and f.user_id = v_user
                            and f.created_at between v_from and v_to
                          order by f.created_at limit 20) x)
  ) into v_out;
  return v_out;
end;
$$;

-- ── 5. Resolve, mute, reopen ─────────────────────────────────────────────────
create or replace function public.admin_set_error_group_status(p_fingerprint text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.client_error_groups;
begin
  perform public._require_admin();
  if p_status is null or p_status not in ('open', 'resolved', 'muted') then
    raise exception 'status must be open, resolved or muted' using errcode = '22023';
  end if;
  for i in 1..2 loop
    update public.client_error_groups g
       set status = p_status,
           status_at = now(),
           status_by = auth.uid(),
           -- 0580's refresh reopens a resolved problem when it turns up on a
           -- release outside this list.
           resolved_releases = case when p_status = 'resolved' then
             (select array_agg(distinct e.release) from public.client_errors e
               where e.fingerprint = g.fingerprint and e.release is not null) end,
           returned_at = null,
           updated_at = now()
     where g.fingerprint = p_fingerprint
    returning * into v_row;
    exit when found or i = 2;
    -- Seen in the last few minutes and not folded into a group yet.
    perform public.refresh_error_groups();
  end loop;
  if v_row.fingerprint is null then
    raise exception 'no such problem' using errcode = 'P0002';
  end if;
  -- Reopening a problem a 0133 mute covered lifts that mute too: it would
  -- still keep the problem out of 0581's emails.
  if p_status = 'open' then
    delete from public.client_error_mutes m
     where m.message_key = public._error_message_key(v_row.sample_message);
  end if;
  return to_jsonb(v_row) - 'sample_stack';
end;
$$;

-- ── 6. One person ────────────────────────────────────────────────────────────
create or replace function public.admin_user_errors(p_user_id uuid, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_days  integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_out   jsonb;
begin
  perform public._require_admin();
  if p_user_id is null then
    return null;
  end if;
  -- Their browsers' rows from before they signed in count too.
  with sessions as materialized (
    select e.session_id from public.client_errors e
     where e.user_id = p_user_id and e.session_id is not null and e.received_at > v_since
    union
    select a.session_id from public.analytics_events a
     where a.user_id = p_user_id and a.session_id is not null and a.occurred_at > v_since
  ), mine as materialized (
    select e.id, e.fingerprint, e.kind, e.severity, e.source, e.name, e.message, e.path, e.release, e.env,
           e.received_at, e.session_id, e.context
      from public.client_errors e
     where e.received_at > v_since
       and (e.user_id = p_user_id or e.session_id in (select s.session_id from sessions s))
  )
  select jsonb_build_object(
    'days', v_days,
    'n', (select count(*) from mine),
    'sessions', (select count(distinct m.session_id) from mine m),
    'groups', (select coalesce(jsonb_agg(x order by x.last_at desc), '[]'::jsonb)
                 from (select m.fingerprint, max(m.kind) as kind, min(m.severity) as severity,
                              max(m.source) as source,
                              (array_agg(m.message order by m.received_at desc))[1] as message,
                              count(*)::integer as n, min(m.received_at) as first_at,
                              max(m.received_at) as last_at, coalesce(max(g.status), 'open') as status
                         from mine m
                         left join public.client_error_groups g on g.fingerprint = m.fingerprint
                        group by m.fingerprint
                        order by max(m.received_at) desc limit 50) x),
    'recent', (select coalesce(jsonb_agg(x order by x.at desc), '[]'::jsonb)
                 from (select m.id, m.received_at as at, m.kind, m.severity, m.name, m.message,
                              public._error_path_template(m.path) as path, m.release, m.env, m.session_id,
                              m.fingerprint, m.context
                         from mine m order by m.received_at desc limit 20) x)
  ) into v_out;
  return v_out;
end;
$$;

-- ── 7. Actions that failed without throwing ──────────────────────────────────
create or replace function public.admin_failure_events(p_days integer default 7, p_exclude_internal boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_days  integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_today date := (now() at time zone 'utc')::date;
  v_from  timestamptz;
  v_names text[];
  v_out   jsonb;
begin
  perform public._require_admin();
  v_from := least(v_since, (v_today - 13)::timestamp at time zone 'utc');
  v_names := public._failure_event_names();
  with internal_users as materialized (
    select iu.user_id from public._internal_user_ids() iu where p_exclude_internal
  ), internal_sessions as materialized (
    select s.session_id from public._internal_session_ids() s where p_exclude_internal
  ), ev as materialized (
    select a.event, a.occurred_at, coalesce(a.session_id::text, a.user_id::text) as person,
           left(coalesce(a.props->>'code', a.props->>'reason', a.props->>'error_code', a.props->>'error',
                         a.props->>'status', a.props->>'result', a.props->>'outcome'), 40) as why
      from public.analytics_events a
     where a.event = any(v_names)
       and a.occurred_at > v_from
       and public._event_is_failure(a.event, a.props)
       and (a.user_id is null or not exists (select 1 from internal_users i where i.user_id = a.user_id))
       and (a.session_id is null or not exists (select 1 from internal_sessions s where s.session_id = a.session_id))
  ), win as (
    select * from ev where occurred_at > v_since
  ), agg as (
    select w.event, count(*)::integer as n, count(distinct w.person)::integer as people,
           max(w.occurred_at) as last_at
      from win w group by w.event
  ), daily as (
    select e.event, (e.occurred_at at time zone 'utc')::date as day, count(*)::integer as n
      from ev e
     where e.occurred_at >= (v_today - 13)::timestamp at time zone 'utc'
     group by 1, 2
  ), why as (
    select w.event, w.why, count(*)::integer as n,
           row_number() over (partition by w.event order by count(*) desc, w.why) as rk
      from win w where w.why is not null
     group by 1, 2
  )
  select jsonb_build_object(
    'days', v_days,
    'totals', (select jsonb_build_object('n', count(*), 'people', count(distinct w.person),
                                         'actions', count(distinct w.event)) from win w),
    'actions', (select coalesce(jsonb_agg(jsonb_build_object(
                   'event', a.event, 'n', a.n, 'people', a.people, 'last_at', a.last_at,
                   'reasons', (select coalesce(jsonb_agg(jsonb_build_object('why', y.why, 'n', y.n) order by y.n desc, y.why),
                                               '[]'::jsonb)
                                 from why y where y.event = a.event and y.rk <= 5),
                   'spark', (select jsonb_agg(coalesce(d.n, 0) order by g.day)
                               from generate_series((v_today - 13)::timestamp, v_today::timestamp, interval '1 day') g(day)
                               left join daily d on d.event = a.event and d.day = g.day::date))
                 order by a.people desc, a.n desc, a.event), '[]'::jsonb)
                  from agg a)
  ) into v_out;
  return v_out;
end;
$$;

-- ── 8. Clicks that did nothing, and rage clicks ──────────────────────────────
create or replace function public.admin_click_friction(
  p_days             integer default 7,
  p_exclude_internal boolean default true,
  p_limit            integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_days  integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 200);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_out   jsonb;
begin
  perform public._require_admin();
  with internal_users as materialized (
    select iu.user_id from public._internal_user_ids() iu where p_exclude_internal
  ), internal_sessions as materialized (
    select s.session_id from public._internal_session_ids() s where p_exclude_internal
  ), clicks as materialized (
    select case a.event when 'lp_trace' then 'landing' when 'up_trace' then 'upsell'
                        when 'ps_trace' then 'pricing' else 'app' end as surface,
           x.r->>'k' as k,
           left(coalesce(nullif(x.r->>'tgt', ''), '?'), 60) as tgt,
           coalesce(a.session_id::text, a.user_id::text) as person,
           a.occurred_at
      from public.analytics_events a
     cross join lateral jsonb_array_elements(
             case when jsonb_typeof(a.props->'ev') = 'array' then a.props->'ev' else '[]'::jsonb end) x(r)
     where a.event in ('app_trace', 'lp_trace', 'up_trace', 'ps_trace')
       and a.occurred_at > v_since
       and x.r->>'k' in ('dead', 'rage')
       and (a.user_id is null or not exists (select 1 from internal_users i where i.user_id = a.user_id))
       and (a.session_id is null or not exists (select 1 from internal_sessions s where s.session_id = a.session_id))
  )
  select jsonb_build_object(
    'days', v_days,
    'totals', (select jsonb_build_object('dead', count(*) filter (where c.k = 'dead'),
                                         'rage', count(*) filter (where c.k = 'rage'),
                                         'people', count(distinct c.person)) from clicks c),
    'targets', (select coalesce(jsonb_agg(t order by t.people desc, t.n desc, t.tgt), '[]'::jsonb)
                  from (select c.surface, c.k, c.tgt, count(*)::integer as n,
                               count(distinct c.person)::integer as people, max(c.occurred_at) as last_at
                          from clicks c
                         group by 1, 2, 3
                         order by count(distinct c.person) desc, count(*) desc, c.tgt
                         limit v_limit) t)
  ) into v_out;
  return v_out;
end;
$$;

-- ── 9. Grants (0311): admins call these through PostgREST; _require_admin
-- refuses everyone else inside ───────────────────────────────────────────────
revoke execute on function public.admin_error_groups(integer, text, text, text, text, boolean, integer) from public, anon;
revoke execute on function public.admin_error_group(text, integer, boolean) from public, anon;
revoke execute on function public.admin_error_session_trail(uuid, timestamptz, integer) from public, anon;
revoke execute on function public.admin_set_error_group_status(text, text) from public, anon;
revoke execute on function public.admin_user_errors(uuid, integer) from public, anon;
revoke execute on function public.admin_failure_events(integer, boolean) from public, anon;
revoke execute on function public.admin_click_friction(integer, boolean, integer) from public, anon;
grant execute on function public.admin_error_groups(integer, text, text, text, text, boolean, integer) to authenticated, service_role;
grant execute on function public.admin_error_group(text, integer, boolean) to authenticated, service_role;
grant execute on function public.admin_error_session_trail(uuid, timestamptz, integer) to authenticated, service_role;
grant execute on function public.admin_set_error_group_status(text, text) to authenticated, service_role;
grant execute on function public.admin_user_errors(uuid, integer) to authenticated, service_role;
grant execute on function public.admin_failure_events(integer, boolean) to authenticated, service_role;
grant execute on function public.admin_click_friction(integer, boolean, integer) to authenticated, service_role;

-- ── Proof ────────────────────────────────────────────────────────────────────
do $proof$
declare
  v_fn    text;
  v_admin uuid;
  v_j     jsonb;
begin
  foreach v_fn in array array[
    'public.admin_error_groups(integer, text, text, text, text, boolean, integer)',
    'public.admin_error_group(text, integer, boolean)',
    'public.admin_error_session_trail(uuid, timestamp with time zone, integer)',
    'public.admin_set_error_group_status(text, text)',
    'public.admin_user_errors(uuid, integer)',
    'public.admin_failure_events(integer, boolean)',
    'public.admin_click_friction(integer, boolean, integer)'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0582: % is executable by anon', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0582: % is not executable by authenticated', v_fn;
    end if;
  end loop;
  foreach v_fn in array array[
    'public._ua_family(text)',
    'public._error_path_template(text)',
    'public._error_lens_ok(text, text, text, text, text, text)',
    'public._outcome_events()',
    'public._event_is_failure(text, jsonb)',
    'public._failure_event_names()',
    'public._trail_props(jsonb)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0582: % is executable outside the owner', v_fn;
    end if;
  end loop;

  -- No admin, no answer.
  begin
    perform public.admin_error_groups();
    raise exception '0582: admin_error_groups answered without an admin';
  exception when insufficient_privilege then
    null;
  end;

  if public._ua_family('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1') <> 'Safari · iOS'
     or public._ua_family('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36') <> 'Chrome · Mac'
     or public._ua_family('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0') <> 'Edge · Windows'
     or public._ua_family('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0') <> 'In-app · iOS'
     or public._ua_family(null) <> 'Unknown' then
    raise exception '0582: _ua_family misreads a browser';
  end if;
  if public._error_path_template('/share/:token?ref=x#top') <> '/share/:token'
     or public._error_path_template('/b/0f8fad5b-d9cb-469f-a165-70867728950e/12') <> '/b/:id/:n'
     or public._error_path_template(null) is not null then
    raise exception '0582: _error_path_template misreads a path';
  end if;
  if not public._event_is_failure('otp_verify_error', '{}')
     or not public._event_is_failure('card_create_stuck', null)
     or not public._event_is_failure('files_move', '{"outcome":"failed"}')
     or not public._event_is_failure('web_image_save', '{"ok":false}')
     or not public._event_is_failure('folder_import', '{"failed":2}')
     or public._event_is_failure('files_move', '{"outcome":"moved"}')
     or public._event_is_failure('invite_link_claim_result', '{"status":"joined"}')
     or public._event_is_failure('folder_import', '{"failed":0}')
     or public._event_is_failure('home_view', '{"ok":false}')
     or public._event_is_failure(null, null) then
    raise exception '0582: _event_is_failure misreads an event';
  end if;
  if public._error_lens_ok('problems', 'csp_violation', 'worker', 'warning', 'x', null)
     or not public._error_lens_ok('monitors', 'csp_violation', 'worker', 'warning', 'x', null)
     or public._error_lens_ok('problems', 'window', 'client', 'error', 'x', 'Mozilla/5.0 (compatible; Googlebot/2.1)')
     or not public._error_lens_ok('stuck', 'http', 'client', 'warning', 'GET rest/boards: slow', null)
     or public._error_lens_ok('stuck', 'http', 'client', 'error', 'GET rest/boards: server error', null)
     or not public._error_lens_ok('servers', 'cron', 'db', 'error', 'x', null)
     or public._error_lens_ok('servers', 'window', 'client', 'error', 'x', null)
     or not public._error_lens_ok('crashes', 'render', 'client', 'crash', 'x', null) then
    raise exception '0582: _error_lens_ok misreads a lens';
  end if;
  if public._trail_props('{"ok":false,"lt_utm_source":"x","browser":"Chrome","code":"c"}') <> '{"ok":false,"code":"c"}'::jsonb then
    raise exception '0582: _trail_props keeps attribution';
  end if;

  -- Every read runs, as an admin, for this block only.
  select p.user_id into v_admin from public.profiles p where p.tier = 'admin' order by p.user_id limit 1;
  if v_admin is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    v_j := public.admin_error_groups(7, 'all', 'all', 'all');
    if jsonb_typeof(v_j->'groups') <> 'array' or jsonb_typeof(v_j->'breaking') <> 'array' then
      raise exception '0582: admin_error_groups is missing its groups or breaking';
    end if;
    perform public.admin_error_groups(30, 'problems', 'open', 'prod');
    v_j := public.admin_error_group(coalesce((select g.fingerprint from public.client_error_groups g
                                               order by g.last_seen desc limit 1), 'none'));
    if jsonb_typeof(v_j->'occurrences') <> 'array' then
      raise exception '0582: admin_error_group is missing its occurrences';
    end if;
    perform public.admin_error_session_trail((select e.session_id from public.client_errors e
                                               where e.session_id is not null order by e.received_at desc limit 1));
    perform public.admin_user_errors(v_admin);
    v_j := public.admin_failure_events(14);
    if jsonb_typeof(v_j->'actions') <> 'array' then
      raise exception '0582: admin_failure_events is missing its actions';
    end if;
    v_j := public.admin_click_friction(14);
    if jsonb_typeof(v_j->'targets') <> 'array' then
      raise exception '0582: admin_click_friction is missing its targets';
    end if;
    perform set_config('request.jwt.claims', '', true);
  end if;
end $proof$;
