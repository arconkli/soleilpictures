-- 0541: Teams, part 12 — the team invite email (S4).
--
-- STATUS: written 2026-10-25, not applied. Apply only once
-- send-transactional-email renders 'team_invite' (deployed and read back):
-- before that the function refuses the template, and every invite's email
-- would fail there.
--
-- What it adds (plan docs/superpowers/plans/2026-10-25-team-s4-team-page.md,
-- Task 9):
--   * _outbound_gate: team_invite is stranger mail (it can reach someone with
--     no account), under the breaker and per-recipient cap like a workspace
--     invite. Re-emitted from its live body (0421's, the same text read back
--     2026-10-25); the one change is the stranger list.
--   * check_security_invariants: _team_invite_email joins the functions that
--     may call _notify_email, or the daily check would page about a new path
--     that sends email. Re-emitted from its live body (0421's, read back
--     2026-10-25); the one change is that list.
--   * _team_invite_email(p_invite_id): the email for one open invite: who
--     invited them, the team, the role, and the ?teaminvite= link.
--   * An AFTER INSERT trigger on org_invites sends it. Each invite first
--     spends one from the inviter's daily invitation allowance
--     (_invite_budget_take, 0375), the allowance every other invitation
--     spends, and it spends it whether or not an email goes, so the allowance
--     never says whether an account has the address. Past the allowance the
--     whole invite_to_team call is refused, before anything is written, with
--     "invite limit reached: …" (hint invite_limit_reached).
--   * resend_team_invite(p_invite_id) → 'sent' | 'too_soon' | 'closed': an
--     owner or an admin sends an open invite again, at most once a day
--     (org_invites.resent_at), and the link then works 30 days from the
--     resend. A claimed, revoked or expired invite is 'closed': invite them
--     again (an expired one no longer holds a seat, so reviving it here could
--     overfill the team).

begin;
set local lock_timeout = '3s';

alter table public.org_invites add column if not exists resent_at timestamptz;

-- ── 1. The gate ─────────────────────────────────────────────────────────────

create or replace function public._outbound_gate(p_template text, p_to text, p_data jsonb)
returns text
language plpgsql security definer
set search_path = public, auth as $$
declare
  cfg       jsonb   := coalesce((select value from public.app_config where key = 'outbound_breaker'), '{}'::jsonb);
  c_warn10  integer := coalesce((cfg->>'stranger_warn_10min')::int, 10);
  c_hold_h  integer := coalesce((cfg->>'stranger_hold_hour')::int, 30);
  c_hold_d  integer := coalesce((cfg->>'stranger_hold_day')::int, 60);
  c_recip_d integer := coalesce((cfg->>'recipient_stranger_day')::int, 3);
  c_mem_ah  integer := coalesce((cfg->>'member_actor_hour')::int, 30);
  c_mem_rd  integer := coalesce((cfg->>'member_recipient_day')::int, 10);
  c_new_h   integer := coalesce((cfg->>'new_account_hours')::int, 72);
  c_slack   integer := coalesce((cfg->>'budget_slack')::int, 2);
  v_actor   uuid    := auth.uid();
  v_key     text    := public._outbound_recipient_key(p_to);
  v_risk    text;
  v_state   text    := 'send';
  v_reason  text;
  v_email   text;
  v_created timestamptz;
  v_budget  integer;
  v_hold_since timestamptz;
  v_released   timestamptz;
  v_n10 integer; v_n60 integer; v_n24 integer;
  v_actor_n integer; v_recip_n integer;
  v_recipient uuid;
begin
  v_risk := case
    when p_template in ('pending_invite', 'board_shared', 'workspace_invite', 'file_shared', 'team_invite') then 'stranger'
    when p_template in ('mention_email', 'comment_reply_email', 'schedule_update', 'invite_accepted', 'file_commented') then 'member'
    else 'system'
  end;
  if v_actor is not null then
    select u.email, u.created_at into v_email, v_created from auth.users u where u.id = v_actor;
  end if;

  if v_actor is not null and exists (select 1 from public.profiles p
                                      where p.user_id = v_actor and p.send_hold_at is not null) then
    v_state := 'hold'; v_reason := 'sender_on_hold';

  elsif v_risk = 'stranger' then
    -- One stranger send at a time, so the counts below cannot be raced.
    perform pg_advisory_xact_lock(hashtext('outbound_breaker:stranger'));
    select b.global_hold_since, b.released_at into v_hold_since, v_released
      from public.outbound_breaker b where b.id = 1;
    if v_hold_since is not null then
      v_state := 'hold'; v_reason := 'global_hold';
    else
      -- Releasing the breaker starts the count again, or the mail that tripped
      -- it would trip it a second time on the next invitation.
      select count(*) filter (where l.created_at > now() - interval '10 minutes'),
             count(*) filter (where l.created_at > now() - interval '1 hour'),
             count(*)
        into v_n10, v_n60, v_n24
        from public.outbound_ledger l
       where l.risk = 'stranger' and l.state in ('sent', 'held', 'released')
         and l.created_at > greatest(now() - interval '24 hours', coalesce(v_released, '-infinity'::timestamptz));
      select count(*) into v_recip_n
        from public.outbound_ledger l
       where l.risk = 'stranger' and l.recipient_hash = v_key and l.state in ('sent', 'released')
         and l.created_at > now() - interval '24 hours';

      if v_recip_n >= c_recip_d then
        v_state := 'drop'; v_reason := 'recipient_daily_cap';
      elsif v_n60 + 1 > c_hold_h or v_n24 + 1 > c_hold_d then
        update public.outbound_breaker
           set global_hold_since = now(),
               reason = format('%s stranger emails in the last hour, %s in the last day', v_n60 + 1, v_n24 + 1),
               released_at = null, released_by = null
         where id = 1;
        v_state := 'hold'; v_reason := 'global_hold_tripped';
        perform public._hold_new_senders(c_new_h);
        if v_actor is not null and v_created > now() - make_interval(hours => c_new_h) then
          perform public._hold_sending(v_actor, 'a new account sending invitations when the outbound breaker tripped', 'breaker');
        end if;
        perform public.ops_alert_raise('breaker',
          'Outbound breaker tripped: invitation emails are on hold',
          format(E'%s emails to people outside the product in the last hour, %s in the last day.\nThe one that tripped it came from %s.\nEvery invitation, share and workspace email is now held until you release the breaker. New accounts that sent them were put on a sending hold.',
                 v_n60 + 1, v_n24 + 1, coalesce(v_email, 'the system')),
          true, 'breaker:tripped', interval '1 hour', v_actor);
      else
        if v_actor is not null then
          v_budget := case when v_created > now() - interval '24 hours' then 5 else 20 end;
          select count(*) into v_actor_n
            from public.outbound_ledger l
           where l.risk = 'stranger' and l.actor = v_actor and l.state in ('sent', 'released')
             and l.created_at > now() - interval '24 hours';
          if v_actor_n >= v_budget + c_slack then
            v_state := 'hold'; v_reason := 'sender_over_budget';
            perform public._hold_sending(v_actor,
              format('sent %s invitation emails in 24 hours against a budget of %s, so something got past the budget', v_actor_n + 1, v_budget),
              'breaker');
          elsif v_actor_n + 1 = v_budget then
            perform public.ops_alert_raise('budget',
              'An account used its whole invitation budget: ' || coalesce(v_email, v_actor::text),
              format('%s invitation emails in 24 hours: its whole budget.', v_budget),
              true, 'budget:' || v_actor, interval '24 hours', v_actor);
          end if;
        end if;
        if v_state = 'send' and v_n10 + 1 >= c_warn10 then
          perform public.ops_alert_raise('volume',
            format('%s invitation emails in 10 minutes', v_n10 + 1),
            format(E'Early warning: nothing is held yet. The breaker trips at %s in an hour.\nLatest sender: %s', c_hold_h, coalesce(v_email, 'the system')),
            true, 'volume:10min', interval '1 hour', v_actor);
        end if;
      end if;
    end if;

  elsif v_risk = 'member' then
    select u.id into v_recipient from auth.users u where lower(u.email) = lower(p_to) limit 1;
    if v_recipient is null
       or not exists (select 1 from public.user_presence pr where pr.user_id = v_recipient) then
      v_state := 'drop'; v_reason := 'recipient_never_opened_app';
    else
      select count(*) into v_actor_n
        from public.outbound_ledger l
       where l.risk = 'member' and l.actor = v_actor and l.state in ('sent', 'held', 'released')
         and l.created_at > now() - interval '1 hour';
      select count(*) into v_recip_n
        from public.outbound_ledger l
       where l.risk = 'member' and l.recipient_hash = v_key and l.state in ('sent', 'released')
         and l.created_at > now() - interval '24 hours';
      if v_actor is not null and v_actor_n >= c_mem_ah then
        v_state := 'hold'; v_reason := 'member_sender_hourly_cap';
        perform public.ops_alert_raise('member_volume',
          'One account sent ' || (v_actor_n + 1) || ' notification emails in an hour: ' || coalesce(v_email, v_actor::text),
          'Mentions, replies and schedule updates from this account are held. Release or drop them from the Security tab.',
          true, 'member:' || v_actor, interval '1 hour', v_actor);
      elsif v_recip_n >= c_mem_rd then
        v_state := 'hold'; v_reason := 'member_recipient_daily_cap';
        perform public.ops_alert_raise('member_volume',
          'One person was about to get more than ' || c_mem_rd || ' notification emails today',
          'Further mentions, replies and schedule updates to them are held. Latest sender: ' || coalesce(v_email, 'the system'),
          true, 'member_recipient:' || v_key, interval '6 hours', v_actor);
      end if;
    end if;
  end if;

  insert into public.outbound_ledger (actor, template, risk, recipient_hash, state, reason, payload)
  values (v_actor, p_template, v_risk, v_key,
          case v_state when 'hold' then 'held' when 'drop' then 'dropped' else 'sent' end,
          v_reason,
          case when v_state = 'hold'
               then jsonb_build_object('template', p_template, 'to', p_to, 'data', p_data, 'actor', v_actor)
          end);
  return v_state;
exception when others then
  -- Fail closed: hold it rather than send it or lose it.
  begin
    insert into public.outbound_ledger (actor, template, risk, recipient_hash, state, reason, payload)
    values (auth.uid(), p_template, 'system', md5(lower(coalesce(p_to, ''))), 'held',
            left('gate_error: ' || sqlerrm, 300),
            jsonb_build_object('template', p_template, 'to', p_to, 'data', p_data, 'actor', auth.uid()));
  exception when others then
    null;
  end;
  return 'hold';
end;
$$;

-- The daily check (0374) pages on any function that calls _notify_email and
-- isn't on its list; _team_invite_email (below) is one now, on purpose.
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
                           '_tg_share_notification_email', '_tg_workspace_member_email',
                           '_tg_file_share_person_email', '_tg_file_comment_notify',
                           '_team_invite_email');
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

-- ── 2. The email ────────────────────────────────────────────────────────────

create or replace function public._team_invite_email(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_i       public.org_invites%rowtype;
  v_team    text;
  v_inviter text;
  v_user    uuid;
begin
  select * into v_i from public.org_invites oi where oi.id = p_invite_id;
  if v_i.id is null or v_i.claimed_at is not null or v_i.revoked_at is not null
     or v_i.expires_at <= now() then
    return;
  end if;
  select o.name into v_team from public.organizations o where o.id = v_i.org_id and o.closed_at is null;
  if v_team is null then
    return;
  end if;
  -- An account with the address that turned invitation emails off gets none;
  -- it finds the team at its next sign-in (claim_my_team_invites, 0533).
  select u.id into v_user from auth.users u where lower(u.email) = lower(v_i.email) limit 1;
  if v_user is not null and not public._email_pref_enabled(v_user, 'email_workspace_invite') then
    return;
  end if;
  -- 0358: the inviter's own address, never a display name. The person may
  -- have no account, and a display name is whatever its owner typed.
  select u.email into v_inviter from auth.users u where u.id = v_i.invited_by;
  perform public._notify_email(
    'team_invite',
    v_i.email,
    jsonb_build_object(
      'teamName',    v_team,
      'inviterName', coalesce(v_inviter, 'Someone on Clusters'),
      'role',        v_i.role,
      'token',       v_i.token::text,
      'expiresAt',   to_char(v_i.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  );
end;
$$;

create or replace function public._tg_org_invite_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.claimed_at is not null or new.revoked_at is not null then
    return new;
  end if;
  -- One from the inviter's daily allowance, raising "invite limit reached"
  -- past it, which refuses the whole invite_to_team call. A write with no
  -- session (the service role) has no allowance to spend.
  if auth.uid() is not null then
    perform public._invite_budget_take();
  end if;
  perform public._team_invite_email(new.id);
  return new;
end;
$$;

create or replace trigger org_invites_email
  after insert on public.org_invites
  for each row execute function public._tg_org_invite_email();

-- ── 3. Resend ───────────────────────────────────────────────────────────────

create or replace function public.resend_team_invite(p_invite_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_i   public.org_invites%rowtype;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  select * into v_i from public.org_invites oi where oi.id = p_invite_id for update;
  if v_i.id is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  if not public._org_is_admin(v_i.org_id, v_uid) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(v_i.org_id, v_uid) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  if v_i.claimed_at is not null or v_i.revoked_at is not null or v_i.expires_at <= now() then
    return 'closed';
  end if;
  if not public._actor_can_send() then
    raise exception 'sharing is paused on this account while we review unusual activity'
      using errcode = '42501';
  end if;
  if coalesce(v_i.resent_at, v_i.created_at) > now() - interval '1 day' then
    return 'too_soon';
  end if;
  perform public._invite_budget_take();
  update public.org_invites oi
     set resent_at = now(),
         expires_at = greatest(oi.expires_at, now() + interval '30 days')
   where oi.id = v_i.id;
  perform public._team_invite_email(v_i.id);
  return 'sent';
end;
$$;

-- The two re-emits keep their live grants (CREATE OR REPLACE does), and say so.
revoke execute on function public._outbound_gate(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.check_security_invariants() from public, anon, authenticated;
revoke execute on function public._team_invite_email(uuid) from public, anon, authenticated;
revoke execute on function public._tg_org_invite_email() from public, anon, authenticated;
revoke execute on function public.resend_team_invite(uuid) from public, anon;
grant execute on function public.resend_team_invite(uuid) to authenticated;

-- ── 4. Proof ────────────────────────────────────────────────────────────────

do $$
declare
  v_fn text;
begin
  if to_regprocedure('public._invite_budget_take()') is null
     or to_regprocedure('public._notify_email(text,text,jsonb)') is null
     or to_regprocedure('public._email_pref_enabled(uuid,text)') is null
     or to_regprocedure('public._org_is_admin(uuid,uuid)') is null
     or to_regprocedure('public._actor_can_send()') is null then
    raise exception '0541 needs 0375, 0369 and 0531-0533 live first';
  end if;

  foreach v_fn in array array['public._outbound_gate(text,text,jsonb)', 'public._team_invite_email(uuid)',
                              'public._tg_org_invite_email()'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0541: % is callable from a session', v_fn;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.resend_team_invite(uuid)', 'execute') then
    raise exception '0541: resend_team_invite is callable signed out';
  end if;
  if not has_function_privilege('authenticated', 'public.resend_team_invite(uuid)', 'execute') then
    raise exception '0541: resend_team_invite is not callable signed in';
  end if;

  if position('''team_invite''' in (select p.prosrc from pg_proc p
                                     where p.oid = 'public._outbound_gate(text,text,jsonb)'::regprocedure)) = 0 then
    raise exception '0541: the gate does not know team_invite';
  end if;
  if position('''_team_invite_email''' in (select p.prosrc from pg_proc p
                                            where p.oid = 'public.check_security_invariants()'::regprocedure)) = 0 then
    raise exception '0541: the daily check would page about the invite email';
  end if;
  if has_function_privilege('authenticated', 'public.check_security_invariants()', 'execute') then
    raise exception '0541: check_security_invariants is callable from a session';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.org_invites'::regclass and t.tgname = 'org_invites_email'
                    and not t.tgisinternal) then
    raise exception '0541: the invite email trigger is missing';
  end if;

  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname in ('_outbound_gate', 'check_security_invariants', '_team_invite_email',
                                 '_tg_org_invite_email', 'resend_team_invite')
              group by p.proname having count(*) > 1) then
    raise exception '0541: an overload exists (PGRST203)';
  end if;
end $$;

commit;
