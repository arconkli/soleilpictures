-- 0370 — the outbound breaker, part 2: the controls, the checks that run on
-- their own, and the schedules.
--
-- 0369 put the gate in front of every database email and made alerts a thing
-- that can reach a person. This adds what an owner needs around it:
--
--   - background checks every 10 minutes: an account-creation spike (more
--     than 15 an hour, far above anything real) pages, and held mail nobody has
--     decided on in 6 hours is mentioned again, once a day;
--   - a weekly heartbeat email ("the breaker is armed", with the week's
--     counts): if Monday's never arrives, the alert path itself is broken;
--   - held mail expires after 7 days, its payload erased;
--   - admin RPCs behind _require_admin(): the overview the Security tab reads,
--     release or drop held mail, lift the global hold, put an account on a
--     sending hold or take it off, acknowledge an alert, send a test alert;
--   - the schedules: alert dispatch every minute (it stays a no-op until
--     app_config ops_alert_dispatch.enabled is switched on, after the
--     send-transactional-email ops_alert template is deployed), the checks,
--     the expiry, the heartbeat.

begin;

-- ── 6. Background checks ────────────────────────────────────────────────────

create or replace function public.check_abuse_signals()
returns integer
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_signups integer;
  v_n integer := 0;
begin
  select count(*) into v_signups from auth.users where created_at > now() - interval '1 hour';
  -- Far above any real hour's signups.
  if v_signups > 15 then
    if public.ops_alert_raise('signups',
         v_signups || ' accounts created in the last hour',
         'Far more than usual. Could be a launch, could be a throwaway-account fleet.',
         true, 'signups:hour', interval '1 hour') is not null then
      v_n := v_n + 1;
    end if;
  end if;
  -- Held mail nobody has looked at in 6 hours is mentioned again, once a day.
  if exists (select 1 from public.outbound_ledger l where l.state = 'held' and l.created_at < now() - interval '6 hours') then
    perform public.ops_alert_raise('held_reminder',
      'Held emails are still waiting for a decision',
      (select count(*) || ' held, oldest ' || to_char(min(l.created_at), 'YYYY-MM-DD HH24:MI') || ' UTC. They expire after 7 days.'
         from public.outbound_ledger l where l.state = 'held'),
      true, 'held:reminder', interval '24 hours');
  end if;
  return v_n;
end;
$$;

create or replace function public.ops_heartbeat()
returns bigint
language plpgsql security definer
set search_path = public as $$
declare
  v_body text;
begin
  select format(E'In the last 7 days:\n- %s emails sent to people outside the product (invites, shares), %s held, %s dropped\n- %s mention / reply / schedule emails sent, %s held, %s dropped\n- %s accounts on a sending hold now\n- breaker: %s\n\nIf this weekly note ever stops arriving, the alert path is broken.',
         count(*) filter (where risk = 'stranger' and state in ('sent', 'released')),
         count(*) filter (where risk = 'stranger' and state = 'held'),
         count(*) filter (where risk = 'stranger' and state = 'dropped'),
         count(*) filter (where risk = 'member' and state in ('sent', 'released')),
         count(*) filter (where risk = 'member' and state = 'held'),
         count(*) filter (where risk = 'member' and state = 'dropped'),
         (select count(*) from public.profiles where send_hold_at is not null),
         coalesce((select 'ON HOLD since ' || to_char(global_hold_since, 'YYYY-MM-DD HH24:MI') || ' UTC'
                     from public.outbound_breaker where id = 1 and global_hold_since is not null), 'armed, not tripped'))
    into v_body
    from public.outbound_ledger
   where created_at > now() - interval '7 days';
  return public.ops_alert_raise('heartbeat', 'Weekly: the outbound breaker is armed', v_body,
    true, 'heartbeat:' || to_char(now(), 'IYYY-IW'), interval '6 days');
end;
$$;

create or replace function public.outbound_expire_held()
returns integer
language plpgsql security definer
set search_path = public as $$
declare v_n integer;
begin
  update public.outbound_ledger
     set state = 'expired', payload = null
   where state = 'held' and created_at < now() - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ── 7. Admin controls ───────────────────────────────────────────────────────

create or replace function public.admin_security_overview()
returns jsonb
language plpgsql security definer
set search_path = public, auth as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'breaker', (select to_jsonb(b) from public.outbound_breaker b where b.id = 1),
    'held_accounts', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'email', u.email,
                                          'since', p.send_hold_at, 'reason', p.send_hold_reason)
                       order by p.send_hold_at desc)
        from public.profiles p join auth.users u on u.id = p.user_id
       where p.send_hold_at is not null), '[]'::jsonb),
    'held_mail', coalesce((
      select jsonb_agg(x order by x->>'oldest')
        from (select jsonb_build_object('actor', l.actor, 'email', u.email, 'count', count(*),
                                        'oldest', min(l.created_at),
                                        'templates', to_jsonb(array_agg(distinct l.template))) x
                from public.outbound_ledger l left join auth.users u on u.id = l.actor
               where l.state = 'held'
               group by l.actor, u.email) s), '[]'::jsonb),
    'alerts', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc)
        from (select id, created_at, kind, title, body, actor, page, paged_at, acked_at
                from public.ops_alerts order by created_at desc limit 50) a), '[]'::jsonb),
    'last_7d', coalesce((
      select jsonb_object_agg(k, n)
        from (select risk || ':' || state as k, count(*) as n
                from public.outbound_ledger
               where created_at > now() - interval '7 days' group by 1) z), '{}'::jsonb)
  );
end;
$$;

create or replace function public.admin_outbound_release_breaker()
returns boolean
language plpgsql security definer
set search_path = public as $$
begin
  perform public._require_admin();
  update public.outbound_breaker
     set global_hold_since = null, released_at = now(), released_by = auth.uid()
   where id = 1 and global_hold_since is not null;
  return found;
end;
$$;

create or replace function public.admin_outbound_release_held(p_actor uuid default null, p_ids bigint[] default null)
returns integer
language plpgsql security definer
set search_path = public as $$
declare
  v_n integer := 0;
  r   record;
begin
  perform public._require_admin();
  for r in
    select l.id, l.payload from public.outbound_ledger l
     where l.state = 'held' and l.payload is not null
       and ((p_actor is not null and l.actor = p_actor) or (p_ids is not null and l.id = any(p_ids)))
     order by l.created_at
     for update
  loop
    perform public._notify_email_send(r.payload->>'template', r.payload->>'to', r.payload->'data',
                                      nullif(r.payload->>'actor', '')::uuid);
    update public.outbound_ledger set state = 'released', released_at = now(), released_by = auth.uid()
     where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.admin_outbound_drop_held(p_actor uuid default null, p_ids bigint[] default null)
returns integer
language plpgsql security definer
set search_path = public as $$
declare v_n integer;
begin
  perform public._require_admin();
  update public.outbound_ledger
     set state = 'dropped', payload = null, released_at = now(), released_by = auth.uid()
   where state = 'held'
     and ((p_actor is not null and actor = p_actor) or (p_ids is not null and id = any(p_ids)));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.admin_hold_sending(p_user uuid, p_reason text default null)
returns boolean
language plpgsql security definer
set search_path = public as $$
begin
  perform public._require_admin();
  return public._hold_sending(p_user, coalesce(nullif(p_reason, ''), 'put on hold by an admin'), 'admin');
end;
$$;

create or replace function public.admin_release_sending(p_user uuid)
returns boolean
language plpgsql security definer
set search_path = public as $$
begin
  perform public._require_admin();
  update public.profiles set send_hold_at = null, send_hold_reason = null
   where user_id = p_user and send_hold_at is not null;
  if not found then return false; end if;
  update public.pending_invites set held_at = null where invited_by = p_user and held_at is not null;
  return true;
end;
$$;

create or replace function public.admin_ops_alert_ack(p_id bigint)
returns boolean
language plpgsql security definer
set search_path = public as $$
begin
  perform public._require_admin();
  update public.ops_alerts set acked_at = now(), acked_by = auth.uid() where id = p_id and acked_at is null;
  return found;
end;
$$;

create or replace function public.admin_ops_alert_test()
returns bigint
language plpgsql security definer
set search_path = public as $$
begin
  perform public._require_admin();
  return public.ops_alert_raise('test', 'Test alert from Clusters',
    'If you are reading this, security alerts reach you. Nothing is wrong.', true);
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────

revoke execute on function public.check_abuse_signals() from public, anon, authenticated;
revoke execute on function public.ops_heartbeat() from public, anon, authenticated;
revoke execute on function public.outbound_expire_held() from public, anon, authenticated;
revoke execute on function public.admin_security_overview() from public, anon;
revoke execute on function public.admin_outbound_release_breaker() from public, anon;
revoke execute on function public.admin_outbound_release_held(uuid, bigint[]) from public, anon;
revoke execute on function public.admin_outbound_drop_held(uuid, bigint[]) from public, anon;
revoke execute on function public.admin_hold_sending(uuid, text) from public, anon;
revoke execute on function public.admin_release_sending(uuid) from public, anon;
revoke execute on function public.admin_ops_alert_ack(bigint) from public, anon;
revoke execute on function public.admin_ops_alert_test() from public, anon;
grant execute on function public.admin_security_overview() to authenticated;
grant execute on function public.admin_outbound_release_breaker() to authenticated;
grant execute on function public.admin_outbound_release_held(uuid, bigint[]) to authenticated;
grant execute on function public.admin_outbound_drop_held(uuid, bigint[]) to authenticated;
grant execute on function public.admin_hold_sending(uuid, text) to authenticated;
grant execute on function public.admin_release_sending(uuid) to authenticated;
grant execute on function public.admin_ops_alert_ack(bigint) to authenticated;
grant execute on function public.admin_ops_alert_test() to authenticated;

-- ── Schedules ───────────────────────────────────────────────────────────────

select cron.schedule('ops-alert-dispatch',   '* * * * *',    $$select public.ops_alert_dispatch()$$);
select cron.schedule('abuse-signals',        '*/10 * * * *', $$select public.check_abuse_signals()$$);
select cron.schedule('outbound-expire-held', '40 3 * * *',   $$select public.outbound_expire_held()$$);
select cron.schedule('ops-heartbeat-weekly', '5 13 * * 1',   $$select public.ops_heartbeat()$$);

-- ── Proofs ──────────────────────────────────────────────────────────────────

do $$
declare
  v_fn  text;
  v_src text;
begin
  foreach v_fn in array array['public.check_abuse_signals()', 'public.ops_heartbeat()', 'public.outbound_expire_held()'] loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0370: % is client-executable', v_fn;
    end if;
  end loop;
  foreach v_fn in array array[
    'public.admin_security_overview()', 'public.admin_outbound_release_breaker()',
    'public.admin_outbound_release_held(uuid,bigint[])', 'public.admin_outbound_drop_held(uuid,bigint[])',
    'public.admin_hold_sending(uuid,text)', 'public.admin_release_sending(uuid)',
    'public.admin_ops_alert_ack(bigint)', 'public.admin_ops_alert_test()'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0370: % is anon-executable', v_fn;
    end if;
    select prosrc into v_src from pg_proc where oid = v_fn::regprocedure;
    if position('_require_admin()' in v_src) = 0 then
      raise exception '0370: % is not admin-gated', v_fn;
    end if;
  end loop;
  if (select count(*) from cron.job where jobname in ('ops-alert-dispatch', 'abuse-signals',
                                                     'outbound-expire-held', 'ops-heartbeat-weekly')) <> 4 then
    raise exception '0370: a schedule is missing';
  end if;
end $$;

commit;
