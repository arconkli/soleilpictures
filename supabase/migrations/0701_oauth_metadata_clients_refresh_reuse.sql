-- 0701 — OAuth: clients named by a metadata document, loopback redirects on any
-- port, and refresh tokens that notice being used twice.
--
-- 1. CLIENT ID METADATA DOCUMENTS. Claude, Claude Code, ChatGPT and VS Code
--    name themselves by an https URL serving their own metadata
--    (draft-ietf-oauth-client-id-metadata-document) whenever the server
--    advertises it, and fall back to registering only when it doesn't. The
--    Worker fetches and checks the document (lib/oauthClients.js) and stores
--    it here through oauth_client_upsert_cimd, in oauth_clients like any other
--    client so codes and grants keep their foreign keys. metadata_expires_at
--    is when it is read again; a disabled client stays disabled however often
--    its document is re-read.
--
-- 2. LOOPBACK ON ANY PORT. RFC 8252 §7.3: an authorization server "MUST allow
--    any port to be specified at the time of the request for loopback IP
--    redirect URIs". Claude Code publishes http://localhost/callback with no
--    port and comes back on whatever port its OS handed it, so the exact match
--    in oauth_authorize_consent refused it every time. _oauth_redirect_matches
--    is the rule, and lib/oauthClients.js redirectUriMatches is its twin: the
--    proof pairs at the bottom are read by oauthClients.test.mjs and run
--    through the JS too, so the two cannot drift apart.
--
-- 3. REFRESH TOKEN REUSE (API-1, 2026-10-21 audit). A refresh token was
--    replaced when used, but presenting an old one just failed: nothing
--    noticed that a token which had already been exchanged was being tried
--    again, which is what a stolen one looks like. OAuth 2.1 §4.3.1 asks the
--    server to notice. Now every exchanged token is remembered
--    (oauth_refresh_used), and:
--      · the same exchange again within 30 seconds is a retry, a response that
--        never arrived or two requests racing, and gets a fresh pair, while
--        the token it supersedes is remembered too, so the chain stays a chain;
--      · any later use is a replay: the grant and its access token are revoked
--        and the person approves the app again. The function RETURNS no rows
--        there rather than raising, because an exception would roll the
--        revocation back with it.
--    And the sliding 90 days now stop 180 days after the person connected.
--
-- 4. purge_oauth_codes() existed (0224) and nothing called it. It now also
--    forgets exchanged refresh tokens after 180 days, and runs nightly.
--
-- APPLIED 2026-10-25 as records oauth_metadata_clients_refresh_reuse_part1,
-- _part2, _part3a, _part3b, _part4, _part5_proof. All five bodies md5-match
-- this file, and a rolled-back probe on live passed: exchange, retry, replay
-- (revoked, one alert), a metadata client stored, consent on any loopback port.

-- ── 1. Metadata clients ──────────────────────────────────────────────────────

alter table public.oauth_clients
  add column if not exists metadata_fetched_at timestamptz,
  add column if not exists metadata_expires_at timestamptz;

comment on column public.oauth_clients.metadata_expires_at is
  'A client named by a metadata document URL: when the Worker reads the document again. Null for a client registered through /oauth/register.';

create or replace function public.oauth_client_upsert_cimd(
  p_client_id text,
  p_meta jsonb,
  p_ttl_seconds integer default 3600,
  p_ip text default null
)
returns public.oauth_clients
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uris text[] := array(select jsonb_array_elements_text(p_meta -> 'redirect_uris'));
  v_ttl  interval := make_interval(secs => greatest(300, least(coalesce(p_ttl_seconds, 3600), 86400)));
  v_row  public.oauth_clients;
begin
  -- The Worker checked the document; these are what must hold even if it
  -- did not.
  if p_client_id is null or length(p_client_id) > 512
     or p_client_id !~ '^https://[^/?#@]+/[^#]+$' then
    raise exception 'a metadata client is named by an https URL with a path' using errcode = '22023';
  end if;
  if coalesce(array_length(v_uris, 1), 0) not between 1 and 10 then
    raise exception 'redirect_uris must list between 1 and 10 URIs' using errcode = '22023';
  end if;

  -- First sight of a document is a registration and is counted like one,
  -- against the same 20 an hour per address as /oauth/register (0224):
  -- otherwise one wildcard route serving a document at every path would be a
  -- row per request. Reading a known document again is not counted.
  if p_ip is not null
     and not exists (select 1 from public.oauth_clients c where c.client_id = p_client_id)
     and (select count(*) from public.oauth_clients c
           where c.created_ip = p_ip and c.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too many client registrations from this address — try again later'
      using errcode = '54000';
  end if;

  insert into public.oauth_clients as c (
    client_id, client_secret_hash, client_name, client_uri, logo_uri,
    redirect_uris, grant_types, response_types, token_endpoint_auth_method,
    scope, software_id, software_version, created_ip,
    metadata_fetched_at, metadata_expires_at
  ) values (
    p_client_id,
    null,
    left(coalesce(nullif(p_meta ->> 'client_name', ''), 'An MCP client'), 120),
    nullif(p_meta ->> 'client_uri', ''),
    nullif(p_meta ->> 'logo_uri', ''),
    v_uris,
    coalesce(nullif(array(select jsonb_array_elements_text(p_meta -> 'grant_types')), '{}'::text[]),
             array['authorization_code', 'refresh_token']),
    array['code'],
    'none',
    coalesce(nullif(p_meta ->> 'scope', ''), 'read write'),
    nullif(p_meta ->> 'software_id', ''),
    nullif(p_meta ->> 'software_version', ''),
    left(p_ip, 64),
    now(),
    now() + v_ttl
  )
  on conflict (client_id) do update set
    client_name         = excluded.client_name,
    client_uri          = excluded.client_uri,
    logo_uri            = excluded.logo_uri,
    redirect_uris       = excluded.redirect_uris,
    grant_types         = excluded.grant_types,
    scope               = excluded.scope,
    software_id         = excluded.software_id,
    software_version    = excluded.software_version,
    metadata_fetched_at = excluded.metadata_fetched_at,
    metadata_expires_at = excluded.metadata_expires_at
  where c.disabled_at is null
  returning * into v_row;

  -- Null when the client is disabled: the Worker answers "unknown client".
  return v_row;
end;
$$;

revoke execute on function public.oauth_client_upsert_cimd(text, jsonb, integer, text)
  from public, anon, authenticated;

-- ── 2. Loopback redirects on any port ────────────────────────────────────────

create or replace function public._oauth_redirect_matches(p_registered text[], p_presented text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
-- $fn$, not $$: the pattern ends in an anchor, and "$" + "$re$" would close a
-- $$-quoted body early.
as $fn$
  select coalesce(
    p_presented = any(p_registered)
    or exists (
      select 1
        from unnest(p_registered) as reg(uri)
       cross join lateral (
         select regexp_match(reg.uri,
           $re$^http://(127\.0\.0\.1|\[::1\]|localhost)(:([0-9]{1,5}))?(/[^#]*)?$$re$, 'i') as m) r
       cross join lateral (
         select regexp_match(p_presented,
           $re$^http://(127\.0\.0\.1|\[::1\]|localhost)(:([0-9]{1,5}))?(/[^#]*)?$$re$, 'i') as m) p
       where r.m is not null
         and p.m is not null
         and lower(r.m[1]) = lower(p.m[1])
         and coalesce(r.m[4], '/') = coalesce(p.m[4], '/')
         and coalesce(p.m[3]::int, 1) between 1 and 65535
    ),
    false);
$fn$;

revoke execute on function public._oauth_redirect_matches(text[], text)
  from public, anon, authenticated;

-- The live definition (0224 + 0375), with the redirect check moved onto the
-- rule above. Nothing else changes.
create or replace function public.oauth_authorize_consent(
  p_client_id text, p_code_hash text, p_redirect_uri text, p_scope text[],
  p_challenge text, p_method text default 'S256'::text,
  p_resource text default null::text, p_ttl_seconds integer default 120)
returns timestamp with time zone
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_client public.oauth_clients;
  v_scope  text[];
  v_exp    timestamptz;
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  -- 0375: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  -- 0375: not in an account's first three days.
  perform public._refuse_if_new('Connecting an app');

  select * into v_client from public.oauth_clients
   where client_id = p_client_id and disabled_at is null;
  if not found then
    raise exception 'unknown client' using errcode = '22023';
  end if;
  -- 0701: exact, or loopback on any port (RFC 8252 §7.3).
  if not public._oauth_redirect_matches(v_client.redirect_uris, p_redirect_uri) then
    raise exception 'redirect_uri does not match this client' using errcode = '22023';
  end if;
  if coalesce(p_method, 'S256') <> 'S256' then
    raise exception 'code_challenge_method must be S256' using errcode = '22023';
  end if;
  if p_challenge is null or length(p_challenge) < 43 then
    raise exception 'a PKCE code_challenge is required' using errcode = '22023';
  end if;

  v_scope := coalesce(p_scope, array['read']);
  if not (v_scope <@ array['read','write','delete']) then
    raise exception 'scopes must be a subset of read, write, delete' using errcode = '22023';
  end if;
  if 'delete' = any(v_scope) and not ('write' = any(v_scope)) then
    v_scope := v_scope || 'write'::text;
  end if;
  if not ('read' = any(v_scope)) then v_scope := array['read'] || v_scope; end if;
  select array_agg(s order by array_position(array['read','write','delete'], s))
    into v_scope from (select distinct unnest(v_scope) as s) d;

  if (select count(*) from public.oauth_grants
       where user_id = auth.uid() and revoked_at is null) >= 20 then
    raise exception 'too many connected apps — disconnect one first' using errcode = '54000';
  end if;

  v_exp := now() + make_interval(secs => greatest(30, least(coalesce(p_ttl_seconds, 120), 600)));

  insert into public.oauth_codes (
    code_hash, client_id, user_id, redirect_uri, scope,
    code_challenge, code_challenge_method, resource, expires_at
  ) values (
    p_code_hash, p_client_id, auth.uid(), p_redirect_uri, v_scope,
    p_challenge, 'S256', nullif(p_resource, ''), v_exp
  );

  begin
    insert into public.analytics_events (user_id, event, props)
    values (auth.uid(), 'oauth_consent_granted',
            jsonb_build_object('client', v_client.client_name, 'scopes', v_scope));
  exception when others then null;
  end;

  return v_exp;
end;
$function$;

-- ── 3. Refresh token reuse ───────────────────────────────────────────────────

create table if not exists public.oauth_refresh_used (
  refresh_hash text primary key,
  grant_id     uuid not null references public.oauth_grants(id) on delete cascade,
  used_at      timestamptz not null default now()
);

create index if not exists oauth_refresh_used_grant_idx on public.oauth_refresh_used (grant_id);
create index if not exists oauth_refresh_used_at_idx on public.oauth_refresh_used (used_at);

alter table public.oauth_refresh_used enable row level security;
revoke all on public.oauth_refresh_used from public, anon, authenticated;

comment on table public.oauth_refresh_used is
  'Refresh tokens (hashes) that were already exchanged, so presenting one again is noticed: a retry within 30 seconds is re-issued, a later replay revokes the grant (0701).';

create or replace function public.oauth_refresh_rotate(
  p_refresh_hash text, p_client_id text, p_new_access_hash text, p_prefix text,
  p_new_refresh_hash text, p_access_ttl integer default 3600, p_refresh_days integer default 90)
returns table(grant_id uuid, user_id uuid, scope text[], resource text, expires_at timestamp with time zone)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  g       public.oauth_grants;
  v_used  public.oauth_refresh_used;
  v_token uuid;
  v_exp   timestamptz := now() + make_interval(secs => greatest(60, least(coalesce(p_access_ttl, 3600), 86400)));
begin
  -- The ordinary case: the grant's current refresh token, exchanged once.
  update public.oauth_grants og
     set refresh_token_hash = p_new_refresh_hash,
         last_used_at = now(),
         -- 0701: sliding, but never past 180 days after the person connected.
         refresh_expires_at = least(
           now() + make_interval(days => greatest(1, least(coalesce(p_refresh_days, 90), 365))),
           og.created_at + interval '180 days')
   where og.refresh_token_hash = p_refresh_hash
     and og.client_id = p_client_id
     and og.revoked_at is null
     and (og.refresh_expires_at is null or og.refresh_expires_at > now())
  returning og.* into g;

  if found then
    insert into public.oauth_refresh_used (refresh_hash, grant_id)
    values (p_refresh_hash, g.id)
    on conflict (refresh_hash) do nothing;
  else
    -- 0701: not the current token. One this grant already exchanged?
    select u.* into v_used from public.oauth_refresh_used u where u.refresh_hash = p_refresh_hash;
    if not found then
      raise exception 'that refresh token is not valid' using errcode = '22023';
    end if;

    if v_used.used_at < now() - interval '30 seconds' then
      -- A replay. Either the client or whoever copied its token is holding a
      -- token that was spent long ago, and there is no telling which: end the
      -- connection for both.
      update public.oauth_grants og
         set revoked_at = now(), refresh_token_hash = null
       where og.id = v_used.grant_id and og.revoked_at is null
      returning og.token_id into v_token;
      if found then
        update public.api_tokens t set revoked_at = now()
         where t.id = v_token and t.revoked_at is null;
        begin
          perform public.ops_alert_raise(
            'oauth_reuse',
            'A connected app''s refresh token was used twice; the connection was revoked',
            format('client %s, grant %s. Expected after a client bug or a stolen token; the person has to approve the app again.',
                   p_client_id, v_used.grant_id),
            false, 'oauth_reuse:' || v_used.grant_id::text, interval '1 day', null);
        exception when others then null;
        end;
      end if;
      -- No rows, so the Worker answers invalid_grant. Not RAISE: an exception
      -- would roll the revocation back with it.
      return;
    end if;

    -- Within 30 seconds: the same exchange retried. Rotate again from wherever
    -- the chain is now, and remember the token this supersedes, so a later use
    -- of that one is a replay too. The expiry is not extended by a retry.
    select og.* into g from public.oauth_grants og
     where og.id = v_used.grant_id
       and og.client_id = p_client_id
       and og.revoked_at is null
       and (og.refresh_expires_at is null or og.refresh_expires_at > now())
     for update;
    if not found then
      raise exception 'that refresh token is not valid' using errcode = '22023';
    end if;
    if g.refresh_token_hash is not null then
      insert into public.oauth_refresh_used (refresh_hash, grant_id)
      values (g.refresh_token_hash, g.id)
      on conflict (refresh_hash) do nothing;
    end if;
    update public.oauth_grants og
       set refresh_token_hash = p_new_refresh_hash, last_used_at = now()
     where og.id = g.id
    returning og.* into g;
  end if;

  -- 0371: nor refreshes an old connection (the rotation rolls back with it).
  if public._user_banned(g.user_id) then
    raise exception 'that refresh token is not valid' using errcode = '22023';
  end if;

  update public.api_tokens t
     set token_hash = p_new_access_hash,
         prefix     = p_prefix,
         expires_at = v_exp,
         revoked_at = null
   where t.id = g.token_id;

  return query select g.id, g.user_id, g.scope, g.resource, v_exp;
end;
$function$;

-- ── 4. The purge, and something to run it ────────────────────────────────────

create or replace function public.purge_oauth_codes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n integer; m integer;
begin
  delete from public.oauth_codes where expires_at < now() - interval '1 day';
  get diagnostics n = row_count;
  -- 0701: an exchanged refresh token is remembered for as long as its grant
  -- could still be refreshed, the 180-day lifetime, and then forgotten.
  delete from public.oauth_refresh_used where used_at < now() - interval '180 days';
  get diagnostics m = row_count;
  return n + m;
end;
$function$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'purge_oauth_codes') then
    perform cron.schedule('purge_oauth_codes', '27 3 * * *', $cmd$ select public.purge_oauth_codes(); $cmd$);
  end if;
end $$;

-- ── Proof ────────────────────────────────────────────────────────────────────
-- The 0311 habit: a REVOKE reporting success proves nothing, so the grants are
-- read back. Then the redirect rule against pairs oauthClients.test.mjs also
-- runs through redirectUriMatches.

do $$
declare
  r record;
  fn text;
begin
  foreach fn in array array[
    'public._oauth_redirect_matches(text[], text)',
    'public.oauth_client_upsert_cimd(text, jsonb, integer, text)',
    'public.oauth_refresh_rotate(text, text, text, text, text, integer, integer)',
    'public.purge_oauth_codes()'
  ] loop
    if has_function_privilege('anon', fn, 'execute')
       or has_function_privilege('authenticated', fn, 'execute') then
      raise exception '0701: % must not be callable by anon or authenticated', fn;
    end if;
  end loop;
  foreach fn in array array[
    'public.oauth_client_upsert_cimd(text, jsonb, integer, text)',
    'public.oauth_refresh_rotate(text, text, text, text, text, integer, integer)',
    'public.purge_oauth_codes()'
  ] loop
    if not has_function_privilege('service_role', fn, 'execute') then
      raise exception '0701: the Worker (service_role) must be able to call %', fn;
    end if;
  end loop;
  fn := 'public.oauth_authorize_consent(text, text, text, text[], text, text, text, integer)';
  if has_function_privilege('anon', fn, 'execute') or not has_function_privilege('authenticated', fn, 'execute') then
    raise exception '0701: oauth_authorize_consent is for signed-in people only';
  end if;
  if has_table_privilege('anon', 'public.oauth_refresh_used', 'select')
     or has_table_privilege('authenticated', 'public.oauth_refresh_used', 'select')
     or has_table_privilege('authenticated', 'public.oauth_refresh_used', 'insert') then
    raise exception '0701: oauth_refresh_used must not be readable or writable by clients';
  end if;
  if not exists (select 1 from cron.job where jobname = 'purge_oauth_codes') then
    raise exception '0701: purge_oauth_codes is not scheduled';
  end if;

  -- proof pairs: (registered, presented, matches?)
  for r in select * from (values
    (array['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/auth_callback', true),
    (array['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/auth_callback/', false),
    (array['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai:8443/api/mcp/auth_callback', false),
    (array['http://localhost/callback', 'http://127.0.0.1/callback'], 'http://localhost:54321/callback', true),
    (array['http://localhost/callback', 'http://127.0.0.1/callback'], 'http://127.0.0.1:61000/callback', true),
    (array['http://localhost/callback'], 'http://127.0.0.1:61000/callback', false),
    (array['http://localhost/callback'], 'http://localhost:54321/callback/more', false),
    (array['http://localhost/callback'], 'http://localhost:54321/Callback', false),
    (array['http://127.0.0.1:33418/'], 'http://127.0.0.1:40000/', true),
    (array['http://127.0.0.1:33418/'], 'http://127.0.0.1:40000', true),
    (array['http://[::1]/cb'], 'http://[::1]:9000/cb', true),
    (array['http://localhost/callback'], 'http://localhost:99999/callback', false),
    (array['http://localhost/callback'], 'http://localhost:0/callback', false),
    (array['http://localhost/callback'], 'http://localhost.evil.example/callback', false),
    (array['http://localhost/callback'], 'https://localhost:5000/callback', false),
    (array['http://localhost:8787/callback'], 'http://localhost:8787/callback?x=1', false),
    (array['http://localhost/cb?a=1'], 'http://localhost:5000/cb?a=1', true),
    (array['http://LOCALHOST/cb'], 'http://localhost:5000/cb', true),
    (array['http://localhost/callback'], 'http://localhost:54321/callback#x', false),
    (array['cursor://anysphere.cursor-mcp/oauth/callback'], 'cursor://anysphere.cursor-mcp/oauth/callback', true),
    (array['cursor://anysphere.cursor-mcp/oauth/callback'], 'cursor://anysphere.cursor-mcp:1/oauth/callback', false),
    (array['https://chatgpt.com/connector_platform_oauth_redirect'], 'https://chatgpt.com/connector_platform_oauth_redirect', true),
    (array[]::text[], 'http://localhost:5000/cb', false)
  ) as t(registered, presented, expected) loop
    if public._oauth_redirect_matches(r.registered, r.presented) is distinct from r.expected then
      raise exception '0701: _oauth_redirect_matches(%, %) should be %', r.registered, r.presented, r.expected;
    end if;
  end loop;
  if public._oauth_redirect_matches(array['http://localhost/cb'], null) is distinct from false then
    raise exception '0701: a missing redirect_uri must not match (and must not be null)';
  end if;
end $$;
