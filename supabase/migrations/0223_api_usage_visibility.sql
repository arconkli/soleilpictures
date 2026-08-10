-- 0223_api_usage_visibility.sql
--
-- /api/v1 and the MCP server shipped with an audit log that only the CALLER can
-- read (api_audit_read, scoped to auth.uid() and the service accounts of
-- workspaces they own). That is the right boundary for a customer. It leaves
-- the operator with no answer at all to the question that decides whether any
-- of this was worth building: is anyone using it, who, through which door, and
-- is it failing them?
--
-- Two gaps, and the first one is the one that matters:
--
--   1. EVERY MCP CALL LOOKS THE SAME. The Worker records `route` — and the
--      hosted MCP server is one route, `/mcp`. So a log of ten thousand MCP
--      calls says "POST /mcp" ten thousand times. Which tool an agent actually
--      reached for is the single most useful fact about MCP traffic (it is the
--      product feedback: models pick tools by their descriptions, so the
--      distribution tells you which descriptions work), and it was not
--      recorded. `tool` fixes that, and it carries the JSON-RPC method for the
--      non-tool calls too, so `tools/list` is distinguishable from a tool run.
--
--   2. NOTHING AGGREGATES. There is no read path an admin page could call.
--
-- The new admin_api_* functions are all read-only aggregates over
-- api_request_log, api_tokens, service_accounts and webhooks. They add no
-- column to any user-facing surface and change no permission: is_admin() is
-- checked first in every one, and every function is revoked from anon.
--
-- One deliberate asymmetry worth stating: admin_user_api_usage reports both the
-- tokens a person holds AND the service accounts in workspaces they own. A
-- studio's integration runs as a service account, not as the human who set it
-- up, so a per-user view that showed only their own tokens would report zero
-- for exactly the accounts doing the most.

-----------------------------------------------------------------------
-- 1. Record which tool was called
--
-- Nullable and backfill-free: rows written before this migration genuinely do
-- not know, and inventing a value for them would be worse than a null that
-- reads as "from before we recorded it".
-----------------------------------------------------------------------
alter table public.api_request_log add column if not exists tool text;

-- The two aggregate shapes the admin page asks for. Both are partial on the
-- window the page actually queries; a full scan of the log to draw a 30-day
-- chart is the thing that turns a dashboard into an outage.
create index if not exists api_request_log_tool_idx
  on public.api_request_log (tool, created_at desc)
  where tool is not null;

create index if not exists api_request_log_route_idx
  on public.api_request_log (route, created_at desc);

-- api_log_request gains p_tool. The 7-argument version is DROPPED rather than
-- left in place: PostgREST resolves an RPC by the names in the JSON body, and
-- two overloads that differ only by an argument with a default is exactly the
-- shape that resolves ambiguously. One function, one signature.
drop function if exists public.api_log_request(uuid, uuid, text, text, integer, integer, uuid);

create or replace function public.api_log_request(
  p_token_id uuid,
  p_user_id  uuid,
  p_method   text,
  p_route    text,
  p_status   integer,
  p_ms       integer,
  p_target   uuid,
  p_tool     text default null
) returns void
language sql
security definer
set search_path = public as $$
  insert into public.api_request_log (token_id, user_id, method, route, target_id, status, ms, tool)
  values (p_token_id, p_user_id, left(p_method, 10), left(p_route, 120), p_target, p_status, p_ms,
          nullif(left(p_tool, 80), ''));
$$;

revoke all on function public.api_log_request(uuid, uuid, text, text, integer, integer, uuid, text)
  from public, anon, authenticated;

-- The caller-facing audit read gains the same column. Same predicate, same
-- scoping — the only change is that an MCP entry can now say what it did.
drop function if exists public.api_audit_read(timestamptz, bigint, integer);

create or replace function public.api_audit_read(
  p_since  timestamptz default null,
  p_cursor bigint default null,
  p_limit  integer default 100
) returns table (
  id bigint, created_at timestamptz, actor text, actor_id uuid,
  token_id uuid, token_name text, method text, route text, tool text,
  target_id uuid, status integer, ms integer
)
language sql
stable
security definer
set search_path = public, auth as $$
  select l.id, l.created_at, coalesce(s.name, p.display_name, 'you'),
         l.user_id, l.token_id, t.name,
         l.method, l.route, l.tool, l.target_id, l.status, l.ms
    from public.api_request_log l
    left join public.api_tokens t on t.id = l.token_id
    left join public.service_accounts s on s.user_id = l.user_id
    left join public.profiles p on p.user_id = l.user_id
   where (l.user_id = auth.uid()
          or l.user_id in (select sa.user_id from public.service_accounts sa
                             join public.workspaces w on w.id = sa.workspace_id
                            where w.created_by = auth.uid()))
     and (p_since is null or l.created_at >= p_since)
     and (p_cursor is null or l.id < p_cursor)
   order by l.id desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.api_audit_read(timestamptz, bigint, integer) from public, anon;
grant execute on function public.api_audit_read(timestamptz, bigint, integer) to authenticated;

-----------------------------------------------------------------------
-- 2. The operator's view
--
-- Every function below: admin-only, read-only, and bounded. p_days is clamped
-- to 1..365 and p_limit to 1..200 inside the function rather than trusted from
-- the caller, so a mistyped parameter in the UI cannot ask for a table scan.
-----------------------------------------------------------------------

-- Headline counts. One round trip for the whole strip at the top of the tab.
create or replace function public.admin_api_overview(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth as $$
declare
  v_days  integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := now() - make_interval(days => v_days);
  v_out   jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'days', v_days,
    'since', v_since,
    'tokens', (
      select jsonb_build_object(
        'total',   count(*),
        'live',    count(*) filter (where revoked_at is null
                                      and (expires_at is null or expires_at > now())),
        'revoked', count(*) filter (where revoked_at is not null),
        'expired', count(*) filter (where revoked_at is null
                                      and expires_at is not null and expires_at <= now()),
        -- A token that was minted and never presented is a DIFFERENT failure
        -- from one that was never minted: the first means the docs got someone
        -- as far as Settings and no further.
        'used',    count(*) filter (where last_used_at is not null),
        'holders', count(distinct user_id)
      ) from public.api_tokens
    ),
    'service_accounts', (
      select jsonb_build_object('total', count(*), 'active', count(*) filter (where disabled_at is null))
        from public.service_accounts
    ),
    'webhooks', (
      select jsonb_build_object('total', count(*), 'active', count(*) filter (where active))
        from public.webhooks
    ),
    'identifiers', (select count(*) from public.object_identifiers),
    'calls', (
      select jsonb_build_object(
        'total',   count(*),
        'mcp',     count(*) filter (where route = '/mcp'),
        'rest',    count(*) filter (where route is distinct from '/mcp'),
        'errors',  count(*) filter (where status >= 400),
        'callers', count(distinct user_id),
        'p50_ms',  percentile_disc(0.5) within group (order by ms),
        'p95_ms',  percentile_disc(0.95) within group (order by ms)
      ) from public.api_request_log where created_at >= v_since
    ),
    'first_call_at', (select min(created_at) from public.api_request_log),
    'last_call_at',  (select max(created_at) from public.api_request_log)
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.admin_api_overview(integer) from public, anon;
grant execute on function public.admin_api_overview(integer) to authenticated;

-- Calls per day, split by door. generate_series so a quiet day is a zero in the
-- chart rather than a missing point the line interpolates straight through.
create or replace function public.admin_api_series(p_days integer default 30)
returns table (day date, calls bigint, mcp_calls bigint, rest_calls bigint,
               errors bigint, callers bigint)
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

  return query
  with d as (
    select generate_series((current_date - (v_days - 1))::date, current_date, '1 day')::date as day
  )
  select d.day,
         count(l.id),
         count(l.id) filter (where l.route = '/mcp'),
         count(l.id) filter (where l.route is distinct from '/mcp'),
         count(l.id) filter (where l.status >= 400),
         count(distinct l.user_id)
    from d
    left join public.api_request_log l
      on l.created_at >= d.day and l.created_at < d.day + 1
   group by d.day
   order by d.day;
end;
$$;

revoke all on function public.admin_api_series(integer) from public, anon;
grant execute on function public.admin_api_series(integer) to authenticated;

-- Which tools models actually reach for. This is the product feedback loop for
-- tool DESCRIPTIONS — a tool nobody calls is usually a tool nobody understood.
create or replace function public.admin_api_tools(p_days integer default 30, p_limit integer default 25)
returns table (tool text, calls bigint, errors bigint, callers bigint,
               p95_ms integer, last_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, auth as $$
declare
  v_days  integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 200));
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
  select l.tool,
         count(*),
         count(*) filter (where l.status >= 400),
         count(distinct l.user_id),
         (percentile_disc(0.95) within group (order by l.ms))::integer,
         max(l.created_at)
    from public.api_request_log l
   where l.created_at >= now() - make_interval(days => v_days)
     and l.tool is not null
   group by l.tool
   order by count(*) desc, l.tool
   limit v_limit;
end;
$$;

revoke all on function public.admin_api_tools(integer, integer) from public, anon;
grant execute on function public.admin_api_tools(integer, integer) to authenticated;

-- The REST half, by templated route.
--
-- `/mcp` is EXCLUDED. It is one route carrying the great majority of traffic,
-- so leaving it in makes it the first row of every window and pushes the actual
-- REST surface below the fold — a table that answers "how is MCP doing" twice
-- and "how is REST doing" not at all. admin_api_tools is where MCP is broken
-- down, and it breaks it down by something useful.
create or replace function public.admin_api_routes(p_days integer default 30, p_limit integer default 25)
returns table (method text, route text, calls bigint, errors bigint,
               p95_ms integer, last_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, auth as $$
declare
  v_days  integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 200));
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
  select l.method, l.route,
         count(*),
         count(*) filter (where l.status >= 400),
         (percentile_disc(0.95) within group (order by l.ms))::integer,
         max(l.created_at)
    from public.api_request_log l
   where l.created_at >= now() - make_interval(days => v_days)
     and l.route is distinct from '/mcp'
   group by l.method, l.route
   order by count(*) desc, l.route
   limit v_limit;
end;
$$;

revoke all on function public.admin_api_routes(integer, integer) from public, anon;
grant execute on function public.admin_api_routes(integer, integer) to authenticated;

-- Who is calling. A service account is named as one — it is a credential, not a
-- person, and a list that showed `svc+<uuid>@service.soleilpictures.com` as a
-- user would be actively misleading about how many humans are integrating.
create or replace function public.admin_api_callers(p_days integer default 30, p_limit integer default 50)
returns table (user_id uuid, email text, display_name text, tier text,
               is_service_account boolean, service_of text,
               tokens bigint, calls bigint, mcp_calls bigint, errors bigint,
               first_call_at timestamptz, last_call_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, auth as $$
declare
  v_days  integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
  with agg as (
    select l.user_id as uid,
           count(*) as n,
           count(*) filter (where l.route = '/mcp') as n_mcp,
           count(*) filter (where l.status >= 400) as n_err,
           min(l.created_at) as first_at,
           max(l.created_at) as last_at
      from public.api_request_log l
     where l.created_at >= now() - make_interval(days => v_days)
     group by l.user_id
  )
  select a.uid,
         u.email::text,
         p.display_name,
         p.tier,
         (s.user_id is not null),
         w.name,
         (select count(*) from public.api_tokens t where t.user_id = a.uid),
         a.n, a.n_mcp, a.n_err, a.first_at, a.last_at
    from agg a
    left join auth.users u on u.id = a.uid
    left join public.profiles p on p.user_id = a.uid
    left join public.service_accounts s on s.user_id = a.uid
    left join public.workspaces w on w.id = s.workspace_id
   order by a.n desc, a.last_at desc
   limit v_limit;
end;
$$;

revoke all on function public.admin_api_callers(integer, integer) from public, anon;
grant execute on function public.admin_api_callers(integer, integer) to authenticated;

-- The tail. Defaults to everything; p_only_errors narrows it to the calls that
-- failed, which is the view you want when someone says "it's not working".
create or replace function public.admin_api_recent(
  p_limit integer default 100,
  p_only_errors boolean default false
) returns table (
  id bigint, at timestamptz, user_id uuid, email text, is_service_account boolean,
  token_name text, method text, route text, tool text, status integer, ms integer,
  target_id uuid
)
language plpgsql
stable
security definer
set search_path = public, auth as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
  select l.id, l.created_at, l.user_id, u.email::text, (s.user_id is not null),
         t.name, l.method, l.route, l.tool, l.status, l.ms, l.target_id
    from public.api_request_log l
    left join auth.users u on u.id = l.user_id
    left join public.api_tokens t on t.id = l.token_id
    left join public.service_accounts s on s.user_id = l.user_id
   where (not coalesce(p_only_errors, false) or l.status >= 400)
   order by l.id desc
   limit v_limit;
end;
$$;

revoke all on function public.admin_api_recent(integer, boolean) from public, anon;
grant execute on function public.admin_api_recent(integer, boolean) to authenticated;

-- One person's integration footprint, for the Users tab detail pane.
--
-- Reports THREE things that are easy to conflate: the tokens they hold, the
-- service accounts in workspaces they own (which call as themselves, not as
-- this person), and the traffic from both together. `calls_own` vs
-- `calls_service` keeps the distinction visible instead of summing it away.
create or replace function public.admin_user_api_usage(p_user_id uuid, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth as $$
declare
  v_days  integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := now() - make_interval(days => v_days);
  v_ids   uuid[];
  v_out   jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_user_id is null then return null; end if;

  -- The person, plus every service account in a workspace they created.
  select array_agg(distinct id) into v_ids
    from (
      select p_user_id as id
      union
      select sa.user_id from public.service_accounts sa
        join public.workspaces w on w.id = sa.workspace_id
       where w.created_by = p_user_id
    ) x;

  select jsonb_build_object(
    'days', v_days,
    'tokens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'prefix', t.prefix, 'scopes', t.scopes,
               'created_at', t.created_at, 'last_used_at', t.last_used_at,
               'expires_at', t.expires_at, 'revoked_at', t.revoked_at,
               'req_limit', t.req_limit, 'req_count', t.req_count,
               'is_service_account', (t.workspace_id is not null))
               order by t.created_at desc)
        from public.api_tokens t where t.user_id = any(v_ids)), '[]'::jsonb),
    'service_accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', sa.user_id, 'name', sa.name, 'workspace', w.name,
               'created_at', sa.created_at, 'disabled_at', sa.disabled_at)
               order by sa.created_at desc)
        from public.service_accounts sa
        join public.workspaces w on w.id = sa.workspace_id
       where w.created_by = p_user_id), '[]'::jsonb),
    'webhooks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'name', h.name, 'url', h.url, 'events', h.events,
               'active', h.active, 'failure_count', h.failure_count)
               order by h.created_at desc)
        from public.webhooks h
        join public.workspaces w on w.id = h.workspace_id
       where w.created_by = p_user_id), '[]'::jsonb),
    'calls', (
      select jsonb_build_object(
        'total',         count(*),
        'own',           count(*) filter (where l.user_id = p_user_id),
        'service',       count(*) filter (where l.user_id <> p_user_id),
        'mcp',           count(*) filter (where l.route = '/mcp'),
        'rest',          count(*) filter (where l.route is distinct from '/mcp'),
        'errors',        count(*) filter (where l.status >= 400),
        'p95_ms',        percentile_disc(0.95) within group (order by l.ms),
        'first_call_at', min(l.created_at),
        'last_call_at',  max(l.created_at)
      ) from public.api_request_log l
       where l.user_id = any(v_ids) and l.created_at >= v_since
    ),
    'top_tools', coalesce((
      select jsonb_agg(x) from (
        select l.tool, count(*) as calls
          from public.api_request_log l
         where l.user_id = any(v_ids) and l.created_at >= v_since and l.tool is not null
         group by l.tool order by count(*) desc, l.tool limit 8
      ) x), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(x) from (
        select l.created_at as at, l.method, l.route, l.tool, l.status, l.ms
          from public.api_request_log l
         where l.user_id = any(v_ids)
         order by l.id desc limit 10
      ) x), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.admin_user_api_usage(uuid, integer) from public, anon;
grant execute on function public.admin_user_api_usage(uuid, integer) to authenticated;
