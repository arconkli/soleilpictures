-- 0386 — the cron secret leaves the job table (audit SEC-1).
--
-- Five pg_cron jobs called edge functions with the shared x-cron-secret typed
-- into their command text, so it sat in cron.job, in every row of
-- cron.job_run_details, and in anything that ever read either — backups,
-- support tooling, a query log.
--
-- Now: the secret is copied into Vault straight from the job rows (it is never
-- typed, printed or committed), _cron_edge_post sends it, and each job calls
-- that helper. Old run logs are redacted, and the daily invariants check knows
-- the helper is allowed to make HTTP calls. The edge functions are unchanged:
-- the header value is the same.
--
-- Client roles: PUBLIC holds SELECT on both cron tables, granted by their owner
-- supabase_admin, which postgres cannot revoke. Two things keep clients out,
-- and the proofs below pin both: no USAGE on the cron schema, and pg_cron's own
-- row policy, which shows a role only the jobs it owns.

begin;

do $$
declare
  v_secret   text;
  v_distinct integer;
begin
  if not exists (select 1 from vault.secrets where name = 'cron_edge_secret') then
    select count(distinct substring(command from $re$'x-cron-secret'\s*,\s*'([^']*)'$re$)),
           max(substring(command from $re$'x-cron-secret'\s*,\s*'([^']*)'$re$))
      into v_distinct, v_secret
      from cron.job
     where command ~ 'x-cron-secret';
    if v_distinct <> 1 or v_secret is null or length(v_secret) < 32 then
      raise exception '0386: expected one shared inline cron secret, found %', v_distinct;
    end if;
    perform vault.create_secret(v_secret, 'cron_edge_secret',
      'The x-cron-secret header the edge-function cron jobs send (0386).');
  end if;
end $$;

create or replace function public._cron_edge_post(p_function text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer
set search_path = public, vault, net as $$
declare
  v_secret text;
begin
  if p_function is null or p_function !~ '^[a-z0-9-]+$' then
    raise exception 'not an edge function name: %', p_function;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_edge_secret' limit 1;
  if v_secret is null then
    raise exception 'vault secret cron_edge_secret is missing';
  end if;
  return net.http_post(
    url     := 'https://ehlhlmbpwwalmeisvmdp.supabase.co/functions/v1/' || p_function,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := coalesce(p_body, '{}'::jsonb)
  );
end;
$$;
revoke execute on function public._cron_edge_post(text, jsonb) from public, anon, authenticated;

select cron.schedule('billing-reconcile-daily',      '47 6 * * *',   $$select public._cron_edge_post('billing-reconcile-cron')$$);
select cron.schedule('gsc-sync-daily',               '45 5 * * *',   $$select public._cron_edge_post('gsc-sync', jsonb_build_object('trigger', 'cron'))$$);
select cron.schedule('lifecycle-email-hourly',       '0 * * * *',    $$select public._cron_edge_post('lifecycle-email-cron')$$);
select cron.schedule('seo-health-every-6h',          '37 */6 * * *', $$select public._cron_edge_post('seo-health')$$);
select cron.schedule('waitlist-accept-every-10-min', '*/10 * * * *', $$select public._cron_edge_post('waitlist-accept-cron')$$);

update cron.job_run_details set command = '[redacted by 0386]' where command ~ 'x-cron-secret';

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
  -- 1. HTTP from the database.
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc ilike '%net.http_post%'
     and p.proname not in ('_notify_email_send', 'ops_alert_dispatch', '_cron_edge_post', 'check_security_invariants');
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
                                'ops-heartbeat-weekly', 'security-invariants']) j
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
begin
  if exists (select 1 from cron.job where command ~ 'x-cron-secret') then
    raise exception '0386: a job still carries the secret inline';
  end if;
  if exists (select 1 from cron.job_run_details where command ~ 'x-cron-secret') then
    raise exception '0386: a run log still carries the secret';
  end if;
  if (select count(*) from cron.job where command like '%public._cron_edge_post(%' and active) <> 5 then
    raise exception '0386: expected five jobs on _cron_edge_post';
  end if;
  if not exists (select 1 from vault.secrets where name = 'cron_edge_secret') then
    raise exception '0386: the vault secret is missing';
  end if;
  if has_function_privilege('authenticated', 'public._cron_edge_post(text, jsonb)', 'execute')
     or has_function_privilege('anon', 'public._cron_edge_post(text, jsonb)', 'execute') then
    raise exception '0386: _cron_edge_post is client-callable';
  end if;
  if has_schema_privilege('anon', 'cron', 'usage') or has_schema_privilege('authenticated', 'cron', 'usage') then
    raise exception '0386: client roles can reach the cron schema';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'cron.job'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'cron.job_run_details'::regclass) then
    raise exception '0386: pg_cron''s row policy is off';
  end if;
end $$;

commit;
