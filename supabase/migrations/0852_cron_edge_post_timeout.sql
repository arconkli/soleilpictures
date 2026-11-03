-- 0852: _cron_edge_post waits up to 30 seconds for the edge function's answer.
--
-- pg_net gives up on a request after 5 seconds unless told otherwise. The
-- cron jobs that call edge functions through this helper (storage-liveness
-- every minute, waitlist-accept every ten, lifecycle-email hourly, the daily
-- ones) logged a timeout in net._http_response many times a day while the
-- function carried on and finished fine: some a slow answer, some a DNS lookup
-- that spent its first 5-second try. Each one read as a failure, so a real one
-- was lost among them. Every other net.http_post caller here (_indexnow_send,
-- _notify_email_send, _ops_hc_ping, ops_alert_dispatch) already names its own
-- timeout.
--
-- With 30 seconds the slow answers and the DNS retry land, and a timeout
-- logged now means something. A job longer than that still answers 202 at
-- once and runs its work under EdgeRuntime.waitUntil (gsc-sync's keepAlive).
-- The body is 0386's with the timeout added and nothing else.

create or replace function public._cron_edge_post(p_function text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer
set search_path = public, vault, net as $$
declare
  v_secret text;
begin
  if p_function is null or p_function !~ '^[a-z0-9-]+$' then
    raise exception 'not an edge function name: %', p_function;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_edge_secret' limit 1;
  if v_secret is null then
    raise exception 'vault secret cron_edge_secret is missing';
  end if;
  return net.http_post(
    url     := 'https://ehlhlmbpwwalmeisvmdp.supabase.co/functions/v1/' || p_function,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := coalesce(p_body, '{}'::jsonb),
    timeout_milliseconds := 30000
  );
end;
$$;
revoke execute on function public._cron_edge_post(text, jsonb) from public, anon, authenticated;

-- The 0311 habit: prove the grants, and that the timeout took.
do $$
begin
  if has_function_privilege('anon', 'public._cron_edge_post(text, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public._cron_edge_post(text, jsonb)', 'execute') then
    raise exception '0852: _cron_edge_post is callable by a client';
  end if;
  if pg_get_functiondef('public._cron_edge_post(text, jsonb)'::regprocedure) !~ 'timeout_milliseconds := 30000' then
    raise exception '0852: _cron_edge_post does not set its timeout';
  end if;
end $$;
