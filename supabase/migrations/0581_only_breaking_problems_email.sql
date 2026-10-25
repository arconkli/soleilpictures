-- 0581_only_breaking_problems_email.sql
--
-- STATUS: applied 2026-10-24 through the MCP in six records,
-- only_breaking_problems_email_part1 … part6 (the proof is the sixth). Every
-- function body live is this file's, byte for byte.
--
-- The owner decided on 2026-10-24 that nothing about errors is emailed as a
-- routine. Every problem waits in the admin Errors tab, and an email goes out
-- right away only when something is super breaking:
--
--   wont_open   the app would not open (the crash screen, or a load stuck on
--               its splash) for 3 or more people in 30 minutes;
--   saves       board saves failed for 3 or more people in 30 minutes;
--   sign_in     sign-in failed on our side (a 5xx, or no answer while the
--               browser was online) for 3 or more people in 30 minutes;
--   payments    checkout, its verification, the Stripe webhook, the storage
--               add-on or Team billing failed 2 or more times in an hour;
--   widespread  any other one problem, a crash or an error, reached 5 or more
--               people in an hour.
--
-- A problem emails at most once every 6 hours, and these emails stop at 6 in
-- any 24 hours. Past the sixth, a breaking problem is still written to
-- ops_alerts, just not paged. A pass that finds several sends one email that
-- lists them all.
--
-- Never counted:
--   - CSP reports, perf incidents and the SEO and discovery probes, which have
--     their own channels;
--   - preview and dev;
--   - internal accounts (_internal_user_ids()), and any browser that has been
--     signed in as one;
--   - crawlers;
--   - rows sent while the browser was offline;
--   - muted problems.
--
-- A person is a browser: the session id that analytics shares, else the
-- account, else the app session.
--
-- Also here:
--   - check_server_health() turns server failures into rows: a pg_cron run that
--     failed or is still going 30 minutes in, and a pg_net call that failed
--     (source 'db', kind 'cron' or 'pg_net'). It writes one row per job and
--     failure per pass, so a job failing every minute is one row every five,
--     with its count. pg_net keeps no URL, so a failed call is named by what
--     went wrong.
--   - error_watch(), every 5 minutes, runs the server check, the group refresh
--     and the breaking check, each in its own block. A step that throws is
--     written down; a failing breaking check is also emailed, once a day,
--     since otherwise it would silently stop every email above.
--
-- check_breaking(true) is a dry run: it returns what the pass would email and
-- writes nothing.

-- ── 1. Helpers ───────────────────────────────────────────────────────────────

-- A crawler, as lib/errorNoise.js's isBotUA tells one, plus headless browsers
-- and Lighthouse, which run pages without a person.
create or replace function public._error_is_bot_ua(p_ua text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(p_ua, '') ~* '(bot|crawl|spider|slurp|bingpreview|applebot|duckduckbot|yandex|baiduspider|facebookexternalhit|googlebot|headless|lighthouse)'
$$;
revoke all on function public._error_is_bot_ua(text) from public, anon, authenticated;

-- A server's own message, before it is stored: no addresses, no credentials,
-- one line, 300 characters.
create or replace function public._error_scrub_server(p text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select left(regexp_replace(regexp_replace(
           split_part(coalesce(p, ''), E'\n', 1),
           '[^\s@<>()"'']+@[^\s@<>()"'']+', '<email>', 'g'),
           '(bearer\s+|token=|key=|secret=|apikey=)[^\s&;,"'']+', '\1<redacted>', 'gi'), 300)
$$;
revoke all on function public._error_scrub_server(text) from public, anon, authenticated;

-- ── 2. What is breaking at p_at ──────────────────────────────────────────────
-- One row per breaking problem, by the owner's rules. Pure reading, so a
-- question like "how often would this have emailed last week" is a loop over
-- p_at. p_skip_sessions are browsers that were signed in as internal accounts;
-- check_breaking looks for them only when a pass finds something.
create or replace function public._breaking_candidates(p_at timestamptz, p_skip_sessions uuid[] default null)
returns table (rule text, problem text, people integer, occurrences integer,
               first_at timestamptz, last_at timestamptz, what text, releases text, paths text)
language sql
stable
set search_path to 'public'
as $$
  with base as (
    select e.received_at, e.fingerprint, e.kind, e.severity, e.message, e.release, e.context,
           regexp_replace(e.path, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', ':id', 'gi') as path,
           coalesce(e.session_id::text, e.user_id::text, e.app_session_id::text) as person,
           e.context->'http'->>'route' as route,
           (e.context->'http'->>'status')::integer as status,
           case
             when e.kind = 'render' or (e.kind = 'stuck' and e.context->>'op' = 'boot') then 'wont_open'
             when e.kind = 'save' then 'saves'
             when e.kind = 'http' and e.context->'http'->>'svc' = 'auth'
                  and ((e.context->'http'->>'status')::integer >= 500
                       or (e.context->'http'->>'status')::integer = 0) then 'sign_in'
             when (e.kind = 'http' and e.severity = 'error' and e.context->'http'->>'svc' = 'functions'
                   and e.context->'http'->>'route' in ('create-checkout-session', 'verify-checkout-session',
                                                        'storage-addon', 'team-billing'))
               or (e.source = 'edge' and e.severity in ('crash', 'error')
                   and e.kind in ('create-checkout-session', 'verify-checkout-session', 'stripe-webhook',
                                  'storage-addon', 'team-billing')) then 'payments'
           end as bucket
      from public.client_errors e
     where e.received_at > p_at - interval '1 hour' and e.received_at <= p_at
       and coalesce(e.env, 'prod') = 'prod'
       and coalesce(e.kind, '') not in ('csp_violation', 'perf', 'seo_health', 'discovery_pipeline', 'aeo_probe')
       and coalesce(e.context->>'online', '') <> 'false'
       and not public._error_is_bot_ua(e.user_agent)
       and not exists (select 1 from public._internal_user_ids() i where i.user_id = e.user_id)
       and (e.session_id is null or not (e.session_id = any(coalesce(p_skip_sessions, '{}'))))
       and not exists (select 1 from public.client_error_groups g
                        where g.fingerprint = e.fingerprint and g.status = 'muted')
       and not exists (select 1 from public.client_error_mutes m
                        where m.message_key = public._error_message_key(e.message))
  )
  select 'wont_open'::text, 'the app'::text, count(distinct b.person)::integer, count(*)::integer,
         min(b.received_at), max(b.received_at),
         concat_ws('; ',
           'crash screen x' || nullif(count(*) filter (where b.kind = 'render'), 0),
           'stuck loading x' || nullif(count(*) filter (where b.kind = 'stuck'), 0)
             || ' (after ' || string_agg(distinct coalesce(b.context->>'phase', 'start'), ', ')
                                filter (where b.kind = 'stuck') || ')',
           nullif(public._error_group_key((array_agg(b.message order by b.received_at desc)
                                             filter (where b.kind = 'render'))[1]), '')),
         array_to_string((array_agg(distinct b.release) filter (where b.release is not null))[1:5], ', '),
         array_to_string((array_agg(distinct b.path) filter (where b.path is not null))[1:5], ', ')
    from base b
   where b.bucket = 'wont_open' and b.received_at > p_at - interval '30 minutes'
  having count(distinct b.person) >= 3
  union all
  -- A server's save (the Party's flush) has no person, so its board stands in.
  select 'saves', 'board saves', count(distinct coalesce(b.person, 'board:' || (b.context->>'board_id')))::integer,
         count(*)::integer, min(b.received_at), max(b.received_at),
         concat_ws('; ',
           string_agg(distinct coalesce(b.context->>'op', b.kind), ', '),
           'codes ' || string_agg(distinct b.context->>'code', ', '),
           nullif(public._error_group_key((array_agg(b.message order by b.received_at desc))[1]), '')),
         array_to_string((array_agg(distinct b.release) filter (where b.release is not null))[1:5], ', '),
         array_to_string((array_agg(distinct b.path) filter (where b.path is not null))[1:5], ', ')
    from base b
   where b.bucket = 'saves' and b.received_at > p_at - interval '30 minutes'
  having count(distinct coalesce(b.person, 'board:' || (b.context->>'board_id'))) >= 3
  union all
  select 'sign_in', 'sign-in', count(distinct b.person)::integer, count(*)::integer,
         min(b.received_at), max(b.received_at),
         string_agg(distinct 'auth/' || coalesce(b.route, '?') || ' '
                    || case when b.status = 0 then 'no answer' else b.status::text end, ', '),
         array_to_string((array_agg(distinct b.release) filter (where b.release is not null))[1:5], ', '),
         array_to_string((array_agg(distinct b.path) filter (where b.path is not null))[1:5], ', ')
    from base b
   where b.bucket = 'sign_in' and b.received_at > p_at - interval '30 minutes'
  having count(distinct b.person) >= 3
  union all
  select 'payments', 'payments', count(distinct b.person)::integer, count(*)::integer,
         min(b.received_at), max(b.received_at),
         string_agg(distinct coalesce(b.route, b.kind) || ' '
                    || coalesce(case when b.status = 0 then 'no answer' else b.status::text end, b.severity), ', '),
         array_to_string((array_agg(distinct b.release) filter (where b.release is not null))[1:5], ', '),
         array_to_string((array_agg(distinct b.path) filter (where b.path is not null))[1:5], ', ')
    from base b
   where b.bucket = 'payments'
  having count(*) >= 2
  union all
  select 'widespread', b.fingerprint, count(distinct b.person)::integer, count(*)::integer,
         min(b.received_at), max(b.received_at),
         max(b.kind) || ': ' || public._error_group_key((array_agg(b.message order by b.received_at desc))[1]),
         array_to_string((array_agg(distinct b.release) filter (where b.release is not null))[1:5], ', '),
         array_to_string((array_agg(distinct b.path) filter (where b.path is not null))[1:5], ', ')
    from base b
   where b.bucket is null and b.severity in ('crash', 'error') and b.fingerprint is not null
   group by b.fingerprint
  having count(distinct b.person) >= 5
$$;
revoke all on function public._breaking_candidates(timestamptz, uuid[]) from public, anon, authenticated;

-- ── 3. The breaking check ────────────────────────────────────────────────────
create or replace function public.check_breaking(p_dry_run boolean default true)
returns table (rule text, problem text, people integer, occurrences integer, title text, outcome text)
language plpgsql
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  -- The owner's caps (2026-10-24).
  c_per_problem constant interval := interval '6 hours';
  c_per_day     constant integer  := 6;
  c_kind        constant text     := 'something_is_breaking';
  v_at     timestamptz := now();
  v_skip   uuid[];
  v_sent   integer;
  v_page   boolean;
  v_id     bigint;
  v_key    text;
  v_title  text;
  v_items  jsonb := '[]'::jsonb;
  v_body   text := '';
  v_item   jsonb;
  c        record;
begin
  if not p_dry_run and not pg_try_advisory_xact_lock(hashtext('check_breaking')) then
    return;
  end if;
  -- Almost every pass finds nothing, and only one that finds something looks
  -- for browsers that were signed in as an internal account.
  if not exists (select 1 from public._breaking_candidates(v_at, null)) then
    return;
  end if;
  select coalesce(array_agg(s.session_id), '{}') into v_skip
    from (select distinct e.session_id
            from public.client_errors e
           where e.received_at > v_at - interval '1 hour' and e.received_at <= v_at
             and e.session_id is not null) s
   where exists (select 1 from public.client_errors x
                  where x.session_id = s.session_id
                    and x.user_id in (select i.user_id from public._internal_user_ids() i))
      or exists (select 1 from public.analytics_events a
                  where a.session_id = s.session_id
                    and a.user_id in (select i.user_id from public._internal_user_ids() i));

  select count(*) into v_sent
    from public.ops_alerts a
   where a.kind = c_kind and a.page and a.created_at > v_at - interval '24 hours';
  v_page := v_sent < c_per_day;

  for c in
    select k.* from public._breaking_candidates(v_at, v_skip) k
     order by array_position(array['wont_open', 'saves', 'sign_in', 'payments', 'widespread'], k.rule),
              k.people desc
  loop
    v_key := 'breaking:' || c.rule || ':' || c.problem;
    v_title := case c.rule
      when 'wont_open' then 'The app is not opening for ' || c.people || ' people'
      when 'saves'     then 'Board saves are failing for ' || c.people || ' people'
      when 'sign_in'   then 'Sign-in is failing on our side for ' || c.people || ' people'
      when 'payments'  then 'Payments failed ' || c.occurrences || ' times in the last hour'
      else 'One problem reached ' || c.people || ' people in the last hour' end;
    rule := c.rule; problem := c.problem; people := c.people; occurrences := c.occurrences; title := v_title;
    if exists (select 1 from public.ops_alerts a
                where a.dedupe_key = v_key and a.created_at > v_at - c_per_problem) then
      outcome := 'emailed in the last 6 hours';
      return next;
      continue;
    end if;
    v_body := v_body || v_title || E'\n'
      || '  What: ' || coalesce(nullif(c.what, ''), c.rule) || E'\n'
      || '  Seen ' || c.occurrences || ' times, '
      || to_char(c.first_at at time zone 'America/New_York', 'HH24:MI') || ' to '
      || to_char(c.last_at at time zone 'America/New_York', 'HH24:MI') || ' ET' || E'\n'
      || coalesce('  Builds: ' || nullif(c.releases, '') || E'\n', '')
      || coalesce('  Where: ' || nullif(c.paths, '') || E'\n', '')
      || case when c.rule = 'widespread' then '  Problem ' || left(c.problem, 12) || E'\n' else '' end
      || E'\n';
    v_items := v_items || jsonb_build_object('key', v_key, 'title', v_title);
    outcome := case when p_dry_run then (case when v_page then 'would email' else 'would record: 6 emails today' end)
                    else (case when v_page then 'emailed' else 'recorded: 6 emails today' end) end;
    return next;
  end loop;

  if p_dry_run or jsonb_array_length(v_items) = 0 then
    return;
  end if;
  v_body := v_body
    || 'Everything else waits in Admin, Errors.' || E'\n'
    || 'Each problem emails at most once every 6 hours, and these emails stop at 6 a day ('
    || (v_sent + case when v_page then 1 else 0 end) || ' of 6 in the last 24 hours).';
  v_id := public.ops_alert_raise(c_kind,
            (v_items->0->>'title') || case when jsonb_array_length(v_items) > 1
                                           then ' (and ' || (jsonb_array_length(v_items) - 1) || ' more)' else '' end,
            v_body, v_page, v_items->0->>'key', c_per_problem, null);
  -- The others ride in the same email; a quiet row each keeps them to one
  -- email per 6 hours too.
  for v_item in select x from jsonb_array_elements(v_items) with ordinality t(x, n) where t.n > 1 loop
    perform public.ops_alert_raise(c_kind, v_item->>'title', 'Sent in alert #' || coalesce(v_id::text, '?') || '.',
              false, v_item->>'key', c_per_problem, null);
  end loop;
end;
$$;
revoke all on function public.check_breaking(boolean) from public, anon, authenticated;
grant execute on function public.check_breaking(boolean) to service_role;

-- ── 4. Server health ─────────────────────────────────────────────────────────
create or replace function public.check_server_health()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_state    jsonb;
  -- A run's status and end land together; ten seconds lets them commit.
  v_to       timestamptz := now() - interval '10 seconds';
  -- pg_net stamps a response with its batch's start and writes it when the
  -- batch is done, so its window trails by more than any call's timeout.
  v_net_to   timestamptz := now() - interval '3 minutes';
  v_from     timestamptz;
  v_net_from timestamptz;
  v_n        integer := 0;
  v_k        integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('check_server_health')) then
    return 0;
  end if;
  select value into v_state from public.app_config where key = 'server_health_watermark';
  -- The first pass reads the last hour, not all of history.
  v_from     := coalesce((v_state->>'cron_at')::timestamptz, v_to - interval '1 hour');
  v_net_from := coalesce((v_state->>'net_at')::timestamptz, v_net_to - interval '1 hour');

  -- (a) Runs that failed.
  insert into public.client_errors (source, kind, severity, name, message, context, env, occurred_at)
  select 'db', 'cron', 'error', 'CronFailure', 'cron ' || f.job || ' failed: ' || f.why,
         jsonb_build_object('op', f.job, 'attempt', f.n, 'ms', f.ms), 'prod', f.at
    from (select coalesce(j.jobname, 'job ' || d.jobid) as job,
                 public._error_scrub_server(d.return_message) as why,
                 count(*)::integer as n,
                 max(extract(epoch from (coalesce(d.end_time, d.start_time) - d.start_time)) * 1000)::integer as ms,
                 max(coalesce(d.end_time, d.start_time)) as at
            from cron.job_run_details d
            left join cron.job j on j.jobid = d.jobid
           where d.status = 'failed'
             and coalesce(d.end_time, d.start_time) > v_from
             and coalesce(d.end_time, d.start_time) <= v_to
           group by 1, 2) f;
  get diagnostics v_k = row_count;
  v_n := v_n + v_k;

  -- (b) Runs still going 30 minutes in. Each is seen by the one pass whose
  -- window its thirtieth minute falls in.
  insert into public.client_errors (source, kind, severity, name, message, context, env, occurred_at)
  select 'db', 'cron', 'warning', 'CronStuck', 'cron ' || f.job || ' still running after 30 minutes',
         jsonb_build_object('op', f.job, 'attempt', f.n), 'prod', f.at
    from (select coalesce(j.jobname, 'job ' || d.jobid) as job, count(*)::integer as n,
                 max(d.start_time) as at
            from cron.job_run_details d
            left join cron.job j on j.jobid = d.jobid
           where d.status in ('starting', 'running')
             and d.start_time + interval '30 minutes' > v_from
             and d.start_time + interval '30 minutes' <= v_to
           group by 1) f;
  get diagnostics v_k = row_count;
  v_n := v_n + v_k;

  -- (c) Calls that failed. A timeout is a warning: our functions often carry
  -- on after pg_net stops waiting.
  insert into public.client_errors (source, kind, severity, name, message, context, env, occurred_at)
  select 'db', 'pg_net', case when f.timed_out then 'warning' else 'error' end, 'PgNetFailure',
         'pg_net call ' || f.what,
         jsonb_build_object('op', 'pg_net', 'attempt', f.n, 'http', jsonb_build_object('status', f.status)),
         'prod', f.at
    from (select coalesce(r.timed_out, false) as timed_out, r.status_code as status,
                 case when r.timed_out then 'timed out'
                      when r.error_msg is not null then 'failed: ' || public._error_scrub_server(left(r.error_msg, 200))
                      else 'answered ' || r.status_code end as what,
                 count(*)::integer as n, max(r.created) as at
            from net._http_response r
           where r.created > v_net_from and r.created <= v_net_to
             and (r.timed_out or r.error_msg is not null or r.status_code >= 400)
           group by 1, 2, 3) f;
  get diagnostics v_k = row_count;
  v_n := v_n + v_k;

  insert into public.app_config (key, value, updated_at)
  values ('server_health_watermark', jsonb_build_object('cron_at', v_to, 'net_at', v_net_to), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_n;
end;
$$;
revoke all on function public.check_server_health() from public, anon, authenticated;
grant execute on function public.check_server_health() to service_role;

-- ── 5. The 5-minute job ──────────────────────────────────────────────────────
create or replace function public._error_watch_step_failed(p_step text, p_state text, p_message text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  begin
    insert into public.client_errors (source, kind, severity, name, message, context, env)
    values ('db', 'error_watch', 'error', 'ErrorWatchFailure',
            p_step || ' failed: ' || public._error_scrub_server(p_message) || ' (' || coalesce(p_state, '?') || ')',
            jsonb_build_object('op', p_step, 'code', p_state), 'prod');
  exception when others then
    null;  -- quiet: the table itself may be what is failing; the alert below still goes
  end;
  if p_step = 'check_breaking' then
    perform public.ops_alert_raise('error_watch_is_failing', 'The breaking-problem check is failing',
      'check_breaking() threw: ' || public._error_scrub_server(p_message) || ' (' || coalesce(p_state, '?') || ').'
        || E'\n' || 'Until it is fixed, no email goes out when something breaks. Admin, Errors still collects.',
      true, 'error_watch:check_breaking', interval '1 day', null);
  end if;
end;
$$;
revoke all on function public._error_watch_step_failed(text, text, text) from public, anon, authenticated;

create or replace function public.error_watch()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  begin
    perform public.check_server_health();
  exception when others then
    perform public._error_watch_step_failed('check_server_health', sqlstate, sqlerrm);
  end;
  begin
    perform public.refresh_error_groups();
  exception when others then
    perform public._error_watch_step_failed('refresh_error_groups', sqlstate, sqlerrm);
  end;
  begin
    perform public.check_breaking(false);
  exception when others then
    perform public._error_watch_step_failed('check_breaking', sqlstate, sqlerrm);
  end;
end;
$$;
revoke all on function public.error_watch() from public, anon, authenticated;
grant execute on function public.error_watch() to service_role;

-- ── Proof ────────────────────────────────────────────────────────────────────
do $proof$
declare
  v_fn       text;
  v_word     text := translate(md5(random()::text), '0123456789', 'ghijklmnop');
  v_internal uuid := (select i.user_id from public._internal_user_ids() i limit 1);
  v_fp       text;
  v_people   integer;
  v_outcome  text;
  v_alerts   integer;
  v_before   bigint := (select coalesce(max(id), 0) from public.ops_alerts);
begin
  -- The 0311 habit: effective privileges, PUBLIC included.
  foreach v_fn in array array[
    'public._error_is_bot_ua(text)', 'public._error_scrub_server(text)',
    'public._breaking_candidates(timestamptz,uuid[])', 'public.check_breaking(boolean)',
    'public.check_server_health()', 'public._error_watch_step_failed(text,text,text)',
    'public.error_watch()'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0581: a client role can run %', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['public.check_breaking(boolean)', 'public.check_server_health()',
                              'public.error_watch()'] loop
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0581: service_role cannot run %', v_fn;
    end if;
  end loop;

  if not public._error_is_bot_ua('Mozilla/5.0 (compatible; Googlebot/2.1)')
     or public._error_is_bot_ua('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15') then
    raise exception '0581: the crawler test is wrong';
  end if;
  if public._error_scrub_server('send to a.b@c.de failed with Bearer abc.def; key=xyz')
     <> 'send to <email> failed with Bearer <redacted>; key=<redacted>' then
    raise exception '0581: the server scrub kept %', public._error_scrub_server('send to a.b@c.de failed with Bearer abc.def; key=xyz');
  end if;

  -- The rules, on probe rows rolled back with their block: one problem from
  -- five browsers is breaking, and stops being so when one of them is an
  -- internal account, sent offline, a crawler, from preview, or muted.
  begin
    insert into public.client_errors (session_id, kind, severity, message, env, context, user_agent)
    select gen_random_uuid(), 'window', 'error', '0581 probe ' || v_word, 'prod', '{"online":true}', 'Mozilla/5.0 Safari'
      from generate_series(1, 5);
    select fingerprint into v_fp from public.client_errors where message = '0581 probe ' || v_word limit 1;
    select c.people into v_people from public._breaking_candidates(now(), null) c
     where c.rule = 'widespread' and c.problem = v_fp;
    if v_people is distinct from 5 then
      raise exception '0581: five browsers made % people', coalesce(v_people::text, 'no candidate');
    end if;

    select c.outcome into v_outcome from public.check_breaking(true) c where c.problem = v_fp;
    if v_outcome is distinct from 'would email' and v_outcome is distinct from 'would record: 6 emails today' then
      raise exception '0581: the dry run said %', coalesce(v_outcome, 'nothing');
    end if;
    if exists (select 1 from public.ops_alerts where id > v_before and dedupe_key = 'breaking:widespread:' || v_fp) then
      raise exception '0581: the dry run wrote an alert';
    end if;

    perform public.check_breaking(false);
    select count(*) into v_alerts from public.ops_alerts
     where id > v_before and dedupe_key = 'breaking:widespread:' || v_fp;
    if v_alerts <> 1 then
      raise exception '0581: a breaking problem raised % alerts', v_alerts;
    end if;
    perform public.check_breaking(false);
    select count(*) into v_alerts from public.ops_alerts
     where id > v_before and dedupe_key = 'breaking:widespread:' || v_fp;
    if v_alerts <> 1 then
      raise exception '0581: a second pass emailed the same problem again';
    end if;

    if v_internal is not null then
      update public.client_errors set user_id = v_internal
       where id = (select id from public.client_errors where message = '0581 probe ' || v_word limit 1);
      if exists (select 1 from public._breaking_candidates(now(), null) c where c.problem = v_fp) then
        raise exception '0581: an internal account counted';
      end if;
      update public.client_errors set user_id = null where message = '0581 probe ' || v_word;
    end if;
    update public.client_errors set context = '{"online":false}'
     where id = (select id from public.client_errors where message = '0581 probe ' || v_word limit 1);
    if exists (select 1 from public._breaking_candidates(now(), null) c where c.problem = v_fp) then
      raise exception '0581: a row sent offline counted';
    end if;
    update public.client_errors set context = '{"online":true}', user_agent = 'Googlebot'
     where id = (select id from public.client_errors where message = '0581 probe ' || v_word limit 1);
    if exists (select 1 from public._breaking_candidates(now(), null) c where c.problem = v_fp) then
      raise exception '0581: a crawler counted';
    end if;
    update public.client_errors set user_agent = 'Mozilla/5.0 Safari', env = 'preview'
     where id = (select id from public.client_errors where message = '0581 probe ' || v_word limit 1);
    if exists (select 1 from public._breaking_candidates(now(), null) c where c.problem = v_fp) then
      raise exception '0581: a preview row counted';
    end if;
    update public.client_errors set env = 'prod' where message = '0581 probe ' || v_word;
    insert into public.client_error_groups (fingerprint, source, kind, first_seen, last_seen, status)
    values (v_fp, 'client', 'window', now(), now(), 'muted')
    on conflict (fingerprint) do update set status = 'muted';
    if exists (select 1 from public._breaking_candidates(now(), null) c where c.problem = v_fp) then
      raise exception '0581: a muted problem counted';
    end if;

    -- The other four rules each fire on their own shape.
    insert into public.client_errors (session_id, kind, severity, message, env, context)
    select gen_random_uuid(), 'render', 'crash', '0581 probe crash ' || v_word, 'prod', null::jsonb
      from generate_series(1, 3)
    union all
    select gen_random_uuid(), 'save', 'error', '0581 probe save ' || v_word, 'prod', '{"op":"board_snapshot"}'::jsonb
      from generate_series(1, 3)
    union all
    select gen_random_uuid(), 'http', 'error', 'POST auth/token/password: server error', 'prod',
           '{"online":true,"http":{"svc":"auth","route":"token/password","status":503}}'::jsonb
      from generate_series(1, 3)
    union all
    select gen_random_uuid(), 'http', 'error', 'POST functions/create-checkout-session: server error', 'prod',
           '{"online":true,"http":{"svc":"functions","route":"create-checkout-session","status":500}}'::jsonb
      from generate_series(1, 2);
    if (select count(distinct c.rule) from public._breaking_candidates(now(), null) c
         where c.rule in ('wont_open', 'saves', 'sign_in', 'payments')) <> 4 then
      raise exception '0581: the four dedicated rules did not all fire on their probes';
    end if;

    -- The server check runs.
    perform public.check_server_health();
    raise exception using errcode = 'P0001', message = '0581-probe-rollback';
  exception when sqlstate 'P0001' then
    if sqlerrm <> '0581-probe-rollback' then
      raise;
    end if;
  end;
  if exists (select 1 from public.client_errors where message like '0581 probe%' || v_word)
     or exists (select 1 from public.ops_alerts where id > v_before and dedupe_key = 'breaking:widespread:' || v_fp) then
    raise exception '0581: a probe was left behind';
  end if;
end $proof$;
