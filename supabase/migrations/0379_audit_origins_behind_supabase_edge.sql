-- 0379 — request origins are noted again: Supabase's edge is a Worker too.
--
-- 0378's _request_origin() skipped any request carrying a cf-worker header,
-- meaning to skip calls our own Cloudflare Worker makes on someone's behalf.
-- But Supabase's API edge is itself a Cloudflare Worker, so every request
-- reaches PostgREST with cf-worker: supabase.co, and nothing was ever noted.
-- (Checked against a live request: cf-connecting-ip is the caller's real
-- address behind that edge.)
--
-- A Worker's own fetch to another zone arrives from Cloudflare's Workers
-- range, 2a06:98c0::/29, so that is what is skipped now: our Worker's API and
-- MCP calls, and anyone else's. Server runtimes are still recognised by their
-- client header, and now by their user-agent as well.

begin;

create or replace function public._request_origin(out ip_hash text, out ua_hash text, out ip_source text)
language plpgsql stable security definer
set search_path = public, extensions as $$
declare
  v_h    jsonb;
  v_ip   inet;
  v_net  text;
  v_salt text;
begin
  begin
    v_h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return;
  end;
  if v_h is null
     or coalesce(v_h->>'x-client-info', '') ~* '(deno|node)'
     or coalesce(v_h->>'user-agent', '') ~* '^(deno|node)' then
    return;
  end if;
  begin
    -- cf-connecting-ip is Cloudflare's, and a client can't supply its own.
    -- x-forwarded-for is never read: its first entry is whatever the client sent.
    if nullif(trim(v_h->>'cf-connecting-ip'), '') is not null then
      v_ip := trim(v_h->>'cf-connecting-ip')::inet;
      ip_source := 'cf';
    elsif nullif(trim(v_h->>'x-real-ip'), '') is not null then
      v_ip := trim(v_h->>'x-real-ip')::inet;
      ip_source := 'real';
    else
      return;
    end if;
    -- A Worker calling on someone's behalf: an address everyone it serves shares.
    if v_ip <<= '2a06:98c0::/29'::inet then
      ip_source := null;
      return;
    end if;
    v_net := case when family(v_ip) = 6 then network(set_masklen(v_ip, 64))::text else host(v_ip) end;
  exception when others then
    ip_source := null;
    return;
  end;
  select s.decrypted_secret into v_salt from vault.decrypted_secrets s where s.name = 'forensic_origin_salt';
  if v_salt is null then
    ip_source := null;
    return;
  end if;
  ip_hash := encode(hmac(v_net, v_salt, 'sha256'), 'hex');
  ua_hash := encode(hmac(left(coalesce(v_h->>'user-agent', ''), 512), v_salt, 'sha256'), 'hex');
end;
$$;

revoke execute on function public._request_origin() from public, anon, authenticated;

do $$
begin
  if has_function_privilege('anon', 'public._request_origin()', 'execute')
     or has_function_privilege('authenticated', 'public._request_origin()', 'execute') then
    raise exception '0379: _request_origin is client-callable';
  end if;
end $$;

commit;
