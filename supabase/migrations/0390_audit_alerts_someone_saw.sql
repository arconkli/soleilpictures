-- 0390 — an alert nobody saw is itself something to raise (security audit,
-- alert delivery).
--
-- The first test alert was accepted by Resend, stamped as emailed, and landed
-- in Spam, where it sat for four days with nothing to notice. Sent is not
-- seen. Three changes; the email itself became plain text in
-- send-transactional-email, in the same commit.
--
--   1. The test alert and the weekly report are reworded. The test asked
--      nothing of its reader; now it asks for the one click that shows an
--      alert was read: Seen, in Settings > Security. The weekly report said
--      the breaker was armed even while it was on hold, and promised that a
--      missing report meant trouble. A report in Spam is not missing.
--
--   2. _ops_deadman checks the alert path every ten minutes and reports to an
--      outside check at healthchecks.io through _ops_hc_ping: a success ping
--      when all is well, a failure ping carrying reason codes otherwise:
--        unpaged           a paging alert still not emailed after 15 minutes
--        unseen            an emailed alert nobody marked Seen in 30 minutes
--        report_unseen     a weekly report nobody marked Seen in two days
--        dispatch_off      alert emails switched off in app_config
--        dispatch_stalled  the dispatcher has not run cleanly in 10 minutes
--        token_missing     the dispatcher's email token is missing from Vault
--        schedule_missing  a job on the alert path is missing or paused
--      If the database, pg_cron or pg_net stops, the pings stop, and
--      healthchecks.io notices on its own. It notifies through its own email
--      and push, so this path rests on neither Resend nor our domains. Only
--      the reason codes leave: no alert text, no address.
--
--      The check's UUID goes into Vault as ops_deadman_check, by hand, in the
--      SQL editor, never in a migration. Until it is there, _ops_hc_ping does
--      nothing.
--
--   3. check_security_invariants learns both: _ops_hc_ping joins the reviewed
--      HTTP callers, check 1 now matches any net.http call rather than only
--      http_post, and ops-deadman joins the alert path's schedules.

begin;

-- ── 1. The test alert and the weekly report ─────────────────────────────────

create or replace function public.admin_ops_alert_test()
returns bigint
language plpgsql security definer
set search_path = public as $$
begin
  perform public._require_admin();
  return public.ops_alert_raise('test', 'Test message from the Clusters monitor',
    E'You sent this from Settings > Security. Real alerts come from this address, in this format.\n'
      || 'Mark it Seen there to finish the check.', true);
end;
$$;

create or replace function public.ops_heartbeat()
returns bigint
language plpgsql security definer
set search_path = public as $$
declare
  v_hold timestamptz;
  v_body text;
begin
  select global_hold_since into v_hold from public.outbound_breaker where id = 1;
  select E'Last 7 days\n'
      || format(E'- To people outside the product (invitations, shares): %s sent, %s held, %s dropped\n',
                count(*) filter (where risk = 'stranger' and state in ('sent', 'released')),
                count(*) filter (where risk = 'stranger' and state = 'held'),
                count(*) filter (where risk = 'stranger' and state = 'dropped'))
      || format(E'- Mentions, replies and schedule updates: %s sent, %s held, %s dropped\n',
                count(*) filter (where risk = 'member' and state in ('sent', 'released')),
                count(*) filter (where risk = 'member' and state = 'held'),
                count(*) filter (where risk = 'member' and state = 'dropped'))
      || format(E'- Accounts on a sending hold now: %s\n',
                (select count(*) from public.profiles where send_hold_at is not null))
      || (select format(E'- Alerts emailed: %s, not yet marked Seen: %s\n',
                        count(*), count(*) filter (where a.acked_at is null))
            from public.ops_alerts a
           where a.page and a.kind <> 'heartbeat' and a.paged_at is not null
             and a.created_at > now() - interval '7 days')
      || format(E'- Breaker: %s\n\n',
                coalesce('ON HOLD since ' || to_char(v_hold, 'YYYY-MM-DD HH24:MI') || ' UTC', 'armed, not tripped'))
      || 'Mark this report Seen in Settings > Security. If it landed in Spam, mark it Not spam. '
      || 'If it stops arriving, the alert path is broken.'
    into v_body
    from public.outbound_ledger
   where created_at > now() - interval '7 days';
  return public.ops_alert_raise('heartbeat',
    case when v_hold is not null then 'Weekly report: the outbound breaker is on hold'
         else 'Weekly report: the outbound breaker is armed' end,
    v_body, true, 'heartbeat:' || to_char(now(), 'IYYY-IW'), interval '6 days');
end;
$$;

-- ── 2. The dead-man ─────────────────────────────────────────────────────────

-- The only call out of the database to anywhere but our own functions. The
-- host is fixed here; Vault holds only the check's UUID, and a value that is
-- not one sends nothing.
create or replace function public._ops_hc_ping(p_ok boolean, p_why text[] default '{}')
returns bigint
language plpgsql security definer
set search_path = public, vault, net as $$
declare
  v_check text;
begin
  select substring(lower(decrypted_secret) from '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
    into v_check
    from vault.decrypted_secrets where name = 'ops_deadman_check' limit 1;
  if v_check is null then
    return null;
  end if;
  return net.http_post(
    url     := 'https://hc-ping.com/' || v_check || case when coalesce(p_ok, false) then '' else '/fail' end,
    body    := jsonb_build_object('why', coalesce(p_why, '{}'::text[])),
    timeout_milliseconds := 5000
  );
end;
$$;
revoke execute on function public._ops_hc_ping(boolean, text[]) from public, anon, authenticated;

create or replace function public._ops_deadman()
returns integer
language plpgsql security definer
set search_path = public as $$
declare
  -- Alerts from before this went out in the old layout. The one paging alert
  -- among them, the test that landed in Spam, is marked Seen by hand.
  c_since constant timestamptz := '2026-10-10 00:00:00+00';
  v_why   text[] := '{}';
begin
  if exists (select 1 from public.ops_alerts a
              where a.page and a.paged_at is null and a.acked_at is null
                and a.created_at >= c_since and a.created_at < now() - interval '15 minutes') then
    v_why := v_why || 'unpaged'::text;
  end if;
  if exists (select 1 from public.ops_alerts a
              where a.page and a.paged_at is not null and a.acked_at is null and a.kind <> 'heartbeat'
                and a.created_at >= c_since and a.created_at < now() - interval '30 minutes') then
    v_why := v_why || 'unseen'::text;
  end if;
  if exists (select 1 from public.ops_alerts a
              where a.page and a.kind = 'heartbeat' and a.acked_at is null
                and a.created_at >= c_since and a.created_at < now() - interval '2 days') then
    v_why := v_why || 'report_unseen'::text;
  end if;
  if coalesce((select (value->>'enabled')::boolean from public.app_config
                where key = 'ops_alert_dispatch'), false) is not true then
    v_why := v_why || 'dispatch_off'::text;
  end if;
  -- The newest few runs, by the run id's index: the dispatcher runs every
  -- minute, so these are a handful of rows from the top.
  if not exists (
       select 1 from (select d.status, d.start_time
                        from cron.job_run_details d
                       where d.jobid = (select jobid from cron.job where jobname = 'ops-alert-dispatch')
                       order by d.runid desc limit 5) r
        where r.status = 'succeeded' and r.start_time > now() - interval '10 minutes') then
    v_why := v_why || 'dispatch_stalled'::text;
  end if;
  if not exists (select 1 from vault.decrypted_secrets
                  where name = 'edge_email_token' and coalesce(decrypted_secret, '') not in ('', 'CHANGE_ME')) then
    v_why := v_why || 'token_missing'::text;
  end if;
  if exists (select 1 from unnest(array['ops-alert-dispatch', 'abuse-signals', 'outbound-expire-held',
                                        'ops-heartbeat-weekly', 'security-invariants', 'ops-deadman']) j
              where not exists (select 1 from cron.job c where c.jobname = j and c.active)) then
    v_why := v_why || 'schedule_missing'::text;
  end if;
  perform public._ops_hc_ping(cardinality(v_why) = 0, v_why);
  return cardinality(v_why);
end;
$$;
revoke execute on function public._ops_deadman() from public, anon, authenticated;

select cron.schedule('ops-deadman', '*/10 * * * *', $$select public._ops_deadman()$$);

-- ── 3. The daily invariants know both ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_security_invariants()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_bad   text;
  v_n     integer := 0;
  v_src   text;
begin
  -- 1. HTTP from the database: any net.http call, not only http_post (0390).
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc ilike '%net.http%'
     and p.proname not in ('_notify_email_send', 'ops_alert_dispatch', '_cron_edge_post', '_ops_hc_ping', 'check_security_invariants');
  if v_bad is not null then
    v_n := v_n + 1;
    perform public.ops_alert_raise('invariant', 'A database function now makes HTTP calls',
      'Not on the reviewed list: ' || v_bad || E'.\nA call out of a trigger or RPC can send email without passing the outbound gate.',
      true, 'invariant:http_post', interval '24 hours');
  end if;

  -- 2. Who sends email, and through what.
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc ~ '_notify_email\('
     and p.proname not in ('check_security_invariants', '_notify_email',
                           '_tg_comment_reply_email', '_tg_mention_notification_email',
                           '_tg_pending_invite_email', '_tg_schedule_notification_email',
                           '_tg_share_notification_email', '_tg_workspace_member_email');
  if v_bad is not null then
    v_n := v_n + 1;
    perform public.ops_alert_raise('invariant', 'A new path sends email',
      'Calls _notify_email and is not one of the six reviewed triggers: ' || v_bad
        || E'.\nClassify its template in _outbound_gate (stranger or member) and add it to check_security_invariants.',
      true, 'invariant:notify_email', interval '24 hours');
  end if;
  select prosrc into v_src from pg_proc where oid = to_regprocedure('public._notify_email(text,text,jsonb)');
  if v_src is null or position('_outbound_gate' in v_src) = 0 then
    v_n := v_n + 1;
    perform public.ops_alert_raise('invariant', 'The outbound gate is no longer in front of email',
      '_notify_email does not call _outbound_gate (or has a new signature). Every database email is going out unchecked.',
      true, 'invariant:gate', interval '24 hours');
  end if;

  -- 3. Internal helpers a client can run.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like '\_%' escape '\'
     and p.prosecdef
     and p.prorettype <> 'trigger'::regtype
     and p.proname not in ('_board_in_workspace', '_require_admin')
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_bad is not null then
    v_n := v_n + 1;
    perform public.ops_alert_raise('invariant', 'An internal helper is callable by clients',
      'SECURITY DEFINER and executable by anon or authenticated: ' || v_bad
        || E'.\nThe 0311 rule: revoke execute ... from public, anon, authenticated.',
      true, 'invariant:helpers', interval '24 hours');
  end if;

  -- 4. INSERT policies that accept anything.
  select string_agg(c.relname || ': ' || pol.polname, ', ' order by c.relname) into v_bad
    from pg_policy pol join pg_class c on c.oid = pol.polrelid
   where c.relnamespace = 'public'::regnamespace
     and pol.polcmd in ('a', '*')
     and coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid),
                  case when pol.polcmd = '*' then pg_get_expr(pol.polqual, pol.polrelid) end,
                  'true') = 'true'
     and not (c.relname = 'analytics_events' and pol.polname = 'anyone insert events');
  if v_bad is not null then
    v_n := v_n + 1;
    perform public.ops_alert_raise('invariant', 'A table accepts any row from a client',
      'INSERT policy with no condition: ' || v_bad || '.',
      true, 'invariant:open_insert', interval '24 hours');
  end if;

  -- 5. Row-level security everywhere.
  select string_agg(c.relname, ', ' order by c.relname) into v_bad
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p')
     and not c.relrowsecurity;
  if v_bad is not null then
    v_n := v_n + 1;
    perform public.ops_alert_raise('invariant', 'A table has row-level security off',
      'Readable and writable by any client the grants allow: ' || v_bad || '.',
      true, 'invariant:rls', interval '24 hours');
  end if;

  -- 6. The alert path itself.
  select concat_ws(', ',
           case when not exists (select 1 from public.outbound_breaker where id = 1) then 'the breaker row is gone' end,
           case when coalesce((select (value->>'enabled')::boolean from public.app_config
                                where key = 'ops_alert_dispatch'), false) is not true
                then 'alert emails are switched off (app_config ops_alert_dispatch)' end,
           (select 'missing or paused schedule: ' || string_agg(j, ', ')
              from unnest(array['ops-alert-dispatch', 'abuse-signals', 'outbound-expire-held',
                                'ops-heartbeat-weekly', 'security-invariants', 'ops-deadman']) j
             where not exists (select 1 from cron.job c where c.jobname = j and c.active)))
    into v_bad;
  if v_bad <> '' then
    v_n := v_n + 1;
    perform public.ops_alert_raise('invariant', 'Part of the alert path is off',
      v_bad || '.', true, 'invariant:alert_path', interval '24 hours');
  end if;

  return v_n;
end;
$function$;

-- ── Proofs ──────────────────────────────────────────────────────────────────

do $$
declare
  v_n integer;
begin
  if has_function_privilege('anon', 'public._ops_hc_ping(boolean, text[])', 'execute')
     or has_function_privilege('authenticated', 'public._ops_hc_ping(boolean, text[])', 'execute')
     or has_function_privilege('anon', 'public._ops_deadman()', 'execute')
     or has_function_privilege('authenticated', 'public._ops_deadman()', 'execute') then
    raise exception '0390: a dead-man helper is client-callable';
  end if;
  -- create or replace keeps an ACL; these prove it did.
  if not has_function_privilege('authenticated', 'public.admin_ops_alert_test()', 'execute')
     or has_function_privilege('anon', 'public.admin_ops_alert_test()', 'execute')
     or has_function_privilege('authenticated', 'public.ops_heartbeat()', 'execute')
     or has_function_privilege('anon', 'public.ops_heartbeat()', 'execute')
     or has_function_privilege('authenticated', 'public.check_security_invariants()', 'execute') then
    raise exception '0390: a reworded function changed who may call it';
  end if;
  if not exists (select 1 from cron.job where jobname = 'ops-deadman' and schedule = '*/10 * * * *' and active) then
    raise exception '0390: the dead-man is not scheduled';
  end if;
  if (select prosrc from pg_proc where oid = 'public._ops_deadman()'::regprocedure) ilike '%net.http%' then
    raise exception '0390: only _ops_hc_ping may call out';
  end if;
  v_n := public._ops_deadman();
  if v_n <> 0 then
    raise exception '0390: the alert path already fails % dead-man check(s)', v_n;
  end if;
  v_n := public.check_security_invariants();
  if v_n <> 0 then
    raise exception '0390: the live database fails % invariant(s); see ops_alerts', v_n;
  end if;
end $$;

commit;
