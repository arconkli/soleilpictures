-- 0903: put the comment mention email on the daily security check's list.
-- check_security_invariants() check 2 pages "A new path sends email" for any
-- public function whose source calls _notify_email( and is not on its
-- reviewed list. 0902 adds one such function, _comment_mention_email: the
-- email a canvas comment's @mention sends once comment notices are switched
-- on. It is security definer, execute revoked from public, anon and
-- authenticated (proven in 0902), and it sends the 'mention_email' template
-- through _notify_email, so the sending hold and the outbound gate apply to it
-- as they do to _tg_mention_notification_email. Without this the check pages
-- every day from the day 0902 is applied, switch on or off.
--
-- This re-emits check_security_invariants() as an exact copy of 0865's
-- definition plus one token: '_comment_mention_email' on check 2's list.
-- Nothing else in the body changes. DB only. A name on the list that does not
-- exist yet matches nothing, so this is safe to apply before 0902 as well as
-- after it; apply the two together.

create or replace function public.check_security_invariants()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
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
     and p.proname not in ('_notify_email_send', 'ops_alert_dispatch', '_cron_edge_post', '_ops_hc_ping', 'check_security_invariants', '_indexnow_send');
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
                           '_tg_share_notification_email', '_tg_workspace_member_email',
                           '_tg_file_share_person_email', '_tg_file_comment_notify',
                           '_team_invite_email', '_tg_referral_reward_notice',
                           '_comment_mention_email');
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

revoke execute on function public.check_security_invariants() from public, anon, authenticated;

-- Proofs (the 0311 habit: a REVOKE reporting success proves nothing).
do $$
declare
  v_src  text;
  v_fn   record;
  v_bad  text;
begin
  if has_function_privilege('anon', 'public.check_security_invariants()', 'execute')
     or has_function_privilege('authenticated', 'public.check_security_invariants()', 'execute') then
    raise exception '0903: check_security_invariants is client-executable';
  end if;

  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.check_security_invariants()'::regprocedure;
  if position('''_comment_mention_email''' in v_src) = 0 then
    raise exception '0903: check_security_invariants does not list _comment_mention_email';
  end if;
  if position('''_indexnow_send''' in v_src) = 0 then
    raise exception '0903: check_security_invariants lost _indexnow_send from 0865';
  end if;
  if position('''_tg_referral_reward_notice''' in v_src) = 0 then
    raise exception '0903: check_security_invariants lost _tg_referral_reward_notice from 0863';
  end if;

  -- When 0902 is already in, its sender must be server-only.
  for v_fn in
    select p.oid from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = '_comment_mention_email'
  loop
    if has_function_privilege('anon', v_fn.oid, 'execute')
       or has_function_privilege('authenticated', v_fn.oid, 'execute') then
      raise exception '0903: _comment_mention_email is client-executable';
    end if;
  end loop;

  -- Check 2's own query, with the new list: nothing should be left over.
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc ~ '_notify_email\('
     and p.proname not in ('check_security_invariants', '_notify_email',
                           '_tg_comment_reply_email', '_tg_mention_notification_email',
                           '_tg_pending_invite_email', '_tg_schedule_notification_email',
                           '_tg_share_notification_email', '_tg_workspace_member_email',
                           '_tg_file_share_person_email', '_tg_file_comment_notify',
                           '_team_invite_email', '_tg_referral_reward_notice',
                           '_comment_mention_email');
  if v_bad is not null then
    raise exception '0903: functions that call _notify_email and are not on the list: %', v_bad;
  end if;
end $$;
