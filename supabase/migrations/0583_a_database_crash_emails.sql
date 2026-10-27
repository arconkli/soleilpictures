-- 0583_a_database_crash_emails.sql
--
-- STATUS: applied 2026-10-27 through the MCP in four records,
-- a_database_crash_emails_part1 … part4 (the proof is the fourth). Every
-- function body live is this file's, byte for byte.
--
-- Two things 0581's first days in production showed.
--
-- The database crashed (it ran out of memory) and restarted, more than once in
-- a day, and nothing emailed. While it is down nobody's request lands, so the
-- rules that count people never reach their 3 or 5: each restart left only a
-- few people's failures on record. Now error_watch writes every start of
-- Postgres down as a row of its own (source db, kind db_restart), and a
-- crash's emails at once, as a sixth rule:
--
--   db_down     the database restarted after a crash in the last hour.
--
-- It keeps the same caps as the others (one email per 6 hours, 6 a day), and
-- its email says how many crashes the last 24 hours held and how long the
-- database was down. A clean restart (maintenance, a resize) is a warning row
-- and never emails.
--
-- And "the app is not opening" emailed for automated renderers. They run a
-- page with its timers fast-forwarded, so the 45-second splash watchdog
-- (BOOT_STUCK_MS in lib/errorReporting.js) went off after a few seconds of the
-- page's own clock. A person's browser only ever fires a timer late, so a boot
-- row whose clock reads under 45 seconds is never counted. The browser stops
-- sending them too (lib/errorSender.js), but builds already out keep on.
--
-- Every other line of the three functions restated here is 0581's.

-- ── 1. A start of the database is written down ──────────────────────────────
-- Once a start, by the first error_watch pass after it. Postgres keeps its
-- statistics only through a clean shutdown: after a crash it throws them away
-- and stamps the reset with the start. So a reset no older than the start is a
-- crash's (severity crash); any other start is a warning. context.ms is how
-- long before the start pg_cron last finished a job: about how long the
-- database was down.
create or replace function public._note_db_restart()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_start timestamptz := pg_postmaster_start_time();
  v_seen  timestamptz;
  v_crash boolean;
  v_last  timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtext('note_db_restart')) then
    return 0;
  end if;
  select (c.value->>'started_at')::timestamptz into v_seen
    from public.app_config c where c.key = 'db_restart_watermark';
  if v_seen >= v_start then
    return 0;
  end if;
  select coalesce(w.stats_reset >= v_start, false) into v_crash from pg_stat_wal w;
  select max(d.end_time) into v_last
    from cron.job_run_details d
   where d.status = 'succeeded' and d.end_time < v_start and d.end_time > v_start - interval '1 day';
  insert into public.client_errors (source, kind, severity, name, message, context, env, occurred_at)
  values ('db', 'db_restart', case when v_crash then 'crash' else 'warning' end, 'DbRestart',
          case when v_crash then 'Database restarted after a crash' else 'Database restarted' end,
          jsonb_build_object('op', 'postgres', 'ms', (extract(epoch from (v_start - v_last)) * 1000)::bigint),
          'prod', v_start);
  insert into public.app_config (key, value, updated_at)
  values ('db_restart_watermark', jsonb_build_object('started_at', v_start), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return 1;
end;
$$;
revoke all on function public._note_db_restart() from public, anon, authenticated;

-- ── 2. The 5-minute job notes a start first ─────────────────────────────────
-- So the row is there for the same pass's group refresh and breaking check.
create or replace function public.error_watch()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  begin
    perform public._note_db_restart();
  exception when others then
    perform public._error_watch_step_failed('note_db_restart', sqlstate, sqlerrm);
  end;
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

-- ── 3. What is breaking at p_at: renderers never count, and db_down ─────────
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
       -- A 45-second splash watchdog its own page's clock says went off early:
       -- a renderer fast-forwarding timers, never a person (0583).
       and not (e.kind = 'stuck' and e.message like 'Boot stuck after %'
                and coalesce((e.context->>'ms')::numeric, 45000) < 45000)
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
  union all
  -- The database went down (0583): a start after a crash, which error_watch
  -- notes as it comes back. Nobody's failure lands while it is down, so no
  -- count of people sees it; one in the last hour is enough, and the email
  -- counts the day's.
  select 'db_down', 'the database', 0, count(*)::integer, min(d.occurred_at), max(d.occurred_at),
         'restarted after a crash'
           || coalesce(', down ' || case when (array_agg((d.context->>'ms')::numeric order by d.occurred_at desc))[1] < 60000
                                         then 'under a minute'
                                         else 'about ' || round((array_agg((d.context->>'ms')::numeric order by d.occurred_at desc))[1] / 60000)
                                              || ' min' end || ' the last time', ''),
         null::text, null::text
    from public.client_errors d
   where d.source = 'db' and d.kind = 'db_restart' and d.severity = 'crash'
     and d.occurred_at > p_at - interval '24 hours' and d.occurred_at <= p_at
     and not exists (select 1 from public.client_error_groups g
                      where g.fingerprint = d.fingerprint and g.status = 'muted')
  having max(d.occurred_at) > p_at - interval '1 hour'
$$;
revoke all on function public._breaking_candidates(timestamptz, uuid[]) from public, anon, authenticated;

-- ── 4. The breaking check: db_down first, with its own title ────────────────
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
     order by array_position(array['db_down', 'wont_open', 'saves', 'sign_in', 'payments', 'widespread'], k.rule),
              k.people desc
  loop
    v_key := 'breaking:' || c.rule || ':' || c.problem;
    v_title := case c.rule
      when 'db_down'   then 'The database crashed and restarted'
                            || case when c.occurrences > 1 then ' (' || c.occurrences || ' times in 24 hours)' else '' end
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

-- ── 5. Proof ────────────────────────────────────────────────────────────────
do $proof$
declare
  v_fn      text;
  v_word    text := translate(md5(random()::text), '0123456789', 'ghijklmnop');
  v_rows    integer;
  v_base    integer;
  v_outcome text;
  v_title   text;
begin
  -- The 0311 habit: effective privileges, PUBLIC included.
  foreach v_fn in array array[
    'public._note_db_restart()', 'public.error_watch()',
    'public._breaking_candidates(timestamptz,uuid[])', 'public.check_breaking(boolean)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0583: a client role can run %', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['public.check_breaking(boolean)', 'public.error_watch()'] loop
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0583: service_role cannot run %', v_fn;
    end if;
  end loop;

  -- On probe rows rolled back with their block.
  begin
    -- A start is written down once.
    delete from public.app_config where key = 'db_restart_watermark';
    delete from public.client_errors where source = 'db' and kind = 'db_restart';
    v_rows := public._note_db_restart();
    if v_rows <> 1 then
      raise exception '0583: the first pass after a start wrote % rows', v_rows;
    end if;
    v_rows := public._note_db_restart();
    if v_rows <> 0 then
      raise exception '0583: the second pass wrote the same start again';
    end if;
    select count(*) into v_rows from public.client_errors
     where source = 'db' and kind = 'db_restart' and occurred_at = pg_postmaster_start_time()
       and severity in ('crash', 'warning') and fingerprint is not null;
    if v_rows <> 1 then
      raise exception '0583: the start made % rows', v_rows;
    end if;

    -- A crash in the last hour emails; one from two hours ago, or a clean
    -- restart, does not.
    delete from public.client_errors where source = 'db' and kind = 'db_restart';
    insert into public.client_errors (source, kind, severity, name, message, context, env, occurred_at)
    values ('db', 'db_restart', 'warning', 'DbRestart', 'Database restarted', '{"op":"postgres"}', 'prod', now() - interval '5 minutes'),
           ('db', 'db_restart', 'crash', 'DbRestart', 'Database restarted after a crash', '{"op":"postgres","ms":420000}', 'prod', now() - interval '2 hours');
    if exists (select 1 from public._breaking_candidates(now(), null) c where c.rule = 'db_down') then
      raise exception '0583: an old crash or a clean restart emailed';
    end if;
    insert into public.client_errors (source, kind, severity, name, message, context, env, occurred_at)
    values ('db', 'db_restart', 'crash', 'DbRestart', 'Database restarted after a crash', '{"op":"postgres","ms":30000}', 'prod', now() - interval '5 minutes');
    select c.occurrences into v_rows from public._breaking_candidates(now(), null) c where c.rule = 'db_down';
    if v_rows is distinct from 2 then
      raise exception '0583: db_down counted % crashes in the day', coalesce(v_rows::text, 'no candidate');
    end if;
    select c.title, c.outcome into v_title, v_outcome from public.check_breaking(true) c where c.rule = 'db_down';
    if v_title is distinct from 'The database crashed and restarted (2 times in 24 hours)'
       or v_outcome not in ('would email', 'would record: 6 emails today', 'emailed in the last 6 hours') then
      raise exception '0583: the dry run said % / %', coalesce(v_title, 'nothing'), coalesce(v_outcome, 'nothing');
    end if;

    -- A renderer's early splash watchdog never counts; a person's does. Real
    -- rows of the last half hour may be counted already, so against them.
    select c.people into v_base from public._breaking_candidates(now(), null) c where c.rule = 'wont_open';
    insert into public.client_errors (session_id, kind, severity, message, env, context, user_agent)
    select gen_random_uuid(), 'stuck', 'error', 'Boot stuck after start', 'prod',
           ('{"online":true,"op":"boot","phase":"start","ms":' || (9000 + g) || '}')::jsonb,
           '0583 probe ' || v_word
      from generate_series(1, 3) g;
    select c.people into v_rows from public._breaking_candidates(now(), null) c where c.rule = 'wont_open';
    if v_rows is distinct from v_base then
      raise exception '0583: a renderer''s splash watchdog counted';
    end if;
    update public.client_errors set context = jsonb_set(context, '{ms}', '45200')
     where user_agent = '0583 probe ' || v_word;
    select c.people into v_rows from public._breaking_candidates(now(), null) c where c.rule = 'wont_open';
    if coalesce(v_rows, 0) < coalesce(v_base, 0) + 3 then
      raise exception '0583: a person''s stuck boot no longer counts';
    end if;

    -- The 5-minute job runs with the new step.
    perform public.error_watch();
    raise exception using errcode = 'P0001', message = '0583-probe-rollback';
  exception when sqlstate 'P0001' then
    if sqlerrm <> '0583-probe-rollback' then
      raise;
    end if;
  end;
  if exists (select 1 from public.client_errors where user_agent = '0583 probe ' || v_word) then
    raise exception '0583: a probe was left behind';
  end if;
end $proof$;
