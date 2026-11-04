-- 0863: tell people when they earn. When a friend you invited adds their
-- first card, _pay_referral_rewards (0416) stamps referrals.reward_granted_at
-- and credits your cards and storage. Until now nothing said so unless you
-- happened to be in the app when the bonus grew. Now the stamp also writes a
-- note in your bell (notifications kind 'invite.reward') and, when you are not
-- in the app and have not switched it off, one email (template invite_reward,
-- preference email_invite_reward, on by default).
--
-- A trigger on referrals rather than a change to the payer: the payer stays
-- 0416's, and the note lands in the same transaction as the reward, once per
-- referral (reward_granted_at going from null to a time). Its whole body is
-- guarded: it runs inside the friend's first-card placement and the hourly
-- payout, and a failure here must never block the card or the reward.
--
-- Any order is safe: before send-transactional-email knows invite_reward the
-- email is refused and logged, and the note still lands.
--
-- The outbound gate classes invite_reward as a member email, and the daily
-- security check knows the new trigger as a reviewed sender of email.

-- ── 1. The reward's numbers, as people are told them ────────────────────────
-- Keep in step with c_reward_cards in _pay_referral_rewards (0416) and
-- REFERRAL_REWARD_CARDS in boards/src/lib/inviteReward.js
-- (inviteRewardNoticeMigration.test.mjs pins all three).
create or replace function public._referral_reward_cards()
 returns integer
 language sql
 immutable
 set search_path = ''
as $$ select 25 $$;
revoke execute on function public._referral_reward_cards() from public, anon, authenticated;

-- Bytes as the app labels them (formatBonusBytes, inviteReward.js): GiB called
-- GB, at most one decimal, TB from 1024 GB. 536870912 is '0.5GB'.
create or replace function public._bonus_bytes_label(p_bytes bigint)
 returns text
 language sql
 immutable
 set search_path = ''
as $$
  select case
    when greatest(coalesce(p_bytes, 0), 0) >= 1099511627776
      then trim_scale(round(greatest(coalesce(p_bytes, 0), 0) / 1099511627776.0, 1))::text || 'TB'
    else trim_scale(round(greatest(coalesce(p_bytes, 0), 0) / 1073741824.0, 1))::text || 'GB'
  end
$$;
revoke execute on function public._bonus_bytes_label(bigint) from public, anon, authenticated;

-- ── 2. The note and the email ───────────────────────────────────────────────
-- The friend is not named (actor_id stays null). In the app, the bell and the
-- app's own reward toast say it; away, one email, unless switched off.
create or replace function public._tg_referral_reward_notice()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_cards   integer;
  v_bytes   bigint;
  v_storage text;
  v_email   text;
  v_token   text;
  v_mail    boolean := false;
begin
  begin
    v_cards   := public._referral_reward_cards();
    v_bytes   := public._referral_bonus_storage_bytes();
    v_storage := public._bonus_bytes_label(v_bytes);

    if not public._is_user_online(new.referrer_id)
       and public._email_pref_enabled(new.referrer_id, 'email_invite_reward') then
      select u.email::text into v_email from auth.users u where u.id = new.referrer_id;
      v_mail := coalesce(v_email, '') <> '';
    end if;

    insert into public.notifications (user_id, kind, title, body, data, emailed_at)
    values (new.referrer_id, 'invite.reward',
            'A friend you invited added their first card',
            format('You earned %s more cards and %s more storage.', v_cards, v_storage),
            jsonb_build_object('cards', v_cards, 'storage_bytes', v_bytes, 'referral_id', new.id),
            case when v_mail then now() end);

    if v_mail then
      -- Its own guard: a failed email never takes the note with it.
      begin
        select t.token into v_token from public.email_unsub_tokens t where t.user_id = new.referrer_id;
        perform public._notify_email('invite_reward', v_email, jsonb_build_object(
          'cards',            v_cards,
          'storage',          v_storage,
          -- The footer's one-click link and the List-Unsubscribe header
          -- (k=email_invite_reward, in the email sender).
          'unsubscribeToken', v_token
        ));
      exception when others then
        raise warning '_tg_referral_reward_notice email failed for referral %: %', new.id, sqlerrm;
      end;
    end if;
  exception when others then
    raise warning '_tg_referral_reward_notice failed for referral %: %', new.id, sqlerrm;
  end;
  return null;
end;
$function$;
revoke execute on function public._tg_referral_reward_notice() from public, anon, authenticated;

create or replace trigger referrals_reward_notice
  after update of reward_granted_at on public.referrals
  for each row
  when (old.reward_granted_at is null and new.reward_granted_at is not null)
  execute function public._tg_referral_reward_notice();

-- ── 3. One-click unsubscribe for invite reward emails ───────────────────────
-- 0369's body, unchanged apart from the allowlist gaining email_invite_reward.
-- No grants here: 0173 made it service_role only and create or replace keeps that.
create or replace function public.email_unsubscribe(p_token text, p_key text default 'email_lifecycle')
returns boolean
language plpgsql security definer
set search_path = public as $$
declare v_uid uuid;
begin
  -- 0863: invite rewards joined. Keep this list in step with UNSUB_KEYS in
  -- boards/src/worker.js.
  if p_key not in ('email_lifecycle', 'email_schedule', 'email_share_activity',
                   'email_mentions', 'email_comment_replies', 'email_invite_reward') then
    return false;
  end if;
  update public.profiles
     set notification_prefs = jsonb_set(coalesce(notification_prefs, '{}'::jsonb),
                                        array[p_key], 'false'::jsonb, true)
   where user_id = (select user_id from public.email_unsub_tokens where token = p_token)
   returning user_id into v_uid;
  return v_uid is not null;
end
$$;

-- ── 3b. The gate and the daily check know the new email ─────────────────────
-- invite_reward is a member email: it goes to someone with an account, caused
-- by their friend's first card, so the member caps apply. The daily security
-- check's sender list gains _tg_referral_reward_notice. Both bodies are
-- re-emitted from their latest definitions (0830, 0541); only that changes.
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
    when p_template in ('mention_email', 'comment_reply_email', 'schedule_update', 'invite_accepted', 'file_commented', 'edit_request', 'edit_granted', 'invite_reward') then 'member'
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

revoke execute on function public._outbound_gate(text, text, jsonb) from public, anon, authenticated;

-- The daily check (0374) pages on any function that calls _notify_email and
-- isn't on its list; _tg_referral_reward_notice joins it on purpose in 0863.
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
                           '_team_invite_email', '_tg_referral_reward_notice');
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

-- ── 4. Proofs (the 0311 habit: a REVOKE reporting success proves nothing) ───
do $$
declare
  v_fn   text;
  v_pay  integer;
begin
  foreach v_fn in array array[
    'public._referral_reward_cards()',
    'public._bonus_bytes_label(bigint)',
    'public._tg_referral_reward_notice()'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0863: % is client-executable', v_fn;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.email_unsubscribe(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.email_unsubscribe(text,text)', 'execute') then
    raise exception '0863: email_unsubscribe is client-executable';
  end if;
  if not has_function_privilege('service_role', 'public.email_unsubscribe(text,text)', 'execute') then
    raise exception '0863: the Worker cannot call email_unsubscribe';
  end if;

  v_pay := substring(pg_get_functiondef('public._pay_referral_rewards(uuid)'::regprocedure)
                     from 'c_reward_cards\s+constant\s+integer\s*:=\s*(\d+)')::int;
  if v_pay is distinct from public._referral_reward_cards() then
    raise exception '0863: _referral_reward_cards() is %, the payer pays %',
      public._referral_reward_cards(), v_pay;
  end if;

  if public._bonus_bytes_label(536870912)      is distinct from '0.5GB'
     or public._bonus_bytes_label(1073741824)    is distinct from '1GB'
     or public._bonus_bytes_label(1610612736)    is distinct from '1.5GB'
     or public._bonus_bytes_label(1099511627776) is distinct from '1TB'
     or public._bonus_bytes_label(0)             is distinct from '0GB' then
    raise exception '0863: _bonus_bytes_label does not read as the app does';
  end if;

  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.referrals'::regclass
                    and tgname = 'referrals_reward_notice'
                    and not tgisinternal) then
    raise exception '0863: referrals_reward_notice is missing';
  end if;

  if position('''email_invite_reward''' in
              pg_get_functiondef('public.email_unsubscribe(text,text)'::regprocedure)) = 0 then
    raise exception '0863: email_unsubscribe does not know email_invite_reward';
  end if;

  if has_function_privilege('anon', 'public._outbound_gate(text,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public._outbound_gate(text,text,jsonb)', 'execute') then
    raise exception '0863: _outbound_gate is client-callable';
  end if;
  if has_function_privilege('anon', 'public.check_security_invariants()', 'execute')
     or has_function_privilege('authenticated', 'public.check_security_invariants()', 'execute') then
    raise exception '0863: check_security_invariants is client-callable';
  end if;
  if position('''invite_reward''' in (select p.prosrc from pg_proc p
                                       where p.oid = 'public._outbound_gate(text,text,jsonb)'::regprocedure)) = 0 then
    raise exception '0863: _outbound_gate does not classify invite_reward';
  end if;
  if position('''_tg_referral_reward_notice''' in (select p.prosrc from pg_proc p
                                                    where p.oid = 'public.check_security_invariants()'::regprocedure)) = 0 then
    raise exception '0863: check_security_invariants does not list _tg_referral_reward_notice';
  end if;
end $$;
