-- 0700 — The connect funnel: where a connection to the API or MCP server stops.
--
-- Connecting Claude, ChatGPT, Cursor or a script to Clusters takes six steps:
-- the client registers (oauth_clients); the person reaches /oauth/authorize
-- (signed out, that is a landing_view with that path); sees the consent
-- screen (oauth_authorize_view); allows it (oauth_consent_allowed, with the
-- server's oauth_consent_granted beside it); the client trades the code for a
-- token (oauth_grants); and the token is used, first for any tool, then for
-- one that writes (api_request_log). Until now only the first and the last of
-- those could be seen, so nobody could say where people stopped.
--
-- admin_mcp_funnel(p_days, p_exclude_internal) answers for the last p_days
-- (1 to 90), per redirect host, plus the latest clients one by one. A host is
-- the client's first registered callback, bucketed the way
-- lib/oauthConnect.js redirectHostOf buckets it for the consent page's events:
-- an https host, 'loopback' for a callback on the person's own computer, or a
-- private scheme such as 'cursor:'. People are counted once per step (distinct
-- users); registrations, which no person owns, are counted as clients.
-- api_request_log keeps 30 days (purge_api_request_log), so the call steps
-- cannot look further back than that.
--
-- A tool call is a log row naming a tool, not a protocol method (ping,
-- initialize, tools/list, …), or a REST call made with an OAuth token. A write
-- is a successful call to any tool outside the read pattern below;
-- mcpFunnelMigration.test.mjs holds that pattern to the readOnlyHint of every
-- tool in lib/mcpTools.js, so a new tool cannot be miscounted silently.
--
-- Admin only. It returns ids, the names clients gave themselves, counts and
-- times: never a token, a code, a redirect URI, or anything a person wrote.

begin;

set local lock_timeout = '3s';

create or replace function public._oauth_redirect_host(p_uri text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case
    when p_uri is null or p_uri = '' then 'invalid'
    when p_uri ~* '^https?://(localhost|127\.0\.0\.1|\[::1\])([:/?#]|$)' then 'loopback'
    when p_uri ~* '^https?://[^/?#@:]' or p_uri ~* '^https?://[^/?#]*@[^/?#:]'
      then lower(substring(p_uri from '^[A-Za-z]+://(?:[^@/?#]*@)?([^:/?#]+)'))
    when p_uri ~* '^https?:' then 'invalid'
    when p_uri ~ '^[A-Za-z][A-Za-z0-9+.-]*:' then lower(substring(p_uri from '^([A-Za-z][A-Za-z0-9+.-]*:)'))
    else 'invalid'
  end
$function$;

create or replace function public.admin_mcp_funnel(
  p_days integer default 30,
  p_exclude_internal boolean default true
)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 1), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_out jsonb;
begin
  perform public._require_admin();

  with internal as (
    select iu.user_id from public._internal_user_ids() iu where p_exclude_internal
  ),
  clients as (
    select c.client_id, c.client_name, c.created_at, c.disabled_at,
           public._oauth_redirect_host(c.redirect_uris[1]) as host,
           case when c.client_id ~* '^https://' then 'cimd' else 'dcr' end as kind
      from public.oauth_clients c
  ),
  ev as (
    select e.user_id, e.event, e.occurred_at,
           left(coalesce(nullif(e.props->>'redirect_host', ''), 'unknown'), 100) as host,
           e.props->>'client_id' as client_id,
           (e.props->>'new_account') = 'true' as new_account
      from public.analytics_events e
     where e.event in ('oauth_authorize_view', 'oauth_consent_allowed',
                       'oauth_consent_denied', 'oauth_authorize_error')
       and e.occurred_at >= v_since
       and not exists (select 1 from internal i where i.user_id = e.user_id)
  ),
  grants as (
    select g.user_id, g.client_id, g.created_at, c.host
      from public.oauth_grants g
      join clients c on c.client_id = g.client_id
     where g.created_at >= v_since
       and not exists (select 1 from internal i where i.user_id = g.user_id)
  ),
  calls as (
    select t.user_id, t.oauth_client_id as client_id, c.host,
           count(*) filter (where k.is_call) as tool_calls,
           count(*) filter (where k.is_write) as writes,
           min(l.created_at) filter (where k.is_call) as first_call_at,
           min(l.created_at) filter (where k.is_write) as first_write_at,
           max(l.created_at) as last_at
      from public.api_request_log l
      join public.api_tokens t on t.id = l.token_id
      join clients c on c.client_id = t.oauth_client_id
      cross join lateral (
        select x.is_call,
               x.is_write_kind and x.is_call and l.status < 400 as is_write
          from (select coalesce(l.tool ~ '^[a-z_]+$' and l.tool not in ('ping', 'initialize'), false)
                       or (l.tool is null and l.route <> '/mcp') as is_call,
                       case when l.tool is null then l.method <> 'GET'
                            else l.tool !~ '^(whoami|search|fetch|resolve_identifier|board_tree|(list|get|read|view|show|export)_[a-z_]+)$'
                       end as is_write_kind) x
      ) k
     where l.created_at >= v_since
       and not exists (select 1 from internal i where i.user_id = t.user_id)
     group by t.user_id, t.oauth_client_id, c.host
  ),
  hosts as (
    select c.host from clients c where c.created_at >= v_since
    union select e.host from ev e
    union select g.host from grants g
    union select x.host from calls x
  ),
  by_host as (
    select h.host,
      (select count(*) from clients c where c.host = h.host and c.created_at >= v_since) as registered,
      (select count(distinct e.user_id) from ev e where e.host = h.host and e.event = 'oauth_authorize_view') as viewed,
      (select count(distinct e.user_id) from ev e where e.host = h.host and e.event = 'oauth_authorize_view' and e.new_account) as new_accounts,
      (select count(distinct e.user_id) from ev e where e.host = h.host and e.event = 'oauth_consent_allowed') as allowed,
      (select count(distinct e.user_id) from ev e where e.host = h.host and e.event = 'oauth_consent_denied') as denied,
      (select count(*) from ev e where e.host = h.host and e.event = 'oauth_authorize_error') as errors,
      (select count(distinct g.user_id) from grants g where g.host = h.host) as token,
      (select count(distinct x.user_id) from calls x where x.host = h.host and x.tool_calls > 0) as called,
      (select count(distinct x.user_id) from calls x where x.host = h.host and x.writes > 0) as wrote,
      (select coalesce(sum(x.tool_calls), 0) from calls x where x.host = h.host) as tool_calls,
      (select coalesce(sum(x.writes), 0) from calls x where x.host = h.host) as writes
    from hosts h
  ),
  recent as (
    select c.client_id, c.client_name, c.kind, c.host, c.created_at as registered_at,
           c.disabled_at is not null as disabled,
           (select min(e.occurred_at) from ev e where e.client_id = c.client_id and e.event = 'oauth_authorize_view') as viewed_at,
           (select min(e.occurred_at) from ev e where e.client_id = c.client_id and e.event = 'oauth_consent_allowed') as allowed_at,
           (select min(e.occurred_at) from ev e where e.client_id = c.client_id and e.event = 'oauth_consent_denied') as denied_at,
           (select min(g.created_at) from grants g where g.client_id = c.client_id) as token_at,
           (select min(x.first_call_at) from calls x where x.client_id = c.client_id) as first_call_at,
           (select min(x.first_write_at) from calls x where x.client_id = c.client_id) as first_write_at,
           (select coalesce(sum(x.tool_calls), 0) from calls x where x.client_id = c.client_id) as tool_calls,
           (select coalesce(sum(x.writes), 0) from calls x where x.client_id = c.client_id) as writes,
           (select count(distinct p.user_id) from (
              select e.user_id from ev e where e.client_id = c.client_id
              union select g.user_id from grants g where g.client_id = c.client_id
              union select x.user_id from calls x where x.client_id = c.client_id) p) as people,
           greatest(c.created_at,
                    (select max(e.occurred_at) from ev e where e.client_id = c.client_id),
                    (select max(g.created_at) from grants g where g.client_id = c.client_id),
                    (select max(x.last_at) from calls x where x.client_id = c.client_id)) as last_at
      from clients c
     where c.created_at >= v_since
        or exists (select 1 from ev e where e.client_id = c.client_id)
        or exists (select 1 from grants g where g.client_id = c.client_id)
        or exists (select 1 from calls x where x.client_id = c.client_id)
  )
  select jsonb_build_object(
    'days', v_days,
    'since', v_since,
    'signed_out_arrivals', (select count(distinct a.session_id) from public.analytics_events a
                             where a.event = 'landing_view' and a.occurred_at >= v_since
                               and a.path = '/oauth/authorize'),
    'server_grants', (select count(distinct a.user_id) from public.analytics_events a
                       where a.event = 'oauth_consent_granted' and a.occurred_at >= v_since
                         and not exists (select 1 from internal i where i.user_id = a.user_id)),
    'hosts', coalesce((select jsonb_agg(to_jsonb(b) order by b.viewed desc, b.registered desc, b.host)
                         from by_host b), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(to_jsonb(r) - 'last_at' order by r.last_at desc)
                          from (select * from recent order by last_at desc limit 25) r), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$function$;

revoke execute on function public._oauth_redirect_host(text) from public, anon, authenticated;
revoke execute on function public.admin_mcp_funnel(integer, boolean) from public, anon;
grant execute on function public.admin_mcp_funnel(integer, boolean) to authenticated, service_role;

-- The 0311 habit: prove the grants and the gate rather than trusting the
-- statements above reported success.
do $proof$
declare
  v_sig text := 'public.admin_mcp_funnel(integer, boolean)';
  v_helper text := 'public._oauth_redirect_host(text)';
  v_def text;
begin
  if to_regprocedure(v_sig) is null or to_regprocedure(v_helper) is null then
    raise exception '0700: a function is missing';
  end if;
  if has_function_privilege('anon', v_sig, 'execute') then
    raise exception '0700: % is reachable signed out', v_sig;
  end if;
  if not has_function_privilege('authenticated', v_sig, 'execute')
     or not has_function_privilege('service_role', v_sig, 'execute') then
    raise exception '0700: % lost its grant', v_sig;
  end if;
  if has_function_privilege('anon', v_helper, 'execute')
     or has_function_privilege('authenticated', v_helper, 'execute') then
    raise exception '0700: % is callable from outside', v_helper;
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname = 'admin_mcp_funnel') <> 1 then
    raise exception '0700: an overload sits beside admin_mcp_funnel';
  end if;
  v_def := pg_get_functiondef(v_sig::regprocedure);
  if v_def not like '%perform public._require_admin();%'
     or v_def not like '%public._internal_user_ids()%' then
    raise exception '0700: % lost its gate or the people it leaves out', v_sig;
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = v_sig::regprocedure) then
    raise exception '0700: % is not security definer', v_sig;
  end if;
  -- The same buckets the consent page's events use (oauthConnect.test.mjs).
  if public._oauth_redirect_host('https://claude.ai/api/mcp/auth_callback') <> 'claude.ai'
     or public._oauth_redirect_host('https://ChatGPT.com/connector_platform_oauth_redirect?x=1') <> 'chatgpt.com'
     or public._oauth_redirect_host('https://example.com:8443/cb/secret-install-id') <> 'example.com'
     or public._oauth_redirect_host('http://localhost:53121/callback') <> 'loopback'
     or public._oauth_redirect_host('http://127.0.0.1:8080/oauth') <> 'loopback'
     or public._oauth_redirect_host('http://[::1]:3000/cb') <> 'loopback'
     or public._oauth_redirect_host('cursor://anysphere.cursor-retrieval/oauth/callback') <> 'cursor:'
     or public._oauth_redirect_host('vscode://vscode.github-authentication/did-authenticate') <> 'vscode:'
     or public._oauth_redirect_host('https://') <> 'invalid'
     or public._oauth_redirect_host('') <> 'invalid'
     or public._oauth_redirect_host('not a url') <> 'invalid' then
    raise exception '0700: _oauth_redirect_host buckets a callback differently from redirectHostOf';
  end if;
end $proof$;

commit;
