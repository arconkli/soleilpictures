-- Personal access tokens for /api/v1 — the public API.
--
-- Purpose: let someone drive their own Clusters boards from their own software,
-- and let an AI assistant do it through MCP. One token, one user, revocable.
--
-- HOW AUTHORIZATION WORKS, AND WHY THERE ARE NO PERMISSION RPCs HERE.
-- A token is not a capability. The Worker exchanges it for a REAL Supabase user
-- session (mint a magiclink server-side, verify it, cache the refresh token —
-- the path scoutDb.js already uses for the headless Yjs peer) and then performs
-- every operation as that user, through PostgREST, under ordinary RLS.
--
-- That is the whole security model, and it is deliberate. The alternative —
-- service-role calls guarded by explicit p_user_id checks — means every new
-- endpoint is a fresh chance to forget a check, and the failure mode is silent
-- and total. Going through the user's own session means the API cannot, by
-- construction, do anything the person could not do in the browser. Existing
-- policies, existing caps, existing triggers. Nothing new to keep in sync.
--
-- (Self-signing an HS256 JWT would be cheaper than a magiclink round trip, and
-- is ruled out for the reason recorded in scoutDb.js: this project has partly
-- moved to publishable keys, so the legacy shared secret may not be honored.)
--
-- Posture matches the Scout schema: RLS enabled, NO policies, table grants
-- revoked. Everything goes through the functions below, which name their
-- columns — so `token_hash` cannot leak through a policy someone adds later.

-----------------------------------------------------------------------
-- 1. api_tokens
--
--    Only the SHA-256 of the token is stored. A leaked database backup is
--    therefore not a set of working credentials, and there is no "show me my
--    token again" — the plaintext exists exactly once, in the response to the
--    call that created it.
-----------------------------------------------------------------------
create table if not exists public.api_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  -- sha256 hex of the plaintext. Unique so a (vanishingly unlikely) duplicate
  -- is a hard error rather than two users sharing one credential.
  token_hash    text not null unique,
  -- Enough of the token to recognise it in a list. NOT enough to use.
  prefix        text not null,
  scopes        text[] not null default array['read'],
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  -- Rolling rate-limit window, kept on the row so the resolve call that already
  -- happens on every request can enforce it without a second round trip.
  req_count     integer not null default 0,
  req_window    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  constraint api_tokens_scopes_valid check (scopes <@ array['read','write'])
);
create index if not exists api_tokens_user_idx on public.api_tokens(user_id);

alter table public.api_tokens enable row level security;
-- Deliberately NO policies: service_role bypasses RLS, everyone else is denied
-- and reads their own tokens through api_token_list() instead.
revoke all on table public.api_tokens from anon, authenticated;

-----------------------------------------------------------------------
-- 2. api_sessions — the cached Supabase session each token resolves to.
--
--    Mirrors scout_accounts.refresh_token and exists for the same reason: the
--    magiclink mint is the expensive step, and refresh tokens rotate, so the
--    latest one has to live somewhere the Worker can rewrite. Separate from
--    scout_accounts because an API user is not a Scout user and putting them in
--    that table would quietly redefine what "a Scout account" means.
-----------------------------------------------------------------------
create table if not exists public.api_sessions (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  refresh_token    text,
  access_token_exp timestamptz,
  updated_at       timestamptz not null default now()
);
alter table public.api_sessions enable row level security;
revoke all on table public.api_sessions from anon, authenticated;

-----------------------------------------------------------------------
-- 3. api_token_mint — called BY the signed-in user, from Settings.
--
--    Returns the plaintext, once. Generated in the database rather than in the
--    Worker so the only copy that ever exists outside this transaction is the
--    one handed to the caller.
-----------------------------------------------------------------------
create or replace function public.api_token_mint(
  p_name     text,
  p_scopes   text[] default array['read'],
  p_ttl_days int default null
)
returns table(id uuid, token text, prefix text)
language plpgsql security definer
set search_path = public, auth as $$
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
  if not (v_scopes <@ array['read','write']) or array_length(v_scopes, 1) is null then
    raise exception 'scopes must be a non-empty subset of read, write' using errcode = '22023';
  end if;

  -- A ceiling, not a quota: it exists so a loop that mints instead of reusing
  -- cannot fill the table. Revoked tokens do not count against it.
  if (select count(*) from public.api_tokens
       where user_id = auth.uid() and revoked_at is null) >= 20 then
    raise exception 'too many active tokens — revoke one first' using errcode = '54000';
  end if;

  -- 160 bits. `sk_` so secret-scanners recognise it on sight, and a caller who
  -- pastes one into a public repo has a chance of being told.
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
revoke all on function public.api_token_mint(text, text[], int) from public, anon;
grant execute on function public.api_token_mint(text, text[], int) to authenticated;

-----------------------------------------------------------------------
-- 4. api_token_list / api_token_revoke — managing them from Settings.
--    The list names its columns; token_hash is not among them.
-----------------------------------------------------------------------
create or replace function public.api_token_list()
returns table(
  id uuid, name text, prefix text, scopes text[],
  last_used_at timestamptz, expires_at timestamptz,
  revoked_at timestamptz, created_at timestamptz
)
language sql stable security definer
set search_path = public, auth as $$
  select t.id, t.name, t.prefix, t.scopes,
         t.last_used_at, t.expires_at, t.revoked_at, t.created_at
    from public.api_tokens t
   where t.user_id = auth.uid()
   order by t.created_at desc;
$$;
revoke all on function public.api_token_list() from public, anon;
grant execute on function public.api_token_list() to authenticated;

create or replace function public.api_token_revoke(p_id uuid)
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
declare v_ok boolean := false;
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  update public.api_tokens
     set revoked_at = now()
   where id = p_id and user_id = auth.uid() and revoked_at is null;
  get diagnostics v_ok = row_count;
  return v_ok;
end;
$$;
revoke all on function public.api_token_revoke(uuid) from public, anon;
grant execute on function public.api_token_revoke(uuid) to authenticated;

-----------------------------------------------------------------------
-- 5. api_token_resolve — the Worker's per-request call. Service-role only.
--
--    Does authentication, expiry, revocation, last_used and rate limiting in
--    ONE statement, because it runs on every single API request and each extra
--    round trip is paid by every caller.
--
--    Takes the HASH, never the token: the plaintext should not travel further
--    into the system than the edge that received it, and it never needs to.
--
--    Returns exactly one row. `reason` says why a request is refused so the
--    Worker can pick a status code without a second lookup — but the caller is
--    only ever told "invalid token" or "rate limited", never which token
--    matched or when it expired.
-----------------------------------------------------------------------
create or replace function public.api_token_resolve(p_token_hash text)
returns table(user_id uuid, token_id uuid, scopes text[], reason text)
language plpgsql security definer
set search_path = public, auth as $$
declare
  t public.api_tokens%rowtype;
begin
  select * into t from public.api_tokens where token_hash = p_token_hash;

  if not found then
    return query select null::uuid, null::uuid, null::text[], 'unknown'::text; return;
  end if;
  if t.revoked_at is not null then
    return query select null::uuid, null::uuid, null::text[], 'revoked'::text; return;
  end if;
  if t.expires_at is not null and t.expires_at <= now() then
    return query select null::uuid, null::uuid, null::text[], 'expired'::text; return;
  end if;

  -- Rolling hourly window. Generous enough that no honest script notices, low
  -- enough that a runaway loop stops before it costs anything. Reset and count
  -- in the same UPDATE so two concurrent requests cannot both see a fresh window.
  update public.api_tokens
     set req_window   = case when now() - req_window > interval '1 hour' then now() else req_window end,
         req_count    = case when now() - req_window > interval '1 hour' then 1 else req_count + 1 end,
         last_used_at = now()
   where api_tokens.id = t.id
  returning api_tokens.req_count into t.req_count;

  if t.req_count > 1000 then
    return query select null::uuid, null::uuid, null::text[], 'rate_limited'::text; return;
  end if;

  return query select t.user_id, t.id, t.scopes, null::text;
end;
$$;
revoke all on function public.api_token_resolve(text) from public;
revoke all on function public.api_token_resolve(text) from authenticated, anon;

-----------------------------------------------------------------------
-- 6. api_idempotency — replay protection for POSTs.
--
--    Scripts and integrations retry. Without this, a retried "create these
--    cards" makes them twice, and the caller has no way to tell that from two
--    genuine calls. Same problem scout_ingest_log solves for inbound messages,
--    same shape: a unique key, claimed before the work is done.
--
--    The stored response is replayed verbatim on a repeat, so a retry after a
--    dropped connection returns the ids the first call created rather than a
--    conflict the caller has to interpret.
-----------------------------------------------------------------------
create table if not exists public.api_idempotency (
  token_id    uuid not null references public.api_tokens(id) on delete cascade,
  key         text not null,
  response    jsonb,
  status      integer,
  created_at  timestamptz not null default now(),
  primary key (token_id, key)
);
create index if not exists api_idempotency_created_idx on public.api_idempotency(created_at);
alter table public.api_idempotency enable row level security;
revoke all on table public.api_idempotency from anon, authenticated;

-- Claim a key. Returns the stored response if this key has been seen, or a row
-- with claimed = true if the caller now owns it and should do the work.
create or replace function public.api_idempotency_claim(
  p_token_id uuid,
  p_key      text
)
returns table(claimed boolean, response jsonb, status integer)
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_existing public.api_idempotency%rowtype;
begin
  insert into public.api_idempotency (token_id, key)
  values (p_token_id, p_key)
  on conflict (token_id, key) do nothing;

  if found then
    return query select true, null::jsonb, null::integer; return;
  end if;

  select * into v_existing from public.api_idempotency
   where token_id = p_token_id and key = p_key;
  -- response IS NULL means the first attempt claimed the key and never came
  -- back. Treat it as still in flight rather than replaying an empty success.
  return query select false, v_existing.response, v_existing.status;
end;
$$;
revoke all on function public.api_idempotency_claim(uuid, text) from public;
revoke all on function public.api_idempotency_claim(uuid, text) from authenticated, anon;

create or replace function public.api_idempotency_store(
  p_token_id uuid,
  p_key      text,
  p_response jsonb,
  p_status   integer
)
returns void
language sql security definer
set search_path = public, auth as $$
  update public.api_idempotency
     set response = p_response, status = p_status
   where token_id = p_token_id and key = p_key;
$$;
revoke all on function public.api_idempotency_store(uuid, text, jsonb, integer) from public;
revoke all on function public.api_idempotency_store(uuid, text, jsonb, integer) from authenticated, anon;

-- Keys are only useful for as long as a client might retry. Kept for 24h.
create or replace function public.purge_api_idempotency(p_retention_hours int default 24)
returns integer
language plpgsql security definer
set search_path = public, auth as $$
declare v_n integer;
begin
  delete from public.api_idempotency
   where created_at < now() - make_interval(hours => greatest(1, p_retention_hours));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.purge_api_idempotency(int) from public;
revoke all on function public.purge_api_idempotency(int) from authenticated, anon;
