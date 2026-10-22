-- 0470_analytics_integrity.sql
--
-- Five holes in how the app keeps its own record (data-collection audit,
-- 2026-10-20). Each section says what was wrong and what is true after it.
--
-- 1. Time in app credits only its caller. bump_seconds_in_app is a definer
--    function anon may execute, and it credited seconds and a user_active_day
--    row, did_work included, to whatever p_user_id the client sent. A script
--    could mark any account active and move retention, time in app and the
--    lifecycle email's dormancy gates. p_user_id is now overwritten with
--    auth.uid() before anything reads it. The signature and grants are
--    unchanged, so the client in production keeps working, and a signed-out
--    call credits nothing, as it already did (0254 put every write behind
--    p_user_id). Revoking anon EXECUTE waits for the promote that carries
--    heartbeat.js's signed-out gate: production still calls it signed out
--    every minute.
--
-- 2. Every row records when it arrived. occurred_at is the device's clock;
--    received_at is the server's. The caller guard stamps it before its
--    server-role return, so every row gets one, and overwrites whatever a
--    client sends (table-level grants make every new column client-writable,
--    see 0204). Rows from before this migration keep NULL: their arrival was
--    never recorded.
--
-- 3. A row's country is its subject's. _tg_stamp_event_country ran as its
--    owner and fired last, so every row took the caller's country, including
--    server-fired rows about someone else (a referral reward is the
--    referrer's event, fired during the referee's request), and the divert
--    archived rows before it ran, with none. Now the guard stamps a client's
--    row from the request edge, as 0204 did, and the stamp trigger, renamed
--    to fire between the guard and the divert, fills only a country still
--    missing: the subject's last-seen country when the row names someone
--    other than the caller, else the caller's. A row with no requester and
--    no subject keeps NULL, as 0204 intended.
--
-- 4. The quarantine archive keeps the whole row. Its insert never named
--    app_session_id (the archive has the column), and now carries
--    received_at too. A failed archive write raises a warning instead of
--    losing the row in silence. Two new reasons divert, 'preview' and 'dev',
--    which the client marks on every row a preview deploy or a dev build
--    sends, so testing the next release stops counting as people using this
--    one.
--
-- 5. An account made on a preview deploy or a dev build is internal.
--    set_first_source receives the build's env alongside the first-touch
--    source. When it is 'preview' or 'dev' and the account is less than a day
--    old, the account joins internal_accounts, so every _internal_user_ids()
--    reader (signups, retention, the setup experiment's read) leaves it out.
--    The env is never stored in first_source, and an older account opening a
--    preview is untouched: it was made somewhere else. internal_accounts is
--    also who get_staging_redirect sends from production to the preview;
--    accounts that joined it this way are left off that, because the
--    redirect is for the team and such an account may be a tester's.
--
-- Checked before writing: no function returns analytics_events' columns
-- through a star, so the new column changes no reader's output.

begin;

set local lock_timeout = '3s';

-- ── 1. Time in app credits only its caller ──────────────────────────────────
-- The live body (0460) with one statement added at the top.

CREATE OR REPLACE FUNCTION public.bump_seconds_in_app(p_seconds integer, p_session_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_did_work boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now    timestamptz := now();
  v_sess   record;
  v_credit int;
  v_age    interval;
  v_uid    uuid;
  v_cc     text;
begin
  -- 0470: the caller's own account, whatever the client sent. The parameter
  -- stays so the client in production calls it unchanged.
  p_user_id := auth.uid();

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

  -- ADDED IN 0203: last-seen country
  v_uid := auth.uid();
  if v_uid is not null then
    v_cc := public.request_country();
    if v_cc is not null then
      update public.profiles set country = v_cc
       where user_id = v_uid and country is distinct from v_cc;
    end if;
  end if;

  if v_credit > 0 and p_user_id is not null then
    -- 0254: both writes are now inside the same guard, so the counter and the
    -- summed profile column cannot diverge again.
    update public.platform_counters set value = value + v_credit, updated_at = v_now where key = 'total_seconds_in_app';
    update public.profiles set seconds_in_app = seconds_in_app + v_credit where user_id = p_user_id;
    -- ADDED IN 0248: the day row carries whether it was work or presence.
    -- 0460: and the seconds it held, in the same statement, so time in app
    -- has a history and the heartbeat has no extra write.
    insert into public.user_active_day (user_id, day, did_work, work_ops, seconds)
      values (p_user_id, current_date, coalesce(p_did_work, false), case when p_did_work then 1 else 0 end, v_credit)
      on conflict (user_id, day) do update
        set did_work = public.user_active_day.did_work or excluded.did_work,
            work_ops = public.user_active_day.work_ops + excluded.work_ops,
            seconds  = public.user_active_day.seconds + excluded.seconds;
  end if;
  return v_credit;
end $function$;

-- ── 2 and 3. Arrival time, and the country of the row's subject ─────────────

alter table public.analytics_events add column if not exists received_at timestamptz;
alter table public.analytics_events alter column received_at set default now();
alter table public.analytics_events_synthetic add column if not exists received_at timestamptz;

-- 0385's guard with two statements added: received_at on every row, and a
-- client row's country from the request edge (moved here from the stamp).
create or replace function public._tg_event_caller_guard()
returns trigger
language plpgsql
set search_path = public as $$
begin
  new.received_at := now();
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  new.country := public.request_country();
  if new.occurred_at > now() + interval '5 minutes' then
    new.occurred_at := now();
  end if;
  if new.user_id is not null and new.user_id is distinct from auth.uid() then
    new.props := coalesce(new.props, '{}'::jsonb) || jsonb_build_object('synthetic_reason', 'uid_mismatch');
  elsif new.occurred_at < now() - interval '30 days' then
    new.props := coalesce(new.props, '{}'::jsonb) || jsonb_build_object('synthetic_reason', 'stale');
  end if;
  return new;
end;
$$;

-- Still a definer, so it can read the subject's profile whichever role
-- inserted the row. It no longer asks who the caller is, which inside a
-- definer is always the owner.
create or replace function public._tg_stamp_event_country()
returns trigger
language plpgsql
security definer
set search_path = public as $$
begin
  if new.country is null then
    if new.user_id is not null and new.user_id is distinct from auth.uid() then
      new.country := (select p.country from public.profiles p where p.user_id = new.user_id);
    else
      new.country := public.request_country();
    end if;
  end if;
  return new;
end $$;
revoke execute on function public._tg_stamp_event_country() from public, anon, authenticated;

-- BEFORE triggers fire in name order: guard, then stamp, then divert, so an
-- archived row carries its country.
do $$
begin
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.analytics_events'::regclass
                and tgname = 'analytics_events_stamp_country') then
    alter trigger analytics_events_stamp_country on public.analytics_events
      rename to analytics_events_b_stamp_country;
  end if;
end $$;

-- ── 4. The archive keeps the whole row, and takes preview and dev ───────────

CREATE OR REPLACE FUNCTION public._tg_divert_synthetic_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reason text;
begin
  if coalesce(new.props->>'synthetic', '') = 'true' then
    v_reason := 'qa_harness';
  elsif coalesce(new.props->>'is_bot', '') = 'true' then
    v_reason := 'bot_ua';
  elsif new.props->>'synthetic_reason' in ('uid_mismatch', 'stale', 'preview', 'dev') then
    -- uid_mismatch and stale are marked by _tg_event_caller_guard (0385);
    -- preview and dev by the client, on every row from a preview deploy or a
    -- dev build (0470).
    v_reason := new.props->>'synthetic_reason';
  else
    return new;
  end if;

  begin
    insert into public.analytics_events_synthetic
      (id, session_id, user_id, event, props, path, occurred_at, country,
       app_session_id, received_at, reason)
    values
      (new.id, new.session_id, new.user_id, new.event, new.props, new.path,
       new.occurred_at, new.country, new.app_session_id, new.received_at, v_reason);
  exception when others then
    -- Still dropped, because storing it is what this trigger exists to stop,
    -- but said, so a broken archive shows in the database log.
    raise warning '_tg_divert_synthetic_events: archive failed (%): %', sqlstate, sqlerrm;
  end;
  return null;
end $function$;
revoke execute on function public._tg_divert_synthetic_events() from public, anon, authenticated;

-- ── 5. Accounts made on a preview or dev build are internal ─────────────────

CREATE OR REPLACE FUNCTION public.set_first_source(p_source jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_cc  text;
  v_src jsonb := case when jsonb_typeof(p_source) = 'object' then p_source else '{}'::jsonb end;
  v_env text;
begin
  if v_uid is null then return; end if;

  -- 0470: which build the account is signing in on. It decides only whether
  -- a brand-new account is a test one, and is never stored.
  v_env := v_src->>'env';
  v_src := v_src - 'env';
  if v_env in ('preview', 'dev')
     and exists (select 1 from auth.users u
                  where u.id = v_uid and u.created_at > now() - interval '1 day') then
    insert into public.internal_accounts (user_id, reason)
    values (v_uid, v_env || '_signup')
    on conflict (user_id) do nothing;
  end if;

  v_cc := public.request_country();
  if v_cc is not null then
    update public.profiles
       set signup_country = coalesce(signup_country, v_cc),
           country        = v_cc
     where user_id = v_uid
       and (signup_country is null or country is distinct from v_cc);
  end if;

  if v_src = '{}'::jsonb then return; end if;

  update public.profiles
     set first_source = v_src
   where user_id = v_uid
     and (first_source is null or first_source = '{}'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.get_staging_redirect()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- 0470: not for accounts set_first_source made internal because they were
  -- made on a preview or dev build.
  select case
    when public.is_admin()
      or exists (select 1 from public.internal_accounts ia
                  where ia.user_id = auth.uid()
                    and coalesce(ia.reason, '') not in ('preview_signup', 'dev_signup'))
    then (select nullif(c.value->>'url', '') from public.app_config c where c.key = 'staging_url')
    else null
  end;
$function$;

-- ── Proofs ──────────────────────────────────────────────────────────────────

do $proof$
declare
  v_src  text;
  v_ins  text;
  v_col  record;
  v_fn   regprocedure;
  v_trgs text[];
begin
  -- 1. One bump_seconds_in_app, still callable signed in, crediting the caller.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'bump_seconds_in_app') <> 1 then
    raise exception '0470: bump_seconds_in_app has an overload';
  end if;
  select p.prosrc into v_src from pg_proc p
   where p.oid = 'public.bump_seconds_in_app(integer,uuid,uuid,boolean)'::regprocedure;
  if strpos(v_src, 'p_user_id := auth.uid();') = 0
     or strpos(v_src, 'p_user_id := auth.uid();') > strpos(v_src, 'insert into public.heartbeat_session') then
    raise exception '0470: bump_seconds_in_app does not take its caller before crediting';
  end if;
  if strpos(v_src, 'public.user_active_day.seconds + excluded.seconds') = 0 then
    raise exception '0470: bump_seconds_in_app lost 0460''s seconds';
  end if;
  if not has_function_privilege('authenticated', 'public.bump_seconds_in_app(integer,uuid,uuid,boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.bump_seconds_in_app(integer,uuid,uuid,boolean)', 'execute') then
    raise exception '0470: the heartbeat lost its grant';
  end if;

  -- 2 and 3. The guard runs as the caller and stamps arrival before any
  -- return; the stamp and the divert run as their owner; guard, stamp, divert.
  if (select p.prosecdef from pg_proc p where p.oid = 'public._tg_event_caller_guard()'::regprocedure) then
    raise exception '0470: the caller guard must run as the caller';
  end if;
  select p.prosrc into v_src from pg_proc p where p.oid = 'public._tg_event_caller_guard()'::regprocedure;
  if strpos(v_src, 'new.received_at := now();') = 0
     or strpos(v_src, 'new.received_at := now();') > strpos(v_src, 'current_user not in') then
    raise exception '0470: the guard does not stamp received_at on every row';
  end if;
  if strpos(v_src, 'new.country := public.request_country();') < strpos(v_src, 'current_user not in') then
    raise exception '0470: the guard does not stamp a client row''s country';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = 'public._tg_stamp_event_country()'::regprocedure)
     or not (select p.prosecdef from pg_proc p where p.oid = 'public._tg_divert_synthetic_events()'::regprocedure) then
    raise exception '0470: the stamp and the divert must run as their owner';
  end if;
  select array_agg(t.tgname::text order by t.tgname) into v_trgs
    from pg_trigger t
   where t.tgrelid = 'public.analytics_events'::regclass and not t.tgisinternal and t.tgenabled = 'O';
  if v_trgs is distinct from array['analytics_events_a_caller_guard', 'analytics_events_b_stamp_country',
                                   'analytics_events_divert_synthetic'] then
    raise exception '0470: analytics_events fires %, not guard, stamp, divert', v_trgs;
  end if;

  -- 4. The archive has every live column, typed the same, and the divert
  -- copies each one, so the next column added cannot silently stop archiving.
  select p.prosrc into v_src from pg_proc p where p.oid = 'public._tg_divert_synthetic_events()'::regprocedure;
  v_ins := substring(v_src from 'insert into public\.analytics_events_synthetic(.*?)exception when others');
  if v_ins is null then
    raise exception '0470: the divert has no archive insert';
  end if;
  for v_col in
    select a.attname::text as name, format_type(a.atttypid, a.atttypmod) as type
      from pg_attribute a
     where a.attrelid = 'public.analytics_events'::regclass and a.attnum > 0 and not a.attisdropped
  loop
    if not exists (select 1 from pg_attribute s
                    where s.attrelid = 'public.analytics_events_synthetic'::regclass
                      and s.attnum > 0 and not s.attisdropped
                      and s.attname = v_col.name
                      and format_type(s.atttypid, s.atttypmod) = v_col.type) then
      raise exception '0470: analytics_events_synthetic has no % %', v_col.name, v_col.type;
    end if;
    if v_ins !~ ('new\.' || v_col.name || '\M') then
      raise exception '0470: the divert does not archive %', v_col.name;
    end if;
  end loop;
  if strpos(v_src, '''synthetic_reason'' in (''uid_mismatch'', ''stale'', ''preview'', ''dev'')') = 0 then
    raise exception '0470: the divert does not take preview and dev rows';
  end if;

  -- 5. The callers keep their grants.
  if not has_function_privilege('anon', 'public.set_first_source(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_first_source(jsonb)', 'execute') then
    raise exception '0470: set_first_source lost a grant';
  end if;
  if has_function_privilege('anon', 'public.get_staging_redirect()', 'execute')
     or not has_function_privilege('authenticated', 'public.get_staging_redirect()', 'execute') then
    raise exception '0470: the grants on get_staging_redirect moved';
  end if;

  -- The trigger functions are not callable by a client (0311).
  foreach v_fn in array array[
    'public._tg_event_caller_guard()',
    'public._tg_stamp_event_country()',
    'public._tg_divert_synthetic_events()'
  ]::regprocedure[] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0470: a client can execute %', v_fn;
    end if;
  end loop;
end $proof$;

notify pgrst, 'reload schema';

commit;
