-- /api/v1 round two: a delete scope, honest rate-limit headers, and a usage log.
--
-- 0215 shipped the API with two scopes and no way for a caller to see how much
-- of its rate limit was left. Both are changed here, and this is the only moment
-- either can change cheaply: api_tokens, api_sessions and api_idempotency are
-- all at ZERO rows, so there is nothing to migrate and nobody to break. Once one
-- person has automation pointed at this, the scope set is permanent.
--
-- WHY A DELETE SCOPE. `write` currently means create, edit, move AND destroy.
-- That is defensible for a script someone wrote themselves, and indefensible for
-- the primary consumer this API was built for: an MCP server handing tools to a
-- language model. "Can add cards to my moodboard" and "can delete my moodboard"
-- are not the same trust decision, and the only thing separating them today is
-- a sentence of prose in a tool description asking the model to confirm first.
-- Prose is not an access control. A third scope is.

-----------------------------------------------------------------------
-- 1. The scope set: read · write · delete
--
--    Independent flags, with two normalizations applied at mint time rather
--    than left to the caller:
--
--      · `read` is always present. Every token can read; there is no useful
--        write-only token, and a token that cannot read cannot check its own
--        work.
--      · `delete` implies `write`. "May destroy but may not edit" is not a
--        coherent permission, and someone ticking only the scary box plainly
--        meant to allow the ordinary ones too.
-----------------------------------------------------------------------
alter table public.api_tokens
  drop constraint if exists api_tokens_scopes_valid;
alter table public.api_tokens
  add constraint api_tokens_scopes_valid
  check (scopes <@ array['read','write','delete']);

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
  if not (v_scopes <@ array['read','write','delete']) then
    raise exception 'scopes must be a subset of read, write, delete' using errcode = '22023';
  end if;

  -- Normalize BEFORE the insert so the stored row is the truth and no reader
  -- has to re-apply these rules. api_token_resolve returns scopes verbatim.
  -- The ::text cast is load-bearing. In `text[] || 'write'` the literal is
  -- UNKNOWN, and Postgres resolves the operator to array||array rather than
  -- array||element — so it tries to parse 'write' as an array literal and
  -- raises 22P02 at runtime. It parses fine, which is why this needs an actual
  -- call to catch.
  if 'delete' = any(v_scopes) and not ('write' = any(v_scopes)) then
    v_scopes := v_scopes || 'write'::text;
  end if;
  if not ('read' = any(v_scopes)) then
    v_scopes := array['read'] || v_scopes;
  end if;
  -- Dedupe, and pin a stable order so two tokens minted with the same intent
  -- compare equal in the UI.
  select array_agg(s order by array_position(array['read','write','delete'], s))
    into v_scopes
    from (select distinct unnest(v_scopes) as s) d;

  if (select count(*) from public.api_tokens
       where user_id = auth.uid() and revoked_at is null) >= 20 then
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
revoke all on function public.api_token_mint(text, text[], int) from public, anon;
grant execute on function public.api_token_mint(text, text[], int) to authenticated;

-----------------------------------------------------------------------
-- 2. api_token_resolve — now returns the rate-limit window.
--
--    Two changes, both about telling the truth:
--
--    (a) The window counters come back, so the Worker can send
--        X-RateLimit-Remaining / -Reset and Retry-After. Without them a caller
--        discovers the limit by being refused, which is the one thing a rate
--        limit should never require. Free to return — this UPDATE already runs
--        on every request.
--
--    (b) Metering happens BEFORE the revoked/expired checks. It used to happen
--        after, so a revoked or expired token was completely unmetered: a
--        leaked-then-revoked credential in a retry loop could call this forever
--        at full rate. `last_used_at` still only moves for a VALID token, or
--        the Settings list would report a revoked token as freshly used.
--
--    Return type changes, so it must be dropped first — a bare CREATE OR
--    REPLACE on a changed OUT-parameter list raises 42P13.
-----------------------------------------------------------------------
drop function if exists public.api_token_resolve(text);

create function public.api_token_resolve(p_token_hash text)
returns table(
  user_id    uuid,
  token_id   uuid,
  scopes     text[],
  reason     text,
  req_count  integer,
  req_limit  integer,
  req_reset  timestamptz
)
language plpgsql security definer
set search_path = public, auth as $$
declare
  t        public.api_tokens%rowtype;
  v_limit  constant integer := 1000;
  v_valid  boolean;
  v_count  integer;
  v_reset  timestamptz;
begin
  select * into t from public.api_tokens where token_hash = p_token_hash;

  -- No row means nothing to meter and nothing to say. A 160-bit token space
  -- makes guessing infeasible, so this needs no counter of its own.
  if not found then
    return query select null::uuid, null::uuid, null::text[], 'unknown'::text,
                        null::integer, v_limit, null::timestamptz;
    return;
  end if;

  v_valid := t.revoked_at is null
             and (t.expires_at is null or t.expires_at > now());

  -- The `a` alias is load-bearing. `req_count` is now also an OUT parameter of
  -- this function, so a bare reference to it inside the statement is ambiguous
  -- between the plpgsql variable and the column (42702). Qualifying with a table
  -- alias resolves to the column, because plpgsql variables cannot be qualified
  -- that way. 0215's version had no OUT parameter with a column's name, which is
  -- why this only broke when the window counters started being returned.
  update public.api_tokens a
     set req_window   = case when now() - a.req_window > interval '1 hour' then now() else a.req_window end,
         req_count    = case when now() - a.req_window > interval '1 hour' then 1 else a.req_count + 1 end,
         last_used_at = case when v_valid then now() else a.last_used_at end
   where a.id = t.id
  returning a.req_count, a.req_window + interval '1 hour'
       into v_count, v_reset;

  -- Rate limiting comes first and applies to every token, valid or not: an
  -- abusive caller should be told to slow down whatever the reason its
  -- credential is bad.
  if v_count > v_limit then
    return query select null::uuid, null::uuid, null::text[], 'rate_limited'::text,
                        v_count, v_limit, v_reset;
    return;
  end if;

  -- revoked / expired answer identically to unknown. Distinguishing them tells
  -- someone holding a stolen token which of their guesses was once real.
  if t.revoked_at is not null then
    return query select null::uuid, null::uuid, null::text[], 'revoked'::text,
                        v_count, v_limit, v_reset;
    return;
  end if;
  if t.expires_at is not null and t.expires_at <= now() then
    return query select null::uuid, null::uuid, null::text[], 'expired'::text,
                        v_count, v_limit, v_reset;
    return;
  end if;

  return query select t.user_id, t.id, t.scopes, null::text, v_count, v_limit, v_reset;
end;
$$;
revoke all on function public.api_token_resolve(text) from public;
revoke all on function public.api_token_resolve(text) from authenticated, anon;

-----------------------------------------------------------------------
-- 3. api_request_log — what a token actually did.
--
--    A public API with no audit trail is one you cannot answer questions
--    about. `last_used_at` says a token is alive; it does not say which board
--    an integration emptied at 3am. This is the difference between "something
--    changed my board" and "this token, this route, this board, this minute".
--
--    Deliberately narrow, and WRITES ONLY. Reads are the overwhelming majority
--    of API traffic and logging them would be mostly noise at real volume; the
--    rows that matter are the ones that changed something.
--
--    `route` is the TEMPLATE (/boards/:id/cards), not the raw path, so the
--    table has bounded cardinality and stays groupable. The board actually
--    touched goes in target_id, where it is queryable.
-----------------------------------------------------------------------
create table if not exists public.api_request_log (
  id         bigserial primary key,
  token_id   uuid not null references public.api_tokens(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  method     text not null,
  route      text not null,
  target_id  uuid,
  status     integer not null,
  ms         integer,
  created_at timestamptz not null default now()
);
create index if not exists api_request_log_user_idx
  on public.api_request_log(user_id, created_at desc);
create index if not exists api_request_log_created_idx
  on public.api_request_log(created_at);

alter table public.api_request_log enable row level security;
-- Same posture as api_tokens: no policies, no table grants. Everything comes
-- back through api_token_usage(), which names its columns — so a column added
-- here later cannot become client-readable by accident. (0203's gotcha: public
-- tables have TABLE-level grants, so every new column inherits them.)
revoke all on table public.api_request_log from anon, authenticated;

create or replace function public.api_log_request(
  p_token_id uuid,
  p_user_id  uuid,
  p_method   text,
  p_route    text,
  p_status   integer,
  p_ms       integer default null,
  p_target   uuid default null
)
returns void
language sql security definer
set search_path = public, auth as $$
  insert into public.api_request_log (token_id, user_id, method, route, target_id, status, ms)
  values (p_token_id, p_user_id, left(p_method, 10), left(p_route, 120), p_target, p_status, p_ms);
$$;
revoke all on function public.api_log_request(uuid, uuid, text, text, integer, integer, uuid) from public;
revoke all on function public.api_log_request(uuid, uuid, text, text, integer, integer, uuid)
  from authenticated, anon;

-- What Settings shows: this person's own recent API writes, newest first.
-- Keyed on auth.uid(), so it cannot return anyone else's rows regardless of
-- which token id is passed.
create or replace function public.api_token_usage(
  p_token_id uuid default null,
  p_limit    int  default 100
)
returns table(
  token_id uuid, token_name text, method text, route text,
  target_id uuid, status integer, ms integer, created_at timestamptz
)
language sql stable security definer
set search_path = public, auth as $$
  select l.token_id, t.name, l.method, l.route,
         l.target_id, l.status, l.ms, l.created_at
    from public.api_request_log l
    join public.api_tokens t on t.id = l.token_id
   where l.user_id = auth.uid()
     and (p_token_id is null or l.token_id = p_token_id)
   order by l.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;
revoke all on function public.api_token_usage(uuid, int) from public, anon;
grant execute on function public.api_token_usage(uuid, int) to authenticated;

-----------------------------------------------------------------------
-- 4. api_token_list — surface the rate-limit window in Settings too.
--    Return type changes → drop first (42P13, same as §2).
-----------------------------------------------------------------------
drop function if exists public.api_token_list();

create function public.api_token_list()
returns table(
  id uuid, name text, prefix text, scopes text[],
  last_used_at timestamptz, expires_at timestamptz,
  revoked_at timestamptz, created_at timestamptz,
  req_count integer, req_reset timestamptz
)
language sql stable security definer
set search_path = public, auth as $$
  select t.id, t.name, t.prefix, t.scopes,
         t.last_used_at, t.expires_at, t.revoked_at, t.created_at,
         -- A stale window has already lapsed; reporting its old count would
         -- show "998 requests used" against an hour that ended yesterday.
         case when now() - t.req_window > interval '1 hour' then 0 else t.req_count end,
         t.req_window + interval '1 hour'
    from public.api_tokens t
   where t.user_id = auth.uid()
   order by t.created_at desc;
$$;
revoke all on function public.api_token_list() from public, anon;
grant execute on function public.api_token_list() to authenticated;

-----------------------------------------------------------------------
-- 5. Retention, and the job 0215 forgot.
--
--    purge_api_idempotency() was written in 0215 and NEVER SCHEDULED, so
--    api_idempotency has been set up to grow without bound from the first API
--    call onward. It is at zero rows today only because no token exists yet.
--    Both purges are scheduled here, in the 03:xx retention block with the
--    rest (0052, 0108).
-----------------------------------------------------------------------
create or replace function public.purge_api_request_log(p_retention_days int default 30)
returns integer
language plpgsql security definer
set search_path = public, auth as $$
declare v_n integer;
begin
  delete from public.api_request_log
   where created_at < now() - make_interval(days => greatest(1, p_retention_days));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.purge_api_request_log(int) from public;
revoke all on function public.purge_api_request_log(int) from authenticated, anon;

do $$ begin
  perform cron.unschedule('purge_api_idempotency');
exception when others then null;
end $$;
select cron.schedule('purge_api_idempotency', '45 3 * * *',
                     $$ select public.purge_api_idempotency(24); $$);

do $$ begin
  perform cron.unschedule('purge_api_request_log');
exception when others then null;
end $$;
select cron.schedule('purge_api_request_log', '50 3 * * *',
                     $$ select public.purge_api_request_log(30); $$);
