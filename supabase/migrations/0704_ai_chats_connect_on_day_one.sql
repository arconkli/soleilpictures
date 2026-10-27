-- 0704 — ChatGPT and Claude connect on an account's first day.
--
-- 0375 kept an account out of every connected app for its first 72 hours. The
-- person the MCP server is built for meets Clusters inside ChatGPT or Claude:
-- they press Connect, type an email, and the account is minutes old when they
-- approve, so the approval failed for exactly the person it exists for. Now an
-- approval that sends the person back to ChatGPT's or Claude's own callback,
-- registered for that client, is let through on day one. Every other app (a
-- program on the person's computer, an editor's private scheme, any other
-- website) still waits the 72 hours.
--
-- The callback says where the code goes, not who asked for it: an account can
-- register a client with ChatGPT's callback, start the sign-in itself and read
-- its own code from the address bar. So what such a token can do is bounded
-- instead. While its account is new, a token that came through OAuth answers at
-- most 300 requests an hour rather than 1,000 (api_token_resolve; the
-- x-ratelimit-* headers carry the lower number). API keys, service tokens,
-- webhooks, Explore and indexable links stay closed for the 72 hours whatever
-- connects: each asks _refuse_if_new itself, as the person.
--
-- oauth_authorize_consent is 0701's, with the new-account gate moved after the
-- redirect check and skipped for those callbacks; api_token_resolve is 0373's,
-- with the ceiling. Neither changes otherwise, and both keep their grants.

-- api_token_resolve runs on every API request: wait at most 3s for its lock
-- rather than queue requests behind a long transaction.
set local lock_timeout = '3s';

-- Claude's MCP callback (claude.com is where Anthropic has said it may move)
-- and ChatGPT's, exactly: no other path, query or port.
create or replace function public._oauth_ai_chat_callback(p_redirect_uri text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(p_redirect_uri = any (array[
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
    'https://chatgpt.com/connector_platform_oauth_redirect'
  ]), false);
$$;

revoke execute on function public._oauth_ai_chat_callback(text)
  from public, anon, authenticated;

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

  select * into v_client from public.oauth_clients
   where client_id = p_client_id and disabled_at is null;
  if not found then
    raise exception 'unknown client' using errcode = '22023';
  end if;
  -- 0701: exact, or loopback on any port (RFC 8252 §7.3).
  if not public._oauth_redirect_matches(v_client.redirect_uris, p_redirect_uri) then
    raise exception 'redirect_uri does not match this client' using errcode = '22023';
  end if;
  -- 0375: not in an account's first three days. 0704: except ChatGPT and
  -- Claude, sending the person back to their own callback.
  if not public._oauth_ai_chat_callback(p_redirect_uri) then
    perform public._refuse_if_new('Connecting an app');
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

CREATE OR REPLACE FUNCTION public.api_token_resolve(p_token_hash text)
 RETURNS TABLE(user_id uuid, token_id uuid, scopes text[], reason text, req_count integer, req_limit integer, req_reset timestamp with time zone, workspace_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  t public.api_tokens%rowtype; v_limit integer; v_valid boolean;
  v_count integer; v_reset timestamptz;
  -- 0704: an OAuth token's ceiling while its account is new.
  c_new_account_oauth_limit constant integer := 300;
begin
  select * into t from public.api_tokens where token_hash = p_token_hash;
  if not found then
    return query select null::uuid, null::uuid, null::text[], 'unknown'::text,
                        null::integer, 1000, null::timestamptz, null::uuid;
    return;
  end if;
  v_limit := coalesce(t.req_limit, 1000);
  -- 0704: ChatGPT and Claude connect on an account's first day, so until the
  -- account is three days old (0375's _account_is_new) an OAuth token answers
  -- fewer requests an hour. A lower limit set on the token stays.
  if t.oauth_client_id is not null and v_limit > c_new_account_oauth_limit
     and exists (select 1 from auth.users u
                  where u.id = t.user_id and u.created_at > now() - interval '72 hours') then
    v_limit := c_new_account_oauth_limit;
  end if;
  v_valid := t.revoked_at is null and (t.expires_at is null or t.expires_at > now());
  update public.api_tokens a
     set req_window   = case when now() - a.req_window > interval '1 hour' then now() else a.req_window end,
         req_count    = case when now() - a.req_window > interval '1 hour' then 1 else a.req_count + 1 end,
         last_used_at = case when v_valid then now() else a.last_used_at end
   where a.id = t.id
  returning a.req_count, a.req_window + interval '1 hour' into v_count, v_reset;
  if v_count > v_limit then
    return query select null::uuid, null::uuid, null::text[], 'rate_limited'::text,
                        v_count, v_limit, v_reset, null::uuid;
    return;
  end if;
  if t.revoked_at is not null then
    return query select null::uuid, null::uuid, null::text[], 'revoked'::text,
                        v_count, v_limit, v_reset, null::uuid;
    return;
  end if;
  if t.expires_at is not null and t.expires_at <= now() then
    return query select null::uuid, null::uuid, null::text[], 'expired'::text,
                        v_count, v_limit, v_reset, null::uuid;
    return;
  end if;
  if exists (select 1 from public.service_accounts s
              where s.user_id = t.user_id and s.disabled_at is not null) then
    return query select null::uuid, null::uuid, null::text[], 'revoked'::text,
                        v_count, v_limit, v_reset, null::uuid;
    return;
  end if;
  -- 0371: a banned account's keys stop working (and work again if the ban
  -- is lifted). apiAuth.js mints sessions only for a token that resolves.
  if public._user_banned(t.user_id) then
    return query select null::uuid, null::uuid, null::text[], 'revoked'::text,
                        v_count, v_limit, v_reset, null::uuid;
    return;
  end if;
  return query select t.user_id, t.id, t.scopes, null::text,
                      v_count, v_limit, v_reset, t.workspace_id;
end;
$function$;

-- The 0311 habit: prove the grants, and the rule, rather than trust the REVOKE.
do $$
declare
  f_cb      constant text := 'public._oauth_ai_chat_callback(text)';
  f_resolve constant text := 'public.api_token_resolve(text)';
  f_consent constant text := 'public.oauth_authorize_consent(text, text, text, text[], text, text, text, integer)';
begin
  if has_function_privilege('anon', f_cb, 'execute')
     or has_function_privilege('authenticated', f_cb, 'execute') then
    raise exception '0704: % is callable by a signed-in or anonymous caller', f_cb;
  end if;
  if has_function_privilege('anon', f_resolve, 'execute')
     or has_function_privilege('authenticated', f_resolve, 'execute') then
    raise exception '0704: % is callable by a signed-in or anonymous caller', f_resolve;
  end if;
  if not has_function_privilege('service_role', f_resolve, 'execute') then
    raise exception '0704: the Worker (service_role) can no longer run %', f_resolve;
  end if;
  if has_function_privilege('anon', f_consent, 'execute') then
    raise exception '0704: % is callable by an anonymous caller', f_consent;
  end if;
  if not has_function_privilege('authenticated', f_consent, 'execute') then
    raise exception '0704: a signed-in person can no longer run %', f_consent;
  end if;
  if not public._oauth_ai_chat_callback('https://claude.ai/api/mcp/auth_callback')
     or not public._oauth_ai_chat_callback('https://chatgpt.com/connector_platform_oauth_redirect')
     or public._oauth_ai_chat_callback('https://chatgpt.com/connector_platform_oauth_redirect?x=1')
     or public._oauth_ai_chat_callback('https://claude.ai.example.com/api/mcp/auth_callback')
     or public._oauth_ai_chat_callback('http://localhost/callback')
     or public._oauth_ai_chat_callback(null) then
    raise exception '0704: _oauth_ai_chat_callback does not match exactly the two hosts'' callbacks';
  end if;
end;
$$;
