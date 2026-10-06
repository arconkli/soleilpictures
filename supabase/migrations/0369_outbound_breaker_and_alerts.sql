-- 0369 — the outbound breaker: every email the database sends is counted,
-- capped, held when it looks like abuse, and a person hears about it within
-- minutes.
--
-- On 2026-09-20 one throwaway account mailed a phishing lure to well over a
-- thousand strangers through the invite path in minutes, and nobody found out
-- for two weeks. 0358 capped a single account. The 2026-10-06 audit found what was
-- still missing:
--
--   - nothing could page a human: the only alerts were rows on /admin, written
--     once a day;
--   - nothing bounded a fleet of throwaway accounts: the cap was per account;
--   - nothing stood at the one place every database email passes through.
--
-- What this adds, at that one place (public._notify_email — the six email
-- triggers all call it, and inside a trigger auth.uid() is still the acting
-- user, so a future notification path is covered without being wired):
--
--   1. ops_alerts, and a dispatcher that emails the owner within a minute
--      (send-transactional-email's new ops_alert template, from the clusters.
--      domain, to a fixed address the request cannot change). It ships OFF
--      (app_config ops_alert_dispatch.enabled) and is switched on once that
--      template is deployed. _discovery_alert's email-health rules now page too.
--
--   2. outbound_ledger: one row per email — who, what, a hash of the
--      recipient, and whether it went, was held, or was dropped.
--
--   3. _outbound_gate, consulted before every send:
--        stranger mail (pending_invite, board_shared, workspace_invite — the
--        sender chose the recipient):
--          - 10 in 10 minutes pages (an early warning, nothing held);
--          - 30 in an hour or 60 in a day trips a GLOBAL hold on stranger mail,
--            pages, and puts every account under 72 hours old that sent
--            stranger mail in the last hour on a sending hold (a fleet of
--            throwaway accounts never trips a per-account cap);
--          - an account sending more than its invite budget allows (20 a day,
--            5 on its first — the budget lives in _invite_budget_take) can only
--            be using a path the budget missed: hold, sending hold, page;
--          - one recipient gets at most 3 a day across all senders.
--        member mail (mentions, replies, schedule updates, "X joined"):
--          - only to people who have opened the app (a user_presence row;
--            every real user has one, the never-used accounts link scanners
--            "signed in" to do not);
--          - at most 30 an hour per sender and 10 a day per recipient; no
--            global hold, which would let an attacker stop everyone's mail.
--        Anything that errors inside the gate holds. Held mail is never sent
--        on its own: an admin releases or drops it, and after 7 days it expires.
--        Calibration: every threshold sits well above anything real use has
--        produced, and far below the 09-20 blast's 100-200 a minute.
--
--   4. A sending hold (profiles.send_hold_at): the account cannot share or
--      invite (checked in _invite_budget_take, which both invite paths call
--      before anything is written), its mentions notify nobody, its mail is
--      held, and the owner is paged. It changes nothing else about the account.
--
--   5. 0370 adds the controls around it: admin RPCs (release or drop held
--      mail, lift the global hold, hold or release an account, send a test
--      alert), the background checks, and a weekly heartbeat email that says
--      the breaker is armed — if Monday's never comes, the alert path is broken.
--
-- Also: mention and reply emails get a one-click unsubscribe, which both
-- unsubscribe allowlists (here and the Worker's UNSUB_KEYS) now accept.

begin;

-- ── 1. Alerts that reach a person ───────────────────────────────────────────

create table if not exists public.ops_alerts (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  kind            text not null,
  dedupe_key      text,
  title           text not null,
  body            text not null default '',
  actor           uuid,
  page            boolean not null default false,
  paged_at        timestamptz,
  page_attempts   integer not null default 0,
  last_attempt_at timestamptz,
  acked_at        timestamptz,
  acked_by        uuid
);
alter table public.ops_alerts enable row level security;
revoke all on table public.ops_alerts from public, anon, authenticated;
create index if not exists ops_alerts_recent_idx  on public.ops_alerts (created_at desc);
create index if not exists ops_alerts_dedupe_idx  on public.ops_alerts (dedupe_key, created_at desc) where dedupe_key is not null;
create index if not exists ops_alerts_unpaged_idx on public.ops_alerts (created_at) where page and paged_at is null;

insert into public.app_config (key, value)
values ('ops_alert_dispatch', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;

create or replace function public.ops_alert_raise(
  p_kind          text,
  p_title         text,
  p_body          text     default '',
  p_page          boolean  default false,
  p_dedupe_key    text     default null,
  p_dedupe_window interval default interval '1 hour',
  p_actor         uuid     default null
)
returns bigint
language plpgsql security definer
set search_path = public as $$
declare
  v_id bigint;
begin
  if p_dedupe_key is not null and exists (
       select 1 from public.ops_alerts a
        where a.dedupe_key = p_dedupe_key and a.created_at > now() - p_dedupe_window) then
    return null;
  end if;
  insert into public.ops_alerts (kind, dedupe_key, title, body, actor, page)
  values (left(p_kind, 40), p_dedupe_key, left(coalesce(p_title, ''), 200),
          left(coalesce(p_body, ''), 4000), p_actor, coalesce(p_page, false))
  returning id into v_id;
  return v_id;
end;
$$;

-- Runs every minute. send-transactional-email stamps paged_at when Resend
-- accepts the message; until then a row is retried every 2 minutes, 6 times.
create or replace function public.ops_alert_dispatch()
returns integer
language plpgsql security definer
set search_path = public, vault, net as $$
declare
  v_token text;
  v_url   text := 'https://ehlhlmbpwwalmeisvmdp.supabase.co/functions/v1/send-transactional-email';
  v_n     integer := 0;
  r       record;
begin
  if coalesce((select (value->>'enabled')::boolean from public.app_config where key = 'ops_alert_dispatch'), false) is not true then
    return 0;
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'edge_email_token' limit 1;
  if v_token is null or v_token = 'CHANGE_ME' then
    return 0;
  end if;
  for r in
    select a.id, a.kind, a.title, a.body, a.created_at
      from public.ops_alerts a
     where a.page and a.paged_at is null and a.page_attempts < 6
       and (a.last_attempt_at is null or a.last_attempt_at < now() - interval '2 minutes')
     order by a.created_at
     limit 10
  loop
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
      body    := jsonb_build_object(
                   'template', 'ops_alert',
                   'to',       'owner@clusters.soleilpictures.com',
                   'data',     jsonb_build_object('alertId', r.id, 'kind', r.kind, 'title', r.title,
                                                  'body', r.body, 'createdAt', r.created_at)),
      timeout_milliseconds := 5000
    );
    update public.ops_alerts set page_attempts = page_attempts + 1, last_attempt_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ── 2. The ledger, the global hold, the sending hold ────────────────────────

create table if not exists public.outbound_ledger (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  actor          uuid,
  template       text not null,
  risk           text not null check (risk in ('stranger', 'member', 'system')),
  recipient_hash text not null,
  state          text not null check (state in ('sent', 'held', 'released', 'dropped', 'expired')),
  reason         text,
  payload        jsonb,
  released_at    timestamptz,
  released_by    uuid
);
alter table public.outbound_ledger enable row level security;
revoke all on table public.outbound_ledger from public, anon, authenticated;
create index if not exists outbound_ledger_risk_recent_idx  on public.outbound_ledger (risk, created_at desc);
create index if not exists outbound_ledger_actor_recent_idx on public.outbound_ledger (actor, created_at desc) where actor is not null;
create index if not exists outbound_ledger_recipient_idx    on public.outbound_ledger (recipient_hash, created_at desc);
create index if not exists outbound_ledger_held_idx         on public.outbound_ledger (created_at) where state = 'held';

create table if not exists public.outbound_breaker (
  id                int primary key check (id = 1),
  global_hold_since timestamptz,
  reason            text,
  released_at       timestamptz,
  released_by       uuid
);
alter table public.outbound_breaker enable row level security;
revoke all on table public.outbound_breaker from public, anon, authenticated;
insert into public.outbound_breaker (id) values (1) on conflict (id) do nothing;

insert into public.app_config (key, value)
values ('outbound_breaker', jsonb_build_object(
  'stranger_warn_10min',    10,
  'stranger_hold_hour',     30,
  'stranger_hold_day',      60,
  'recipient_stranger_day', 3,
  'member_actor_hour',      30,
  'member_recipient_day',   10,
  'new_account_hours',      72,
  'budget_slack',           2))
on conflict (key) do nothing;

-- Not client-writable: profiles grants UPDATE on four presentation columns only.
alter table public.profiles add column if not exists send_hold_at     timestamptz;
alter table public.profiles add column if not exists send_hold_reason text;
alter table public.pending_invites add column if not exists held_at timestamptz;
alter table public.email_sends add column if not exists actor_id uuid;

-- The same inbox, however it is written: case, +tags, and Gmail's dots.
create or replace function public._outbound_recipient_key(p_email text)
returns text
language plpgsql immutable
set search_path = public as $$
declare
  v_local  text := lower(split_part(coalesce(p_email, ''), '@', 1));
  v_domain text := lower(split_part(coalesce(p_email, ''), '@', 2));
begin
  v_local := split_part(v_local, '+', 1);
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;
  return md5(v_local || '@' || v_domain);
end;
$$;

-- Active and not on a sending hold. Used inside definer functions only.
create or replace function public._actor_can_send()
returns boolean
language sql stable security definer
set search_path = public as $$
  select public._actor_active()
     and not exists (select 1 from public.profiles p
                      where p.user_id = auth.uid() and p.send_hold_at is not null);
$$;

create or replace function public._hold_sending(p_user uuid, p_reason text, p_source text)
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_email text;
begin
  if p_user is null then return false; end if;
  update public.profiles
     set send_hold_at = now(), send_hold_reason = left(coalesce(p_reason, p_source), 300)
   where user_id = p_user and send_hold_at is null;
  if not found then return false; end if;
  -- Invitations already in strangers' inboxes stop converting (0371 gates
  -- the claim paths on this).
  update public.pending_invites set held_at = now()
   where invited_by = p_user and claimed_at is null and held_at is null;
  select email into v_email from auth.users where id = p_user;
  perform public.ops_alert_raise(
    'hold',
    'Sharing paused for ' || coalesce(v_email, p_user::text),
    coalesce(p_reason, '') || E'\n\nSource: ' || coalesce(p_source, 'unknown')
      || E'\nThe account can still use its own clusters. Release or ban it from the Security tab.',
    true, 'hold:' || p_user, interval '24 hours', p_user);
  return true;
end;
$$;

-- The fleet signature: new accounts that sent stranger mail in the last hour.
create or replace function public._hold_new_senders(p_hours integer)
returns integer
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_n integer := 0;
  r   record;
begin
  for r in
    select distinct l.actor
      from public.outbound_ledger l
      join auth.users u on u.id = l.actor
     where l.risk = 'stranger' and l.actor is not null
       and l.created_at > now() - interval '1 hour'
       and u.created_at > now() - make_interval(hours => p_hours)
  loop
    if public._hold_sending(r.actor, 'a new account sending invitations when the outbound breaker tripped', 'breaker') then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- ── 3. The gate ─────────────────────────────────────────────────────────────

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
    when p_template in ('pending_invite', 'board_shared', 'workspace_invite') then 'stranger'
    when p_template in ('mention_email', 'comment_reply_email', 'schedule_update', 'invite_accepted') then 'member'
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

-- The send itself: the pre-0369 body, plus who sent it.
create or replace function public._notify_email_send(p_template text, p_to text, p_data jsonb, p_actor uuid default null)
returns void
language plpgsql security definer
set search_path = public, vault, net as $$
declare
  v_token text;
  v_url   text := 'https://ehlhlmbpwwalmeisvmdp.supabase.co/functions/v1/send-transactional-email';
begin
  if p_to is null or p_to = '' then return; end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'edge_email_token'
  limit 1;

  if v_token is null or v_token = 'CHANGE_ME' then
    raise warning '_notify_email_send: vault secret edge_email_token not configured; skipping email %', p_template;
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body    := jsonb_build_object('template', p_template, 'to', p_to, 'data', p_data, 'actorId', p_actor),
    timeout_milliseconds := 5000
  );
exception when others then
  raise warning '_notify_email_send failed for template %: %', p_template, sqlerrm;
end;
$$;

create or replace function public._notify_email(p_template text, p_to text, p_data jsonb default '{}'::jsonb)
returns void
language plpgsql security definer
set search_path = public, vault, net as $$
begin
  if p_to is null or p_to = '' then return; end if;
  -- 0369: every database email asks the gate first.
  if public._outbound_gate(p_template, p_to, p_data) <> 'send' then
    return;
  end if;
  perform public._notify_email_send(p_template, p_to, p_data, auth.uid());
exception when others then
  raise warning '_notify_email failed for template %: %', p_template, sqlerrm;
end;
$$;

-- ── 4. A sending hold reaches the invite paths and mentions ─────────────────

create or replace function public._invite_budget_take()
returns void
language plpgsql security definer
set search_path = public, auth as $$
declare
  c_invite_daily_limit     constant integer := 20;
  c_invite_first_day_limit constant integer := 5;
  v_uid     uuid := auth.uid();
  v_created timestamptz;
  v_limit   integer;
  v_used    integer;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- 0369: an account on a sending hold invites nobody. The phrase "invite
  -- limit reached" is what ShareModal recognises to stop its loop, so this
  -- refusal starts with it too.
  if exists (select 1 from public.profiles p where p.user_id = v_uid and p.send_hold_at is not null) then
    raise exception 'invite limit reached: sharing is paused on this account while we review unusual activity.'
      using errcode = 'P0001', hint = 'sending_on_hold';
  end if;

  -- Serialise one inviter's calls, so two concurrent invites cannot both read
  -- the count before either records its send.
  perform pg_advisory_xact_lock(hashtext('invite_budget:' || v_uid::text));

  select u.created_at into v_created from auth.users u where u.id = v_uid;
  v_limit := case when v_created > now() - interval '24 hours'
                  then c_invite_first_day_limit else c_invite_daily_limit end;

  select count(*) into v_used
    from public.invite_send_ledger l
   where l.inviter = v_uid and l.created_at > now() - interval '24 hours';

  -- The phrase "invite limit reached" is what ShareModal recognises to stop
  -- its per-address loop; keep it at the start of both messages.
  if v_used >= v_limit then
    if v_limit = c_invite_first_day_limit then
      raise exception 'invite limit reached: a new account can send % invitations on its first day. You can send more tomorrow.', v_limit
        using errcode = 'P0001', hint = 'invite_limit_reached';
    end if;
    raise exception 'invite limit reached: you can send % invitations a day. You can send more tomorrow.', v_limit
      using errcode = 'P0001', hint = 'invite_limit_reached';
  end if;

  insert into public.invite_send_ledger (inviter) values (v_uid);
  -- Rows older than the window are never read again.
  delete from public.invite_send_ledger
   where inviter = v_uid and created_at < now() - interval '48 hours';
end;
$$;

create or replace function public.notify_comment_mention(
  p_workspace_id uuid,
  p_board_id     uuid,
  p_card_id      text,
  p_thread_id    text,
  p_user_ids     uuid[],
  p_preview      text
)
returns integer
language plpgsql security definer
set search_path = public, auth as $$
declare
  c_max_recipients constant int := 20;
  c_max_per_hour   constant int := 30;
  v_actor  uuid := auth.uid();
  v_ws     uuid;
  v_recent int;
  v_count  int := 0;
begin
  if v_actor is null or p_board_id is null then
    return 0;
  end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return 0;
  end if;
  if not public._actor_active() then
    return 0;
  end if;
  -- 0369: nor does an account on a sending hold.
  if not public._actor_can_send() then
    return 0;
  end if;
  if not public.can_comment_board(p_board_id) then
    return 0;
  end if;

  -- 0364: the board's own workspace, whatever the caller passed.
  select b.workspace_id into v_ws
    from public.boards b
   where b.id = p_board_id and b.deleted_at is null;
  if v_ws is null then
    return 0;
  end if;

  -- 0364: one sender's calls are serialised so the hourly count can't be raced.
  perform pg_advisory_xact_lock(hashtext('mention_budget:' || v_actor::text));
  select count(*) into v_recent
    from public.mention_notifications m
   where m.mentioned_by = v_actor
     and m.created_at > now() - interval '1 hour';
  if v_recent >= c_max_per_hour then
    return 0;
  end if;

  insert into public.mention_notifications
    (user_id, message_id, workspace_id, board_id, mentioned_by,
     source_kind, source_card_id, source_thread_id, preview)
  select r.uid, null, v_ws, p_board_id, v_actor,
         'comment', p_card_id, p_thread_id, left(coalesce(p_preview, ''), 280)
    from (
      select distinct t.uid
        from unnest(p_user_ids) as t(uid)
       where t.uid is not null
         and t.uid <> v_actor
         and public._user_can_read_board(t.uid, p_board_id)
         and not exists (
               select 1 from public.mention_notifications m
                where m.user_id = t.uid
                  and m.mentioned_by = v_actor
                  and m.board_id = p_board_id
                  and m.source_thread_id is not distinct from p_thread_id
                  and m.created_at > now() - interval '10 minutes')
       limit least(c_max_recipients, c_max_per_hour - v_recent)
    ) r;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.messages_fire_mention_notifications()
returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  c_max_per_hour constant int := 30;
  v_recent int;
begin
  if new.mentions is null or array_length(new.mentions, 1) = 0 then
    return new;
  end if;
  if new.kind = 'system' then
    return new;
  end if;
  -- 0369: an account on a sending hold notifies nobody.
  if exists (select 1 from public.profiles p where p.user_id = new.sender_id and p.send_hold_at is not null) then
    return new;
  end if;

  -- 0364: at most 30 mention notifications per sender per hour.
  select count(*) into v_recent
    from public.mention_notifications m
   where m.mentioned_by = new.sender_id
     and m.created_at > now() - interval '1 hour';
  if v_recent >= c_max_per_hour then
    return new;
  end if;

  -- 0360: only active participants of this conversation (the only people who
  -- can read it) whom the sender can message, each once, at most 50.
  -- can_message reads auth.uid(), which the messages INSERT policy pins to
  -- new.sender_id. 0364: and the same person at most once per 10 minutes.
  insert into public.mention_notifications
    (user_id, message_id, workspace_id, conversation_id, mentioned_by)
  select r.uid, new.id, new.workspace_id, new.conversation_id, new.sender_id
    from (
      select distinct t.uid
        from unnest(new.mentions) as t(uid)
       where t.uid is not null
         and t.uid <> new.sender_id
         and exists (select 1 from public.conversation_participants cp
                      where cp.conversation_id = new.conversation_id
                        and cp.user_id = t.uid
                        and cp.left_at is null)
         and public.can_message(t.uid)
         and not exists (select 1 from public.mention_notifications m
                          where m.user_id = t.uid
                            and m.mentioned_by = new.sender_id
                            and m.conversation_id = new.conversation_id
                            and m.created_at > now() - interval '10 minutes')
       limit least(50, c_max_per_hour - v_recent)
    ) r;
  return new;
end;
$$;

-- ── One-click unsubscribe for mention and reply emails ──────────────────────

create or replace function public.email_unsubscribe(p_token text, p_key text default 'email_lifecycle')
returns boolean
language plpgsql security definer
set search_path = public as $$
declare v_uid uuid;
begin
  -- 0369: mentions and comment replies get a one-click link too. Keep this
  -- list in step with UNSUB_KEYS in boards/src/worker.js.
  if p_key not in ('email_lifecycle', 'email_schedule', 'email_share_activity',
                   'email_mentions', 'email_comment_replies') then
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

-- The two email triggers pass the recipient's own unsubscribe token. The
-- bodies are 0364's, unchanged apart from that one field.

create or replace function public._tg_mention_notification_email()
returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  v_recipient_email text;
  v_mentioner_name  text;
  v_message_body    text;
  v_message_preview text;
  v_board_name      text;
  v_workspace_name  text;
  v_surface         text;
  v_surface_context text;
begin
  if new.mentioned_by is null or new.mentioned_by = new.user_id then
    return new;
  end if;
  if public._is_user_online(new.user_id) then
    return new;
  end if;
  if not public._email_pref_enabled(new.user_id, 'email_mentions') then
    return new;
  end if;
  -- 0364: the in-app notification stands, but one person's mentions reach the
  -- same inbox at most 5 times a day.
  if (select count(*) from public.mention_notifications m
       where m.user_id = new.user_id
         and m.mentioned_by = new.mentioned_by
         and m.id <> new.id
         and m.created_at > now() - interval '24 hours') >= 5 then
    return new;
  end if;

  select email into v_recipient_email from auth.users where id = new.user_id;
  if v_recipient_email is null then return new; end if;

  select coalesce(nullif(p.display_name, ''), u.email, 'Someone on Clusters')
  into v_mentioner_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = new.mentioned_by;

  -- A message body is readable from Postgres; a comment body is not (Yjs), so
  -- comment rows carry their own preview.
  if new.source_kind = 'comment' then
    v_message_preview := coalesce(new.preview, '');
  else
    select body into v_message_body from public.messages where id = new.message_id;
    v_message_preview := case
      when v_message_body is null then ''
      when length(v_message_body) > 140 then substring(v_message_body, 1, 140) || '…'
      else v_message_body
    end;
  end if;

  -- Surface. The previous version branched on new.dm_peer_id, a column 0058
  -- dropped — which made this block throw at runtime. DM now comes from
  -- conversation_id.
  if new.board_id is not null then
    v_surface := 'board';
    select b.name, w.name into v_board_name, v_workspace_name
    from public.boards b
    left join public.workspaces w on w.id = b.workspace_id
    where b.id = new.board_id;
    v_surface_context := coalesce(v_board_name, 'a board')
                      || coalesce(' in ' || v_workspace_name, '');
  elsif new.conversation_id is not null then
    v_surface := 'dm';
    v_surface_context := 'a direct message';
  else
    v_surface := 'workspace';
    select name into v_workspace_name from public.workspaces where id = new.workspace_id;
    v_surface_context := coalesce(v_workspace_name, 'your workspace');
  end if;

  perform public._notify_email(
    'mention_email',
    v_recipient_email,
    jsonb_build_object(
      'mentionerName',  v_mentioner_name,
      'surface',        v_surface,
      'surfaceContext', v_surface_context,
      'messagePreview', v_message_preview,
      'workspaceId',    new.workspace_id::text,
      'boardId',        new.board_id::text,
      -- 0369: the recipient's own one-click unsubscribe.
      'unsubscribeToken', (select t.token from public.email_unsub_tokens t where t.user_id = new.user_id)
    )
  );
  return new;
end;
$$;

create or replace function public._tg_comment_reply_email()
returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  v_parent_author    uuid;
  v_recipient_email  text;
  v_replier_name     text;
  v_reply_preview    text;
  v_board_name       text;
  v_workspace_name   text;
  v_workspace_id     uuid;
begin
  if new.reply_to is null or new.author is null then return new; end if;

  select author into v_parent_author from public.comments where id = new.reply_to;
  if v_parent_author is null or v_parent_author = new.author then
    return new;
  end if;

  if public._is_user_online(v_parent_author) then
    return new;
  end if;

  if not public._email_pref_enabled(v_parent_author, 'email_comment_replies') then
    return new;
  end if;

  -- 0364: one person's replies reach the same inbox at most 5 times a day.
  if (select count(*) from public.comments c
        join public.comments p on p.id = c.reply_to
       where c.author = new.author
         and p.author = v_parent_author
         and c.id <> new.id
         and c.created_at > now() - interval '24 hours') >= 5 then
    return new;
  end if;

  select email into v_recipient_email
  from auth.users where id = v_parent_author;
  if v_recipient_email is null then return new; end if;

  select coalesce(nullif(p.display_name, ''), u.email, 'Someone on Clusters')
  into v_replier_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = new.author;

  v_reply_preview := case
    when new.body is null then ''
    when length(new.body) > 140 then substring(new.body, 1, 140) || '…'
    else new.body
  end;

  select b.name, w.name, b.workspace_id
  into v_board_name, v_workspace_name, v_workspace_id
  from public.boards b
  left join public.workspaces w on w.id = b.workspace_id
  where b.id = new.board_id;

  perform public._notify_email(
    'comment_reply_email',
    v_recipient_email,
    jsonb_build_object(
      'replierName',   v_replier_name,
      'boardName',     coalesce(v_board_name, 'a board'),
      'workspaceName', coalesce(v_workspace_name, 'your workspace'),
      'replyPreview',  v_reply_preview,
      'workspaceId',   v_workspace_id::text,
      'boardId',       new.board_id::text,
      -- 0369: the recipient's own one-click unsubscribe.
      'unsubscribeToken', (select t.token from public.email_unsub_tokens t where t.user_id = v_parent_author)
    )
  );

  return new;
end;
$$;

-- ── 5. Email-health alerts page too ─────────────────────────────────────────

create or replace function public._discovery_alert(p_name text, p_message text)
returns boolean
language plpgsql security definer
set search_path = public as $$
begin
  -- 0364: only server-written rows count (clients can no longer insert this
  -- kind), and a row from the future is never "already fired".
  if exists (select 1 from public.client_errors
              where kind = 'discovery_pipeline' and name = p_name
                and occurred_at > now() - interval '20 hours'
                and occurred_at <= now() + interval '5 minutes') then
    return false;
  end if;
  insert into public.client_errors (kind, name, message, path)
  values ('discovery_pipeline', left(p_name, 120), left(p_message, 500), '/discovery-pipelines');
  -- 0369: the email-health rules reach a person, not only /admin. The SEO
  -- pipeline rules stay on /admin (they are not urgent and would be noise).
  perform public.ops_alert_raise('email_health', p_name, p_message,
    p_name in ('App email volume spike', 'Sign-in email bounces spiked',
               'Sign-in email opens collapsed', 'Sign-in email rows missing'),
    'discovery:' || p_name, interval '20 hours');
  return true;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────

revoke execute on function public.ops_alert_raise(text, text, text, boolean, text, interval, uuid) from public, anon, authenticated;
revoke execute on function public.ops_alert_dispatch() from public, anon, authenticated;
revoke execute on function public._outbound_recipient_key(text) from public, anon, authenticated;
revoke execute on function public._actor_can_send() from public, anon, authenticated;
revoke execute on function public._hold_sending(uuid, text, text) from public, anon, authenticated;
revoke execute on function public._hold_new_senders(integer) from public, anon, authenticated;
revoke execute on function public._outbound_gate(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public._notify_email_send(text, text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public._notify_email(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public._invite_budget_take() from public, anon, authenticated;

-- ── Proofs ──────────────────────────────────────────────────────────────────

do $$
declare
  v_fn  text;
  v_src text;
begin
  foreach v_fn in array array[
    'public.ops_alert_raise(text,text,text,boolean,text,interval,uuid)', 'public.ops_alert_dispatch()',
    'public._outbound_recipient_key(text)', 'public._actor_can_send()', 'public._hold_sending(uuid,text,text)',
    'public._hold_new_senders(integer)', 'public._outbound_gate(text,text,jsonb)',
    'public._notify_email_send(text,text,jsonb,uuid)', 'public._notify_email(text,text,jsonb)',
    'public._invite_budget_take()'] loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0369: % is client-executable', v_fn;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.ops_alerts', 'select')
     or has_table_privilege('authenticated', 'public.outbound_ledger', 'select')
     or has_table_privilege('anon', 'public.outbound_ledger', 'select') then
    raise exception '0369: a client can read the alert or ledger tables';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'send_hold_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'send_hold_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.pending_invites', 'held_at', 'UPDATE') then
    raise exception '0369: a client can lift its own sending hold';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public._notify_email(text,text,jsonb)'::regprocedure;
  if position('_outbound_gate' in v_src) = 0 then
    raise exception '0369: _notify_email does not ask the gate';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public._invite_budget_take()'::regprocedure;
  if position('send_hold_at' in v_src) = 0 or position('c_invite_daily_limit     constant integer := 20' in v_src) = 0 then
    raise exception '0369: _invite_budget_take lost its hold check or its documented limits';
  end if;
end $$;

commit;
