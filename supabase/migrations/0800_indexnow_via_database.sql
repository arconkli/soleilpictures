-- 0800: IndexNow is sent from the database, not the Worker.
--
-- Every IndexNow ping the Worker's cron made since 0480 shipped was answered
-- HTTP 429 — the very first one included, so it was never volume. The same
-- request body sent from anywhere else (a laptop, this database via pg_net)
-- is accepted with 200. api.indexnow.org refuses Cloudflare Worker egress, so
-- the Worker now asks Postgres to send it.
--
-- pg_net is asynchronous: net.http_post queues the request and returns its id;
-- the answer lands in net._http_response (kept ~6h) a few seconds later. So an
-- indexnow_pings row is written with ok = null ("sent, awaiting the answer")
-- and its request_id, and _indexnow_settle() — run by the cron at the top of
-- the next tick — copies the answer onto it.
--
--   _indexnow_send(urls)  → request id. Fixed host/key/keyLocation; every URL
--                           must be on our own origin, so the service-role-only
--                           helper still can't be pointed anywhere else.
--   _indexnow_settle()    → rows settled. ok = 200/202; a row with no answer
--                           after 2h (the response was reaped, or never came)
--                           settles as failed.
--
-- check_discovery_pipelines (0480) is untouched: `and p.ok` treats a pending
-- row as not-ok, and a pending row only counts toward its "3 attempts" when two
-- have already failed — at worst it alerts one tick early.

alter table public.indexnow_pings alter column ok drop not null;
alter table public.indexnow_pings add column if not exists request_id bigint;
comment on column public.indexnow_pings.ok is
  'true = IndexNow answered 200/202; false = refused or no answer; null = sent via pg_net, '
  'awaiting _indexnow_settle() (0800).';

create or replace function public._indexnow_send(p_urls text[])
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_n int := coalesce(array_length(p_urls, 1), 0);
begin
  if v_n < 1 or v_n > 10000 then
    raise exception 'indexnow: 1..10000 urls, got %', v_n;
  end if;
  if exists (select 1 from unnest(p_urls) u
              where u is null or u not like 'https://clusters.soleilpictures.com/%') then
    raise exception 'indexnow: every url must be on https://clusters.soleilpictures.com/';
  end if;
  return net.http_post(
    url     := 'https://api.indexnow.org/indexnow',
    body    := jsonb_build_object(
                 'host', 'clusters.soleilpictures.com',
                 'key', 'a7f3c1e94b8d4f26a0e5c7d213b6f80a',
                 'keyLocation', 'https://clusters.soleilpictures.com/a7f3c1e94b8d4f26a0e5c7d213b6f80a.txt',
                 'urlList', to_jsonb(p_urls)),
    -- exactly this: pg_net refuses 'application/json; charset=utf-8'
    headers := jsonb_build_object('content-type', 'application/json'),
    timeout_milliseconds := 15000
  );
end;
$$;

create or replace function public._indexnow_settle()
returns int
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_a int;
  v_b int;
begin
  update public.indexnow_pings p
     set ok     = (r.status_code in (200, 202)),
         status = r.status_code,
         error  = case
                    when r.status_code in (200, 202) then null
                    when r.timed_out then 'timed out'
                    else left(coalesce(r.error_msg, 'HTTP ' || r.status_code::text), 300)
                  end
    from net._http_response r
   where p.ok is null
     and p.request_id is not null
     and r.id = p.request_id;
  get diagnostics v_a = row_count;

  update public.indexnow_pings p
     set ok = false,
         error = 'no answer from IndexNow'
   where p.ok is null
     and p.pinged_at < now() - interval '2 hours';
  get diagnostics v_b = row_count;

  return v_a + v_b;
end;
$$;

revoke execute on function public._indexnow_send(text[]) from public, anon, authenticated;
revoke execute on function public._indexnow_settle() from public, anon, authenticated;
grant execute on function public._indexnow_send(text[]) to service_role;
grant execute on function public._indexnow_settle() to service_role;

do $$
declare
  f text;
  r text;
begin
  foreach f in array array['public._indexnow_send(text[])', 'public._indexnow_settle()'] loop
    foreach r in array array['public', 'anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'execute') then
        raise exception '0800: % can run %', r, f;
      end if;
    end loop;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '0800: service_role cannot run %', f;
    end if;
  end loop;
end $$;
