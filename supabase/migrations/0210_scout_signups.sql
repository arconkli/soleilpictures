-- Soleil Scout — the landing-page phone box, and the queue that drains it.
--
-- /scout asks for a phone number and Scout texts you first. That single
-- sentence carries three risks this schema exists to bound:
--
--   1. It is a PUBLIC, UNAUTHENTICATED endpoint whose side effect is a text
--      message to an arbitrary phone number. Left open, it is a free SMS
--      cannon pointed at anyone. Every cap below is about that.
--   2. Sending the first message to someone who has never messaged us is, to
--      a carrier and to Photon, indistinguishable from cold outreach unless
--      we can show consent. So consent is a stored column, not a caption.
--   3. Photon flags lines for BURST sending and allows ~50 new conversations
--      per line per day. A queue that the bot drains at its own pace is
--      therefore the correct shape — not a synchronous send at submit time.
--
-- Why a queue rather than the Worker calling the bot: scout/fly.toml has no
-- [http_service] on purpose (Scout holds an outbound gRPC stream and accepts no
-- inbound HTTP). A table means no public surface on the bot, no new shared
-- secret, and a signup that survives the bot being down — the row simply waits.
--
-- Security posture matches 0206: RLS enabled, NO policies, so authenticated and
-- anon are denied outright and only service_role (which bypasses RLS) can read.
-- That matters more here than anywhere else in the product — this table is a
-- list of phone numbers.

-----------------------------------------------------------------------
-- 1. scout_signups — one row per phone number, ever.
--
--    The unique index is load-bearing, not hygiene: it is what makes a
--    double-submit (or a refresh, or someone hammering the button) incapable
--    of producing a second text message.
-----------------------------------------------------------------------
create table if not exists public.scout_signups (
  id               uuid primary key default gen_random_uuid(),
  -- E.164, normalized by lib/phone.js — THE SAME function the bot uses on the
  -- handle Photon reports. If these two ever disagree, the invite lands on a
  -- row that the person's inbound message will never match, and they get a
  -- second account instead of the one waiting for them.
  phone_e164       text not null unique,
  status           text not null default 'pending'
                     check (status in ('pending', 'sent', 'failed', 'blocked')),

  -- Consent, recorded rather than assumed. `consent_version` pins WHICH wording
  -- they agreed to, so a later copy change doesn't retroactively rewrite what
  -- past signups were told.
  consent_at       timestamptz not null default now(),
  consent_version  text not null default 'v1',

  -- HMAC of the client IP, never the IP. Enough to rate-limit, useless as a
  -- record of who was where — consistent with the country-capture work (0203),
  -- which deliberately retains no addresses.
  ip_hash          text,
  country          text,
  utm              jsonb not null default '{}'::jsonb,
  source           text,

  -- Delivery bookkeeping. `attempts` exists so a permanently undeliverable
  -- number stops being retried instead of burning the daily allowance forever.
  attempts         int not null default 0,
  sent_at          timestamptz,
  last_error       text,
  -- Set once the person actually texts back and an account is minted.
  user_id          uuid references auth.users(id) on delete set null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.scout_signups enable row level security;
-- Deliberately NO policies: service_role bypasses RLS, everyone else is denied.

-- The drain's hot path: oldest pending first.
create index if not exists scout_signups_pending_idx
  on public.scout_signups (created_at)
  where status = 'pending';

-- The per-IP rate check.
create index if not exists scout_signups_ip_recent_idx
  on public.scout_signups (ip_hash, created_at);

-----------------------------------------------------------------------
-- 2. Daily cap. 40, under Photon's documented ~50 new conversations per
--    line per day — exceeding that risks the line being flagged, and a
--    flagged line means Scout has no channel at all (there is no second
--    one; Telegram was dropped from v1).
-----------------------------------------------------------------------
insert into public.app_config (key, value)
values ('scout_invite_daily_max', jsonb_build_object('max', 40))
on conflict (key) do nothing;

-----------------------------------------------------------------------
-- 3. scout_request_invite — the landing page's write path.
--
--    Returns the status the caller should SHOW. It never raises for an
--    ordinary refusal: a rate-limited or over-cap submission still leaves the
--    person on the list, and telling them "you're in" is true. The only thing
--    that changes is when the text goes out.
-----------------------------------------------------------------------
create or replace function public.scout_request_invite(
  p_phone    text,
  p_source   text default null,
  p_ip_hash  text default null,
  p_country  text default null,
  p_utm      jsonb default '{}'::jsonb,
  p_consent_version text default 'v1'
)
returns table (status text, is_new boolean, queued_ahead int)
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_existing public.scout_signups%rowtype;
  v_daily_max int;
  v_sent_today int;
  v_ip_recent int;
  v_status text;
  v_new boolean := false;
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'a valid phone number is required' using errcode = '22023';
  end if;

  -- Already known? Return what's true for them and send nothing more. This is
  -- the double-submit guard, and it is checked BEFORE any rate limit so an
  -- existing signup refreshing the page always gets a coherent answer.
  -- NOTE the alias. `status`, `is_new` and `queued_ahead` are OUT parameters of
  -- this function, so an UNQUALIFIED reference to a column of the same name is
  -- ambiguous and Postgres refuses to run the query at all. Every column
  -- reference below is qualified for that reason, not for style.
  select * into v_existing from public.scout_signups s where s.phone_e164 = p_phone;
  if found then
    return query select v_existing.status, false,
      (select count(*)::int from public.scout_signups s
        where s.status = 'pending' and s.created_at < v_existing.created_at);
    return;
  end if;

  -- Per-IP: at most 3 DISTINCT numbers in an hour. Someone signing up their
  -- whole crew from one trailer is real and fine; someone enumerating numbers
  -- is not, and 3/hour makes that pointless without inconveniencing the crew.
  if p_ip_hash is not null then
    select count(*) into v_ip_recent
    from public.scout_signups s
    where s.ip_hash = p_ip_hash and s.created_at > now() - interval '1 hour';
    if v_ip_recent >= 3 then
      raise exception 'too many requests from this address' using errcode = '53400';
    end if;
  end if;

  insert into public.scout_signups (phone_e164, source, ip_hash, country, utm, consent_version)
  values (p_phone, p_source, p_ip_hash, p_country, coalesce(p_utm, '{}'::jsonb), p_consent_version)
  returning * into v_existing;
  v_new := true;

  -- Over the daily allowance the row simply waits — it is NOT an error, and the
  -- caller must not be told a message went out.
  select coalesce((c.value ->> 'max')::int, 40) into v_daily_max
  from public.app_config c where c.key = 'scout_invite_daily_max';
  select count(*) into v_sent_today
  from public.scout_signups s where s.sent_at > now() - interval '24 hours';

  v_status := v_existing.status;

  begin
    insert into public.analytics_events (user_id, event, props)
    values (null, 'scout_signup_requested',
            jsonb_build_object(
              'source', p_source,
              'country', p_country,
              'over_daily_cap', v_sent_today >= coalesce(v_daily_max, 40),
              'utm', coalesce(p_utm, '{}'::jsonb)));
  exception when others then null;
  end;

  return query select v_status, v_new,
    (select count(*)::int from public.scout_signups s
      where s.status = 'pending' and s.created_at < v_existing.created_at);
end;
$$;
revoke all on function public.scout_request_invite(text, text, text, text, jsonb, text) from public;
revoke all on function public.scout_request_invite(text, text, text, text, jsonb, text) from authenticated, anon;

-----------------------------------------------------------------------
-- 4. scout_claim_invites — the drain side.
--
--    Claims by bumping `attempts` and stamping the row, so two bot processes
--    (or a restart mid-send) can't both send to the same number. Enforces the
--    daily cap HERE as well as at request time, because that is the check that
--    actually protects the Photon line: the request path only knows what was
--    true when someone typed their number in.
-----------------------------------------------------------------------
create or replace function public.scout_claim_invites(p_limit int default 5)
returns table (id uuid, phone_e164 text, attempts int)
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_daily_max int;
  v_sent_today int;
  v_budget int;
begin
  select coalesce((c.value ->> 'max')::int, 40) into v_daily_max
  from public.app_config c where c.key = 'scout_invite_daily_max';
  v_daily_max := coalesce(v_daily_max, 40);

  select count(*) into v_sent_today
  from public.scout_signups s where s.sent_at > now() - interval '24 hours';

  v_budget := least(greatest(coalesce(p_limit, 5), 0), greatest(v_daily_max - v_sent_today, 0));
  if v_budget <= 0 then
    return;
  end if;

  return query
  with claimed as (
    select s.id
    from public.scout_signups s
    where s.status = 'pending'
      and s.attempts < 3
    order by s.created_at
    limit v_budget
    -- SKIP LOCKED so a second drain process takes different rows rather than
    -- blocking on the first one's transaction.
    for update skip locked
  )
  update public.scout_signups u
     set attempts = u.attempts + 1,
         updated_at = now()
    from claimed
   where u.id = claimed.id
  returning u.id, u.phone_e164, u.attempts;
end;
$$;
revoke all on function public.scout_claim_invites(int) from public;
revoke all on function public.scout_claim_invites(int) from authenticated, anon;

-----------------------------------------------------------------------
-- 5. scout_mark_invite_sent — outcome of one send attempt.
--
--    A row that has burned all 3 attempts goes to 'failed' rather than back to
--    'pending', so an unreachable number stops consuming the daily allowance
--    that working numbers need.
-----------------------------------------------------------------------
create or replace function public.scout_mark_invite_sent(
  p_id      uuid,
  p_ok      boolean,
  p_error   text default null
)
returns text
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_status text;
  v_attempts int;
begin
  select attempts into v_attempts from public.scout_signups where id = p_id;
  if not found then
    return null;
  end if;

  if p_ok then
    v_status := 'sent';
  elsif v_attempts >= 3 then
    v_status := 'failed';
  else
    v_status := 'pending';
  end if;

  update public.scout_signups
     set status     = v_status,
         sent_at    = case when p_ok then now() else sent_at end,
         last_error = case when p_ok then null else left(coalesce(p_error, 'unknown'), 500) end,
         updated_at = now()
   where id = p_id;

  begin
    insert into public.analytics_events (user_id, event, props)
    values (null, case when p_ok then 'scout_invite_sent' else 'scout_invite_send_failed' end,
            jsonb_build_object('attempts', v_attempts, 'status', v_status));
  exception when others then null;
  end;

  return v_status;
end;
$$;
revoke all on function public.scout_mark_invite_sent(uuid, boolean, text) from public;
revoke all on function public.scout_mark_invite_sent(uuid, boolean, text) from authenticated, anon;

-----------------------------------------------------------------------
-- 6. scout_link_signup_user — close the loop.
--
--    When someone we texted finally texts back, the ingest pipeline mints their
--    account and calls this. It is what turns the signups table from a list of
--    numbers into a measurable funnel: requested → sent → replied.
-----------------------------------------------------------------------
create or replace function public.scout_link_signup_user(
  p_phone   text,
  p_user_id uuid
)
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
begin
  update public.scout_signups
     set user_id = p_user_id, updated_at = now()
   where phone_e164 = p_phone and user_id is distinct from p_user_id;
  return found;
end;
$$;
revoke all on function public.scout_link_signup_user(text, uuid) from public;
revoke all on function public.scout_link_signup_user(text, uuid) from authenticated, anon;
