-- 0203_country_capture.sql
--
-- Capture visitor country server-side, from Cloudflare's cf-ipcountry header.
--
-- Supabase's API edge is Cloudflare, and it forwards cf-ipcountry into
-- PostgREST's request context, so `current_setting('request.headers')` carries
-- it on every client call — supabase-js inserts, the keepalive-fetch beacon and
-- the sendBeacon fallback alike. That makes country a SERVER-side fact: the
-- client never sends it and cannot forge it.
--
-- What this canNOT do: ensure_profile_for_new_user fires on auth.users inside
-- GoTrue's own database connection, which never sets request.headers. Country
-- is therefore unavailable at the instant of signup and is instead stamped on
-- the first PostgREST call the new user makes — same session, same IP, seconds
-- later. See set_first_source below.
--
-- Forward-only, permanently: auth.audit_log_entries retains no IP addresses, so
-- no historical country is recoverable for existing accounts by any means.

------------------------------------------------------------------
-- 1. request_country() — the one place the header is parsed.
------------------------------------------------------------------
-- STABLE, not IMMUTABLE: it reads session state.
-- The exception block is mandatory. This runs as a column DEFAULT, so any
-- context without a well-formed request.headers GUC — pg_cron, GoTrue
-- triggers, direct psql, the SQL editor — must yield NULL, never raise.
create or replace function public.request_country()
returns text
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_raw text;
  v_cc  text;
begin
  begin
    v_raw := current_setting('request.headers', true);
    if v_raw is null or v_raw = '' then return null; end if;
    v_cc := upper(nullif(trim((v_raw::jsonb) ->> 'cf-ipcountry'), ''));
  exception when others then
    return null;
  end;
  if v_cc is null or v_cc !~ '^[A-Z]{2}$' then return null; end if;
  -- Cloudflare's placeholders: XX = could not determine, T1 = Tor exit node.
  if v_cc in ('XX', 'T1') then return null; end if;
  return v_cc;
end $function$;

-- LOAD-BEARING: anon/authenticated evaluate this as the analytics_events
-- column default. Without EXECUTE, every event insert fails.
revoke all on function public.request_country() from public;
grant execute on function public.request_country() to anon, authenticated, service_role;

------------------------------------------------------------------
-- 2. analytics_events.country — stamped by default, never by the client.
------------------------------------------------------------------
alter table public.analytics_events add column if not exists country text;
alter table public.analytics_events alter column country set default public.request_country();

-- CORRECTION (see 0204): the original note here claimed a client could not
-- supply a country, on the belief that this table's INSERT privilege was
-- column-scoped. It is not — these are Supabase's default TABLE-level grants,
-- which extend to every column added later, so as applied this migration left
-- `country` forgeable. 0204 fixes it with a BEFORE INSERT trigger and drops
-- the default below. Do not rely on grants alone for this invariant.

-- No index. At ~17k events/30d and 27MB the existing occurred_at index carries
-- the admin queries; revisit if the table grows an order of magnitude.

------------------------------------------------------------------
-- 3. profiles.signup_country / profiles.country
------------------------------------------------------------------
-- signup_country = where they were when they signed up (written once).
-- country        = where they were most recently seen (refreshed on heartbeat).
-- Two columns because they answer two different questions, and conflating them
-- would silently relabel a returning user's current country as their origin.
alter table public.profiles add column if not exists signup_country text;
alter table public.profiles add column if not exists country        text;

------------------------------------------------------------------
-- 4. set_first_source — stamp signup_country on first sign-in.
------------------------------------------------------------------
-- The country stamp sits BEFORE the first_source guard and is independent of
-- it: a user whose client sent an empty first_source still gets a country.
-- signup_country uses coalesce() so it is written exactly once, ever, even
-- though the surrounding UPDATE re-runs whenever `country` changes.
create or replace function public.set_first_source(p_source jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_cc  text;
begin
  if v_uid is null then return; end if;

  v_cc := public.request_country();
  if v_cc is not null then
    update public.profiles
       set signup_country = coalesce(signup_country, v_cc),
           country        = v_cc
     where user_id = v_uid
       and (signup_country is null or country is distinct from v_cc);
  end if;

  if p_source is null or p_source = '{}'::jsonb then return; end if;

  update public.profiles
     set first_source = p_source
   where user_id = v_uid
     and (first_source is null or first_source = '{}'::jsonb);
end $function$;

------------------------------------------------------------------
-- 5. bump_seconds_in_app — refresh last-seen country.
------------------------------------------------------------------
-- Verbatim re-creation of the live 3-arg function with ONE addition (marked
-- below). This is the per-session heartbeat, so it is what backfills `country`
-- for accounts that predate this migration, as they return.
--
-- The country write keys off auth.uid(), NOT p_user_id. p_user_id is a
-- client-supplied parameter, so keying a profile write off it would let any
-- caller stamp another user's country.
--
-- signup_country is deliberately NOT touched here: stamping it on a heartbeat
-- would write a returning user's CURRENT country into a field labelled
-- "signup", which is false for every pre-existing account.
create or replace function public.bump_seconds_in_app(
  p_seconds    integer,
  p_session_id uuid default null,
  p_user_id    uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now    timestamptz := now();
  v_sess   record;
  v_credit int;
  v_age    interval;
  v_uid    uuid;
  v_cc     text;
begin
  if p_seconds is null or p_seconds <= 0 then return 0; end if;
  p_seconds := least(p_seconds, 60);

  if p_session_id is null then
    v_credit := least(p_seconds, 5);
  else
    insert into public.heartbeat_session (session_id, window_start, seconds_used, last_bumped_at)
      values (p_session_id, v_now, 0, v_now)
      on conflict (session_id) do nothing;
    select window_start, seconds_used into v_sess
      from public.heartbeat_session where session_id = p_session_id for update;
    v_age := v_now - v_sess.window_start;
    if v_age > interval '60 seconds' then
      v_credit := p_seconds;
      update public.heartbeat_session set window_start = v_now, seconds_used = v_credit, last_bumped_at = v_now where session_id = p_session_id;
    else
      v_credit := greatest(0, least(p_seconds, 60 - v_sess.seconds_used));
      if v_credit > 0 then
        update public.heartbeat_session set seconds_used = seconds_used + v_credit, last_bumped_at = v_now where session_id = p_session_id;
      end if;
    end if;
  end if;

  -- ── ADDED IN 0203: last-seen country ──────────────────────────────
  -- Outside the v_credit guard: a rate-limited heartbeat still tells us where
  -- the user is. Guarded by `is distinct from` so it writes only on change.
  v_uid := auth.uid();
  if v_uid is not null then
    v_cc := public.request_country();
    if v_cc is not null then
      update public.profiles set country = v_cc
       where user_id = v_uid and country is distinct from v_cc;
    end if;
  end if;
  -- ──────────────────────────────────────────────────────────────────

  if v_credit > 0 then
    update public.platform_counters set value = value + v_credit, updated_at = v_now where key = 'total_seconds_in_app';
    if p_user_id is not null then
      update public.profiles set seconds_in_app = seconds_in_app + v_credit where user_id = p_user_id;
      insert into public.user_active_day (user_id, day) values (p_user_id, current_date) on conflict (user_id, day) do nothing;
    end if;
  end if;
  return v_credit;
end $function$;

revoke all on function public.bump_seconds_in_app(integer, uuid, uuid) from public;
grant execute on function public.bump_seconds_in_app(integer, uuid, uuid) to anon, authenticated;
