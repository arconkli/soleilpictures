-- 0476 — a page served from this machine or the local network is a teammate,
-- never someone using Clusters (the data-collection pass, 2026-10-21).
--
-- 0470 had the client label its own rows: a dev build says 'dev', a preview
-- deploy says 'preview', and the divert trigger moves them out of the live
-- table. A production build served locally said neither. That is what
-- `vite preview`, a static server, a benchmark or a performance trace runs,
-- against the real project and signed out, so every row such a page sent landed
-- in the live table as a visitor. Many of them are unstamped as well (the
-- prebuild hook runs only under `npm run build`), so they carry buildInfo.js's
-- committed fallback, c298460, a July stamp no deployed build has served since.
--
-- (1) request_is_local(): whether the request came from a page on this machine
--     or the local network, by its Origin header, the way request_country()
--     reads cf-ipcountry. Production is served by name, so a page at a bare IP
--     address, v4 or v6, is never one; nor is a .local name, or localhost with
--     an explicit port. localhost with no port stays production: the native app
--     serves itself from there (capacitor://localhost on iOS, https:// or
--     http://localhost on Android). A server role sends no Origin. Any role can
--     call it, as any can call request_country(): it reads only the caller's
--     own request, and the guard below runs with the caller's rights.
--
-- (2) _tg_event_caller_guard: a row from such a page is marked 'dev', which the
--     divert trigger already takes (0470), unless something marked it already.
--     This covers every build from now on, including ones built before it.
--
-- (3) set_first_source: an account made on such a page in its first day joins
--     internal_accounts as 'dev_signup', as one made on a dev build does since
--     0470, so get_staging_redirect and every reader of that reason treat it
--     the same way.
--
-- (4) The rows already stored from unstamped builds move to
--     analytics_events_synthetic as 'dev'. Each was sent after the fallback's
--     own deploy, signed out. A local build that was stamped can't be told
--     apart after the fact; those stop arriving with (2).
--
-- The guard and set_first_source are the live bodies, 0470's byte for byte
-- (md5-checked against pg_proc before writing), with only these lines added;
-- create or replace keeps both ACLs. The proof sends real rows as anon from a
-- local origin and a production one, inside this transaction, and removes them.


-- ── (1) Where the request came from ─────────────────────────────────────────
create or replace function public.request_is_local()
returns boolean
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_raw    text;
  v_origin text;
  v_host   text;
  v_port   text;
begin
  begin
    v_raw := current_setting('request.headers', true);
    if v_raw is null or v_raw = '' then return false; end if;
    v_origin := lower(nullif(trim((v_raw::jsonb) ->> 'origin'), ''));
  exception when others then
    return false;   -- not a PostgREST request (pg_cron, a GoTrue trigger, psql)
  end;
  if v_origin is null then return false; end if;
  -- scheme://host[:port], an IPv6 host in brackets.
  v_host := substring(v_origin from '^[a-z][a-z0-9+.-]*://(\[[0-9a-f:.]+\]|[^/:?#\[]+)');
  v_port := substring(v_origin from '^[a-z][a-z0-9+.-]*://(?:\[[0-9a-f:.]+\]|[^/:?#\[]+):([0-9]+)');
  if v_host is null then return false; end if;
  return v_host ~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'
      or v_host ~ '^\[[0-9a-f:.]+\]$'
      or v_host ~ '\.local$'
      or ((v_host = 'localhost' or v_host ~ '\.localhost$') and v_port is not null);
end
$function$;

revoke all on function public.request_is_local() from public;
grant execute on function public.request_is_local() to anon, authenticated, service_role;
comment on function public.request_is_local() is
  'Whether this request came from a page on this machine or the local network, by its Origin (0476): a bare IP '
  'address, a .local name, or localhost with an explicit port. The native app (localhost, no port) is not. '
  '_tg_event_caller_guard marks such rows dev; set_first_source makes such a new account internal.';

-- ── (2) and (3) The guard, and the first-source stamp ───────────────────────

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
  elsif new.props->>'synthetic_reason' is null and public.request_is_local() then
    -- 0476: sent by a page on this machine or the local network, whatever
    -- build it is and whenever it was built.
    new.props := coalesce(new.props, '{}'::jsonb) || jsonb_build_object('synthetic_reason', 'dev');
  end if;
  return new;
end;
$$;

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
  -- 0476: or a page on this machine or the local network, which says nothing
  -- itself when it is a production build; that is a dev build here.
  if (v_env in ('preview', 'dev') or public.request_is_local())
     and exists (select 1 from auth.users u
                  where u.id = v_uid and u.created_at > now() - interval '1 day') then
    insert into public.internal_accounts (user_id, reason)
    values (v_uid, case when v_env = 'preview' then 'preview' else 'dev' end || '_signup')
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

-- ── (4) What is already stored ──────────────────────────────────────────────
-- Rows from unstamped builds, moved the way the divert trigger would have sent
-- them. The floor is well after the fallback stamp's own deploy (2026-07-07).
with moved as (
  delete from public.analytics_events e
   where e.props->>'build' = 'c298460'
     and e.occurred_at >= timestamptz '2026-08-01 00:00:00+00'
  returning e.*
)
insert into public.analytics_events_synthetic
  (id, session_id, user_id, event, props, path, occurred_at, country, app_session_id, received_at, reason)
select m.id, m.session_id, m.user_id, m.event,
       coalesce(m.props, '{}'::jsonb) || jsonb_build_object('synthetic_reason', 'dev'),
       m.path, m.occurred_at, m.country, m.app_session_id, m.received_at, 'dev'
  from moved m;

-- ── Proof ───────────────────────────────────────────────────────────────────
do $proof$
declare
  r       record;
  v_local uuid := gen_random_uuid();
  v_prod  uuid := gen_random_uuid();
  v_live  integer;
  v_why   text;
begin
  -- The 0311 habit. The guard runs with the caller's rights, so every role it
  -- runs as must be able to call request_is_local(), as it can request_country().
  if not has_function_privilege('anon', 'public.request_is_local()', 'execute')
     or not has_function_privilege('authenticated', 'public.request_is_local()', 'execute')
     or not has_function_privilege('service_role', 'public.request_is_local()', 'execute') then
    raise exception '0476: request_is_local() must be callable by every role the guard runs as';
  end if;
  if has_function_privilege('anon', 'public._tg_event_caller_guard()', 'execute')
     or has_function_privilege('authenticated', 'public._tg_event_caller_guard()', 'execute') then
    raise exception '0476: the guard''s grants moved';
  end if;
  if not has_function_privilege('anon', 'public.set_first_source(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_first_source(jsonb)', 'execute') then
    raise exception '0476: set_first_source''s grants moved';
  end if;

  -- Origin by origin.
  for r in select * from (values
      ('http://localhost:4173', true), ('http://localhost:5173', true), ('https://app.localhost:8443', true),
      ('http://127.0.0.1:8787', true), ('http://127.0.0.1', true), ('http://0.0.0.0:4173', true),
      ('http://192.168.1.20:5173', true), ('http://10.0.2.2:5173', true), ('http://100.101.102.103:4173', true),
      ('http://[::1]:4173', true), ('http://[fd12:3456::1]:4173', true), ('http://studio.local:4173', true),
      ('capacitor://localhost', false), ('ionic://localhost', false), ('https://localhost', false),
      ('http://localhost', false), ('https://clusters.soleilpictures.com', false),
      ('https://main-soleil-boards.arconkli.workers.dev', false),
      ('https://clusters-soleilpictures-com.translate.goog', false), ('https://local.example.com', false),
      ('null', false)
    ) as t(origin, local)
  loop
    perform set_config('request.headers', jsonb_build_object('origin', r.origin)::text, true);
    if public.request_is_local() is distinct from r.local then
      raise exception '0476: request_is_local() reads % as %', r.origin, public.request_is_local();
    end if;
  end loop;
  perform set_config('request.headers', '{}', true);
  if public.request_is_local() then raise exception '0476: no Origin must not read as local'; end if;
  perform set_config('request.headers', 'not json', true);
  if public.request_is_local() then raise exception '0476: unreadable headers must not read as local'; end if;

  -- End to end, as a signed-out page sends a row: from a local page it goes to
  -- the archive as 'dev'; from production it stays. Both are removed again.
  perform set_config('request.headers', '{"origin":"http://localhost:4173"}', true);
  set local role anon;
  insert into public.analytics_events (id, event, path) values (v_local, '0476_proof', '/');
  reset role;
  perform set_config('request.headers', '{"origin":"https://clusters.soleilpictures.com"}', true);
  set local role anon;
  insert into public.analytics_events (id, event, path) values (v_prod, '0476_proof', '/');
  reset role;
  perform set_config('request.headers', '', true);

  select count(*)::int into v_live from public.analytics_events where id = v_local;
  select s.reason into v_why from public.analytics_events_synthetic s where s.id = v_local;
  if v_live <> 0 or v_why is distinct from 'dev' then
    raise exception '0476: a local row was kept (% live, archived as %)', v_live, v_why;
  end if;
  if not exists (select 1 from public.analytics_events where id = v_prod)
     or exists (select 1 from public.analytics_events_synthetic where id = v_prod) then
    raise exception '0476: a production row was not kept';
  end if;
  delete from public.analytics_events_synthetic where id = v_local;
  delete from public.analytics_events where id = v_prod;

  -- (4) took: nothing from an unstamped build is left live since the floor.
  if exists (select 1 from public.analytics_events
              where props->>'build' = 'c298460'
                and occurred_at >= timestamptz '2026-08-01 00:00:00+00') then
    raise exception '0476: rows from unstamped builds are still live';
  end if;
end $proof$;
