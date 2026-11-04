-- 0857 — Coding apps connect on an account's first day too.
--
-- 0704 let ChatGPT's and Claude's own callbacks through 0375's 72-hour wait,
-- and nothing else. The other people the MCP server is for meet Clusters from
-- a coding app: Claude Code, Codex, Cursor, VS Code, Windsurf or the npm
-- package. They sign up from the app's own sign-in, so their account is just
-- as minutes old when they approve, and the approval failed for them. Now the
-- day-one exception covers where those apps send the code back:
--
--   * a loopback address on this computer, any port and path, over http:
--     http://localhost, http://127.0.0.1, http://[::1] (RFC 8252 §7.3). Claude
--     Code (http://localhost/callback, http://127.0.0.1/callback), Codex, VS
--     Code (http://127.0.0.1:33418/), Windsurf
--     (http://127.0.0.1:<port>/oauth/callback), Cursor's desktop app
--     (http://localhost:8787/callback) and the npm package all use one.
--   * VS Code's web relay, exactly, with or without a trailing slash:
--     https://vscode.dev/redirect and
--     https://insiders.vscode.dev/redirect (the real VS Code client's
--     metadata document lists the first), and its own URL handler for
--     dynamic auth providers, vscode://dynamicauthprovider/… and
--     vscode-insiders://dynamicauthprovider/….
--   * Cursor's: cursor://anysphere.cursor-mcp/… (the desktop app's callback,
--     and its older cursor://anysphere.cursor-retrieval/… form), and
--     https://www.cursor.com/agents/mcp/oauth/callback exactly (its cloud
--     agents).
--
-- Every rule is the scheme plus the exact host (or authority), followed by
-- nothing or a path: never a substring. cursor.evil.com,
-- http://localhost.evil.com, http://127.0.0.1.evil.com and
-- https://vscode.dev.evil.com/redirect are refused, and the proof at the
-- bottom says so. The redirect must still match one the client registered
-- (0701's _oauth_redirect_matches runs first, and checks the port range); this
-- only decides whether a new account waits.
--
-- What it costs is 0704's argument again. A redirect says where the code goes,
-- not who asked for it, and a loopback or an app's scheme is a place on the
-- person's own computer: someone who registers a client with one and starts the
-- sign-in themselves reads their own code. So the bound is what a token can do,
-- and that is unchanged: while its account is new, every token that came
-- through OAuth answers at most 300 requests an hour, whichever client it
-- belongs to (api_token_resolve, 0704: c_new_account_oauth_limit applies to
-- any token with an oauth_client_id while auth.users.created_at is within 72
-- hours; it never looks at the client or the redirect). API keys, service
-- tokens, webhooks, Explore and indexable links stay closed for the 72 hours
-- whatever connects: each asks _refuse_if_new itself, as the person.
--
-- 0704's _oauth_ai_chat_callback is replaced by _oauth_day_one_redirect, since
-- it no longer names only the AI chats, and dropped once oauth_authorize_consent
-- (0704's body, with that one call renamed) stops calling it. Nothing else
-- calls it. Both functions keep 0704's grants: the helper is internal, consent
-- is signed-in callers'.

begin;

set local lock_timeout = '3s';

-- $fn$, not $$: the patterns end in an anchor, and "$" + "$re$" would close a
-- $$-quoted body early (0701's note).
create or replace function public._oauth_day_one_redirect(p_redirect_uri text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select coalesce(
    -- 0704's: Claude's MCP callback (claude.com is where Anthropic has said it
    -- may move) and ChatGPT's. Then VS Code's web relays and Cursor's cloud
    -- agents. Exactly: no other path, query or port.
    p_redirect_uri = any (array[
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.com/api/mcp/auth_callback',
      'https://chatgpt.com/connector_platform_oauth_redirect',
      'https://vscode.dev/redirect',
      'https://insiders.vscode.dev/redirect',
      'https://vscode.dev/redirect/',
      'https://insiders.vscode.dev/redirect/',
      'https://www.cursor.com/agents/mcp/oauth/callback'
    ])
    -- Loopback, http only: host, then an optional port, then a path or nothing.
    or p_redirect_uri ~* $re$^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?(/[^#]*)?$$re$
    -- VS Code's URL handler for a dynamic auth provider.
    or p_redirect_uri ~* $re$^(vscode|vscode-insiders)://dynamicauthprovider(/[^#]*)?$$re$
    -- Cursor's desktop callback, and its older form.
    or p_redirect_uri ~* $re$^cursor://anysphere\.cursor-(mcp|retrieval)(/[^#]*)?$$re$,
    false);
$fn$;

revoke execute on function public._oauth_day_one_redirect(text)
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
  -- Claude, sending the person back to their own callback. 0857: and the
  -- coding apps, sending them back to their computer or their editor.
  if not public._oauth_day_one_redirect(p_redirect_uri) then
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

-- Nothing calls 0704's helper now.
drop function if exists public._oauth_ai_chat_callback(text);

-- The 0311 habit: prove the grants, and the rule, rather than trust the REVOKE.
do $proof$
declare
  f_cb      constant text := 'public._oauth_day_one_redirect(text)';
  f_consent constant text := 'public.oauth_authorize_consent(text, text, text, text[], text, text, text, integer)';
  v_uri     text;
begin
  if has_function_privilege('anon', f_cb, 'execute')
     or has_function_privilege('authenticated', f_cb, 'execute') then
    raise exception '0857: % is callable by a signed-in or anonymous caller', f_cb;
  end if;
  if not has_function_privilege('service_role', f_cb, 'execute') then
    raise exception '0857: service_role lost %', f_cb;
  end if;
  if has_function_privilege('anon', f_consent, 'execute') then
    raise exception '0857: % is callable by an anonymous caller', f_consent;
  end if;
  if not has_function_privilege('authenticated', f_consent, 'execute')
     or not has_function_privilege('service_role', f_consent, 'execute') then
    raise exception '0857: a signed-in person or service_role can no longer run %', f_consent;
  end if;
  if (select prosrc from pg_proc where oid = f_consent::regprocedure)
       not like '%if not public._oauth_day_one_redirect(p_redirect_uri) then%perform public._refuse_if_new(''Connecting an app'');%' then
    raise exception '0857: oauth_authorize_consent does not ask _oauth_day_one_redirect before the wait';
  end if;
  if to_regprocedure('public._oauth_ai_chat_callback(text)') is not null then
    raise exception '0857: _oauth_ai_chat_callback is still there';
  end if;

  -- Let through on day one.
  foreach v_uri in array array[
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'http://localhost/callback',
    'http://127.0.0.1/callback',
    'http://localhost:40061/callback',
    'http://127.0.0.1:33418/',
    'http://127.0.0.1:54321/oauth/callback',
    'http://localhost:8787/callback',
    'http://[::1]:5000/cb',
    'http://localhost',
    'http://127.0.0.1:8080',
    'https://vscode.dev/redirect',
    'https://insiders.vscode.dev/redirect',
    'https://vscode.dev/redirect/',
    'https://insiders.vscode.dev/redirect/',
    'vscode://dynamicauthprovider/clusters.soleilpictures.com/redirect?nonce=abc',
    'vscode-insiders://dynamicauthprovider/clusters.soleilpictures.com/redirect',
    'cursor://anysphere.cursor-mcp/oauth/callback',
    'cursor://anysphere.cursor-retrieval/oauth/user-soleil/callback',
    'https://www.cursor.com/agents/mcp/oauth/callback'
  ] loop
    if not public._oauth_day_one_redirect(v_uri) then
      raise exception '0857: % should connect on day one', v_uri;
    end if;
  end loop;

  -- Still wait: look-alike hosts, other schemes, extra paths, credentials,
  -- fragments, and anything that merely contains an allowed address.
  foreach v_uri in array array[
    'https://cursor.evil.com/agents/mcp/oauth/callback',
    'https://www.cursor.com.evil.com/agents/mcp/oauth/callback',
    'https://www.cursor.com/agents/mcp/oauth/callback/x',
    'https://cursor.com/agents/mcp/oauth/callback',
    'cursor://evil.com/oauth/callback',
    'cursor://anysphere.cursor-mcp.evil.com/oauth/callback',
    'cursor://anysphere.cursor-mcp@evil.com/oauth/callback',
    'cursor://anysphere.cursor-mcpx/oauth/callback',
    'http://localhost.evil.com/callback',
    'http://localhost.evil.com',
    'http://127.0.0.1.evil.com/callback',
    'http://127.0.0.1.nip.io/callback',
    'http://[::1].evil.com/cb',
    'http://localhost@evil.com/callback',
    'http://localhost:80@evil.com/callback',
    'http://evil.com/?r=http://localhost/callback',
    'http://evil.com/http://127.0.0.1/',
    'https://localhost/callback',
    'http://localhost/callback#frag',
    'http://localhost:/callback',
    'https://vscode.dev.evil.com/redirect',
    'https://evil.vscode.dev/redirect',
    'https://vscode.dev/redirect/x',
    'https://vscode.dev/redirect//',
    'https://vscode.dev/redirect?x=1',
    'http://vscode.dev/redirect',
    'vscode://evil/redirect',
    'vscode://dynamicauthprovider.evil.com/redirect',
    'vscode-insiders://dynamicauthproviderx/redirect',
    'windsurf://evil/callback',
    'https://chatgpt.com/connector_platform_oauth_redirect?x=1',
    'https://claude.ai.example.com/api/mcp/auth_callback',
    'com.example.app:/callback',
    'javascript:alert(1)//http://localhost/',
    ''
  ] loop
    if public._oauth_day_one_redirect(v_uri) then
      raise exception '0857: % must wait the 72 hours', v_uri;
    end if;
  end loop;
  if public._oauth_day_one_redirect(null) then
    raise exception '0857: a missing redirect must wait the 72 hours';
  end if;

  -- The bound is 0704's, unchanged: every OAuth token of a new account, any
  -- client, answers at most 300 requests an hour.
  if (select prosrc from pg_proc where oid = 'public.api_token_resolve(text)'::regprocedure)
       not like '%c_new_account_oauth_limit constant integer := 300;%if t.oauth_client_id is not null and v_limit > c_new_account_oauth_limit%' then
    raise exception '0857: api_token_resolve no longer caps every new account''s OAuth tokens';
  end if;
end;
$proof$;

commit;
