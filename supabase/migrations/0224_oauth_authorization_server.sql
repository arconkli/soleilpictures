-- 0224_oauth_authorization_server.sql
--
-- Making "connect Soleil Clusters" a button instead of a chore.
--
-- THE PROBLEM. Until now the only way to reach /api/v1 or the MCP server was:
-- already have an account, sign in on the web, find Settings → API, mint a
-- personal access token, and paste it into a JSON config file on disk. Every
-- one of those steps loses people, and the last two lose the ones who are not
-- programmers — which, for a tool used by art departments, is most of them.
--
-- It is also not what the protocol asks for. The MCP authorization spec says an
-- MCP server MUST implement OAuth 2.0 Protected Resource Metadata (RFC 9728),
-- and the client directories that would list us (Claude, ChatGPT) gate on the
-- OAuth flow existing. A bearer token pasted into a config file is not a
-- connector; it is a workaround.
--
-- WHAT THIS IS. Soleil is now its own OAuth 2.1 authorization server. The
-- Worker owns the endpoints (src/worker-oauth.js); this migration owns the
-- state, and every rule that must hold even if the Worker has a bug:
--
--   • A code is single-use. oauth_code_redeem consumes it in the same UPDATE
--     that returns it, so two deliveries of the same code cannot both succeed —
--     an authorization code replay is the classic way to steal a session, and
--     "check then update" loses that race under concurrency.
--   • A code belongs to the client and redirect_uri it was issued for. Redeem
--     matches on all three, so a code leaked to another client is worthless.
--   • Consent is recorded AS THE USER. oauth_authorize_consent uses auth.uid()
--     and never takes a user id as an argument, so the Worker cannot mint a
--     code on behalf of someone whose session it did not actually hold.
--   • Refresh tokens ROTATE and are single-use, per OAuth 2.1.
--
-- WHAT IT DELIBERATELY IS NOT. There is no new authorization model. An OAuth
-- access token is an ordinary api_tokens row, resolved by the same
-- api_token_resolve, subject to the same scopes and the same rate limit, and
-- turned into the user's own Supabase session by the same code path. So an
-- assistant connected over OAuth can reach exactly what the person can reach
-- and not one row more — which is the property worth having, and it is
-- structural rather than remembered.
--
-- ONE ROW PER CONNECTION. A refresh does NOT mint a new api_tokens row; it
-- rotates the hash and extends the expiry on the row that already exists. An
-- hourly access token that inserted a row each time would put a row per
-- connection per hour into the table the audit log joins against, and would
-- make `token_id` useless for answering "how much has this connection done".

-----------------------------------------------------------------------
-- 1. Registered clients
--
-- Dynamic Client Registration (RFC 7591) is unauthenticated by design — that
-- is what lets an assistant connect without anyone pre-arranging anything. So
-- the cap is here rather than in policy: an IP may register a bounded number of
-- clients per hour, and that is checked inside the function where it cannot be
-- forgotten by a caller.
-----------------------------------------------------------------------
create table if not exists public.oauth_clients (
  client_id                  text primary key,
  client_secret_hash         text,                    -- null = public client (PKCE only)
  client_name                text not null,
  client_uri                 text,
  logo_uri                   text,
  redirect_uris              text[] not null,
  grant_types                text[] not null default array['authorization_code','refresh_token'],
  response_types             text[] not null default array['code'],
  token_endpoint_auth_method text not null default 'none',
  scope                      text not null default 'read write',
  software_id                text,
  software_version           text,
  created_ip                 text,
  created_at                 timestamptz not null default now(),
  last_used_at               timestamptz,
  disabled_at                timestamptz
);

alter table public.oauth_clients enable row level security;
revoke all on table public.oauth_clients from anon, authenticated;

create index if not exists oauth_clients_ip_idx on public.oauth_clients (created_ip, created_at desc);

-- Authorization codes. Short-lived, single-use, and bound to the exact client,
-- redirect_uri and PKCE challenge they were issued against.
create table if not exists public.oauth_codes (
  code_hash             text primary key,
  client_id             text not null references public.oauth_clients(client_id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  redirect_uri          text not null,
  scope                 text[] not null,
  code_challenge        text not null,
  code_challenge_method text not null default 'S256',
  resource              text,
  state                 text,
  expires_at            timestamptz not null,
  consumed_at           timestamptz,
  created_at            timestamptz not null default now()
);

alter table public.oauth_codes enable row level security;
revoke all on table public.oauth_codes from anon, authenticated;
create index if not exists oauth_codes_expiry_idx on public.oauth_codes (expires_at);

-- A live connection between one person and one client. This is the row a user
-- sees under "Connected apps" and the row they revoke to disconnect.
create table if not exists public.oauth_grants (
  id                 uuid primary key default gen_random_uuid(),
  client_id          text not null references public.oauth_clients(client_id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  scope              text[] not null,
  resource           text,
  refresh_token_hash text unique,
  token_id           uuid references public.api_tokens(id) on delete set null,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz,
  refresh_expires_at timestamptz,
  revoked_at         timestamptz
);

alter table public.oauth_grants enable row level security;
revoke all on table public.oauth_grants from anon, authenticated;
create index if not exists oauth_grants_user_idx on public.oauth_grants (user_id, created_at desc);

-- Which client an api_tokens row was issued to, if any.
--
-- This is what keeps the two kinds of credential from being confused for each
-- other. A personal access token is something a person deliberately made and
-- must be shown their own list of; an OAuth token is an implementation detail
-- of a connection they approved, and showing it as "a token you created" would
-- be a lie they cannot act on.
alter table public.api_tokens
  add column if not exists oauth_client_id text references public.oauth_clients(client_id) on delete set null;

create index if not exists api_tokens_oauth_idx on public.api_tokens (oauth_client_id)
  where oauth_client_id is not null;

-----------------------------------------------------------------------
-- 2. Registration
-----------------------------------------------------------------------
create or replace function public.oauth_client_register(p_meta jsonb, p_ip text default null)
returns public.oauth_clients
language plpgsql
security definer
set search_path = public, extensions as $$
declare
  v_id  text;
  v_row public.oauth_clients;
  v_uris text[] := array(select jsonb_array_elements_text(p_meta -> 'redirect_uris'));
begin
  if v_uris is null or array_length(v_uris, 1) is null then
    raise exception 'redirect_uris is required' using errcode = '22023';
  end if;

  -- An open registration endpoint with no ceiling is a free write primitive for
  -- anyone on the internet. The rows are tiny, so the cap is generous; it
  -- exists to bound a script, not to inconvenience a client.
  if p_ip is not null and (
    select count(*) from public.oauth_clients
     where created_ip = p_ip and created_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception 'too many client registrations from this address — try again later'
      using errcode = '54000';
  end if;

  v_id := 'soleil_' || encode(extensions.gen_random_bytes(16), 'hex');

  insert into public.oauth_clients (
    client_id, client_secret_hash, client_name, client_uri, logo_uri,
    redirect_uris, grant_types, response_types, token_endpoint_auth_method,
    scope, software_id, software_version, created_ip
  ) values (
    v_id,
    nullif(p_meta ->> 'client_secret_hash', ''),
    left(coalesce(nullif(p_meta ->> 'client_name', ''), 'An MCP client'), 120),
    nullif(p_meta ->> 'client_uri', ''),
    nullif(p_meta ->> 'logo_uri', ''),
    v_uris,
    coalesce(array(select jsonb_array_elements_text(p_meta -> 'grant_types')),
             array['authorization_code','refresh_token']),
    coalesce(array(select jsonb_array_elements_text(p_meta -> 'response_types')), array['code']),
    coalesce(nullif(p_meta ->> 'token_endpoint_auth_method', ''), 'none'),
    coalesce(nullif(p_meta ->> 'scope', ''), 'read write'),
    nullif(p_meta ->> 'software_id', ''),
    nullif(p_meta ->> 'software_version', ''),
    left(coalesce(p_ip, ''), 64)
  ) returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.oauth_client_register(jsonb, text) from public, anon, authenticated;

create or replace function public.oauth_client_get(p_client_id text)
returns public.oauth_clients
language sql
stable
security definer
set search_path = public as $$
  select * from public.oauth_clients where client_id = p_client_id and disabled_at is null;
$$;

revoke all on function public.oauth_client_get(text) from public, anon, authenticated;

-----------------------------------------------------------------------
-- 3. Consent → code
--
-- Runs AS THE USER. auth.uid() is the only source of the identity a code is
-- bound to; there is deliberately no p_user_id argument, so a bug in the Worker
-- cannot produce a code for an account whose session it did not hold.
-----------------------------------------------------------------------
create or replace function public.oauth_authorize_consent(
  p_client_id    text,
  p_code_hash    text,
  p_redirect_uri text,
  p_scope        text[],
  p_challenge    text,
  p_method       text default 'S256',
  p_resource     text default null,
  p_ttl_seconds  integer default 120
) returns timestamptz
language plpgsql
security definer
set search_path = public, auth as $$
declare
  v_client public.oauth_clients;
  v_scope  text[];
  v_exp    timestamptz;
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;

  select * into v_client from public.oauth_clients
   where client_id = p_client_id and disabled_at is null;
  if not found then
    raise exception 'unknown client' using errcode = '22023';
  end if;
  if not (p_redirect_uri = any(v_client.redirect_uris)) then
    raise exception 'redirect_uri does not match this client' using errcode = '22023';
  end if;
  -- Only S256. OAuth 2.1 removes `plain`, and accepting it would silently
  -- downgrade every client that offered it.
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
  -- The same ladder api_token_mint applies: delete implies write, everything
  -- implies read. A token that can delete but not read is not a thing anyone
  -- means to ask for.
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
$$;

revoke all on function public.oauth_authorize_consent(text, text, text, text[], text, text, text, integer)
  from public, anon;
grant execute on function public.oauth_authorize_consent(text, text, text, text[], text, text, text, integer)
  to authenticated;

-----------------------------------------------------------------------
-- 4. Code → tokens
--
-- Consumption and issuance in ONE function so a code cannot be redeemed twice
-- even if two requests arrive at the same instant: the UPDATE … WHERE
-- consumed_at IS NULL … RETURNING is the lock.
--
-- PKCE IS VERIFIED IN THAT SAME WHERE CLAUSE, not after it. The obvious
-- arrangement — consume the code, hand the stored challenge back to the Worker,
-- let the Worker compare — mints the access token BEFORE anyone has proved they
-- are the client that started the flow. Doing the comparison in SQL keeps
-- "claim the code" and "prove you may" a single indivisible act, which is the
-- entire point of PKCE.
--
-- The verifier hashes here rather than in the Worker so no branch can skip it.
-- base64url = base64 with +/ mapped to -_ and the padding dropped (RFC 7636
-- Appendix A). A 32-byte digest encodes to 44 characters, well under the point
-- where Postgres would wrap the line, but the newline strip stays as a guard.
-----------------------------------------------------------------------
create or replace function public.oauth_code_redeem(
  p_code_hash     text,
  p_client_id     text,
  p_redirect_uri  text,
  p_verifier      text,
  p_access_hash   text,
  p_prefix        text,
  p_refresh_hash  text,
  p_access_ttl    integer default 3600,
  p_refresh_days  integer default 90
) returns table (
  grant_id uuid, user_id uuid, scope text[], resource text, expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions as $$
declare
  c        public.oauth_codes;
  v_client public.oauth_clients;
  v_token  uuid;
  v_grant  uuid;
  v_challenge text;
  v_exp    timestamptz := now() + make_interval(secs => greatest(60, least(coalesce(p_access_ttl, 3600), 86400)));
begin
  if p_verifier is null or length(p_verifier) < 43 or length(p_verifier) > 128 then
    raise exception 'a PKCE code_verifier of 43-128 characters is required' using errcode = '22023';
  end if;

  v_challenge := rtrim(
    translate(replace(encode(extensions.digest(p_verifier, 'sha256'), 'base64'), E'\n', ''), '+/', '-_'),
    '=');

  update public.oauth_codes
     set consumed_at = now()
   where code_hash = p_code_hash
     and client_id = p_client_id
     and redirect_uri = p_redirect_uri
     and code_challenge = v_challenge
     and consumed_at is null
     -- Qualified: `expires_at` is also this function's OUT parameter (the
     -- ACCESS token's expiry), and an unqualified reference resolves to the
     -- variable, not the column. PL/pgSQL raises rather than guessing, which is
     -- the only reason this was a caught bug and not a code that never expires.
     and public.oauth_codes.expires_at > now()
  returning * into c;

  -- One message for every failure. Distinguishing "wrong verifier" from
  -- "already used" from "expired" tells whoever is holding a stolen code which
  -- of their guesses was right.
  if not found then
    raise exception 'that authorization code is not valid' using errcode = '22023';
  end if;

  select * into v_client from public.oauth_clients where client_id = p_client_id;

  insert into public.api_tokens (user_id, name, token_hash, prefix, scopes, expires_at, oauth_client_id)
  values (c.user_id, left(coalesce(v_client.client_name, 'Connected app'), 80),
          p_access_hash, p_prefix, c.scope, v_exp, p_client_id)
  returning id into v_token;

  insert into public.oauth_grants (
    client_id, user_id, scope, resource, refresh_token_hash, token_id, refresh_expires_at
  ) values (
    p_client_id, c.user_id, c.scope, c.resource, p_refresh_hash, v_token,
    now() + make_interval(days => greatest(1, least(coalesce(p_refresh_days, 90), 365)))
  ) returning id into v_grant;

  update public.oauth_clients set last_used_at = now() where client_id = p_client_id;

  return query select v_grant, c.user_id, c.scope, c.resource, v_exp;
end;
$$;

revoke all on function public.oauth_code_redeem(text, text, text, text, text, text, text, integer, integer)
  from public, anon, authenticated;

-- Refresh. Rotates BOTH secrets on the row that already exists rather than
-- issuing a new one, per the "one row per connection" note at the top.
create or replace function public.oauth_refresh_rotate(
  p_refresh_hash     text,
  p_client_id        text,
  p_new_access_hash  text,
  p_prefix           text,
  p_new_refresh_hash text,
  p_access_ttl       integer default 3600,
  p_refresh_days     integer default 90
) returns table (grant_id uuid, user_id uuid, scope text[], resource text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public as $$
declare
  g     public.oauth_grants;
  v_exp timestamptz := now() + make_interval(secs => greatest(60, least(coalesce(p_access_ttl, 3600), 86400)));
begin
  -- Single-use: the old hash is replaced in the same statement that claims it,
  -- so a replayed refresh token finds nothing.
  update public.oauth_grants
     set refresh_token_hash = p_new_refresh_hash,
         last_used_at = now(),
         refresh_expires_at = now() + make_interval(days => greatest(1, least(coalesce(p_refresh_days, 90), 365)))
   where refresh_token_hash = p_refresh_hash
     and client_id = p_client_id
     and revoked_at is null
     and (refresh_expires_at is null or refresh_expires_at > now())
  returning * into g;

  if not found then
    raise exception 'that refresh token is not valid' using errcode = '22023';
  end if;

  update public.api_tokens
     set token_hash = p_new_access_hash,
         prefix     = p_prefix,
         expires_at = v_exp,
         revoked_at = null
   where id = g.token_id;

  return query select g.id, g.user_id, g.scope, g.resource, v_exp;
end;
$$;

revoke all on function public.oauth_refresh_rotate(text, text, text, text, text, integer, integer)
  from public, anon, authenticated;

-----------------------------------------------------------------------
-- 5. Seeing and severing a connection
--
-- A connection you cannot see and cannot end is worse than no connection at
-- all, so these ship with the flow rather than after it.
-----------------------------------------------------------------------
create or replace function public.oauth_connections_list()
returns table (
  id uuid, client_name text, client_uri text, scope text[],
  created_at timestamptz, last_used_at timestamptz, calls bigint
)
language sql
stable
security definer
set search_path = public, auth as $$
  select g.id, c.client_name, c.client_uri, g.scope, g.created_at,
         greatest(g.last_used_at, t.last_used_at),
         (select count(*) from public.api_request_log l where l.token_id = g.token_id)
    from public.oauth_grants g
    join public.oauth_clients c on c.client_id = g.client_id
    left join public.api_tokens t on t.id = g.token_id
   where g.user_id = auth.uid() and g.revoked_at is null
   order by g.created_at desc;
$$;

revoke all on function public.oauth_connections_list() from public, anon;
grant execute on function public.oauth_connections_list() to authenticated;

create or replace function public.oauth_connection_revoke(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth as $$
declare g public.oauth_grants;
begin
  update public.oauth_grants
     set revoked_at = now(), refresh_token_hash = null
   where id = p_id and user_id = auth.uid() and revoked_at is null
  returning * into g;
  if not found then return false; end if;

  -- Revoke the access token too, or the app keeps working until it expires.
  update public.api_tokens set revoked_at = now()
   where id = g.token_id and revoked_at is null;
  return true;
end;
$$;

revoke all on function public.oauth_connection_revoke(uuid) from public, anon;
grant execute on function public.oauth_connection_revoke(uuid) to authenticated;

-- Token revocation from the client side (RFC 7009).
create or replace function public.oauth_token_revoke_by_hash(p_hash text, p_client_id text)
returns boolean
language plpgsql
security definer
set search_path = public as $$
declare g public.oauth_grants;
begin
  update public.oauth_grants
     set revoked_at = now(), refresh_token_hash = null
   where client_id = p_client_id and revoked_at is null
     and (refresh_token_hash = p_hash
          or token_id in (select id from public.api_tokens where token_hash = p_hash))
  returning * into g;
  if not found then return false; end if;
  update public.api_tokens set revoked_at = now() where id = g.token_id and revoked_at is null;
  return true;
end;
$$;

revoke all on function public.oauth_token_revoke_by_hash(text, text) from public, anon, authenticated;

-----------------------------------------------------------------------
-- 6. Keep the two kinds of credential apart
--
-- api_token_list is the list a person sees of tokens THEY made. An OAuth
-- access token is not one of those, and the 20-token ceiling should not be
-- eaten by apps they connected.
-----------------------------------------------------------------------
-- Unchanged but for the one added predicate. The return shape is reproduced
-- exactly — CREATE OR REPLACE cannot alter a function's result type, so a
-- "tidied" column list here would fail outright rather than silently.
create or replace function public.api_token_list()
returns table (
  id uuid, name text, prefix text, scopes text[],
  last_used_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
  created_at timestamptz, req_count integer, req_reset timestamptz
)
language sql
stable
security definer
set search_path = public, auth as $$
  select t.id, t.name, t.prefix, t.scopes,
         t.last_used_at, t.expires_at, t.revoked_at, t.created_at,
         case when now() - t.req_window > interval '1 hour' then 0 else t.req_count end,
         t.req_window + interval '1 hour'
    from public.api_tokens t
   where t.user_id = auth.uid()
     and t.oauth_client_id is null
   order by t.created_at desc;
$$;

revoke all on function public.api_token_list() from public, anon;
grant execute on function public.api_token_list() to authenticated;

create or replace function public.api_token_mint(
  p_name text, p_scopes text[] default array['read'::text], p_ttl_days integer default null
) returns table (id uuid, token text, prefix text)
language plpgsql
security definer
set search_path = public, auth, extensions as $$
declare
  v_token  text;
  v_prefix text;
  v_id     uuid;
  v_name   text := coalesce(nullif(btrim(p_name), ''), 'API token');
  v_scopes text[] := coalesce(p_scopes, array['read']);
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  if not (v_scopes <@ array['read','write','delete']) then
    raise exception 'scopes must be a subset of read, write, delete' using errcode = '22023';
  end if;

  if 'delete' = any(v_scopes) and not ('write' = any(v_scopes)) then
    v_scopes := v_scopes || 'write'::text;
  end if;
  if not ('read' = any(v_scopes)) then
    v_scopes := array['read'] || v_scopes;
  end if;
  select array_agg(s order by array_position(array['read','write','delete'], s))
    into v_scopes
    from (select distinct unnest(v_scopes) as s) d;

  -- Connected apps are counted separately — see oauth_authorize_consent.
  if (select count(*) from public.api_tokens
       where user_id = auth.uid() and revoked_at is null and oauth_client_id is null) >= 20 then
    raise exception 'too many active tokens — revoke one first' using errcode = '54000';
  end if;

  v_token  := 'sk_live_' || encode(extensions.gen_random_bytes(20), 'hex');
  v_prefix := substr(v_token, 1, 14);

  insert into public.api_tokens (user_id, name, token_hash, prefix, scopes, expires_at)
  values (
    auth.uid(), left(v_name, 80),
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_prefix, v_scopes,
    case when p_ttl_days is null then null
         else now() + make_interval(days => greatest(1, least(p_ttl_days, 3650))) end
  )
  returning api_tokens.id into v_id;

  begin
    insert into public.analytics_events (user_id, event, props)
    values (auth.uid(), 'api_token_minted', jsonb_build_object('scopes', v_scopes));
  exception when others then null;
  end;

  return query select v_id, v_token, v_prefix;
end;
$$;

revoke all on function public.api_token_mint(text, text[], integer) from public, anon;
grant execute on function public.api_token_mint(text, text[], integer) to authenticated;

-----------------------------------------------------------------------
-- 7. Housekeeping + the operator's view of connections
-----------------------------------------------------------------------
create or replace function public.purge_oauth_codes()
returns integer
language plpgsql
security definer
set search_path = public as $$
declare n integer;
begin
  delete from public.oauth_codes where expires_at < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_oauth_codes() from public, anon, authenticated;

create or replace function public.admin_oauth_overview(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'days', v_days,
    'clients', (select jsonb_build_object(
        'total', count(*),
        'connected', count(*) filter (where last_used_at is not null),
        'new', count(*) filter (where created_at >= now() - make_interval(days => v_days))
      ) from public.oauth_clients),
    'connections', (select jsonb_build_object(
        'live', count(*) filter (where revoked_at is null),
        'revoked', count(*) filter (where revoked_at is not null),
        'people', count(distinct user_id) filter (where revoked_at is null),
        'new', count(*) filter (where created_at >= now() - make_interval(days => v_days))
      ) from public.oauth_grants),
    'by_client', coalesce((
      select jsonb_agg(x) from (
        select c.client_name as name,
               count(*) filter (where g.revoked_at is null) as live,
               count(*) as total,
               max(g.last_used_at) as last_used_at
          from public.oauth_grants g
          join public.oauth_clients c on c.client_id = g.client_id
         group by c.client_name
         order by count(*) filter (where g.revoked_at is null) desc, c.client_name
         limit 20
      ) x), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_oauth_overview(integer) from public, anon;
grant execute on function public.admin_oauth_overview(integer) to authenticated;
