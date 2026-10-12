-- 0409 — Webhook work is claimed, not raced; the delivery log pages by keyset.
--
-- Audit API-10. Every API write ends with a waitUntil drain, and the minute
-- cron drains too, so several drains routinely overlap. Fan-out selected
-- `fanned_at is null` with no claim and marked the events only after inserting
-- their deliveries, and delivery selected due rows with no lease — so two
-- drains fanned out the same events and POSTed the same deliveries. Receivers
-- got duplicates under different X-Soleil-Delivery ids, and a dead endpoint's
-- failure streak counted double toward the auto-disable.
--
--   · webhook_fan_out(limit) claims pending events with FOR UPDATE SKIP LOCKED,
--     marks them fanned and inserts their deliveries in ONE statement. The
--     payload is the same thin shape lib/webhooks.js builds.
--   · A unique index on (webhook_id, event_id) makes a second fan-out of the
--     same event a no-op even if one ever gets past the claim. Existing
--     duplicates keep their log rows; only the later copies' event_id is
--     cleared (UPDATE, not DELETE) so the index can be built.
--   · webhook_deliveries_claim(limit, lease, id) leases due deliveries by
--     pushing next_attempt_at out before anything is POSTed. A drain that dies
--     mid-batch gives its rows back when the lease runs out. p_id claims one
--     specific delivery — POST /webhooks/:id/test and redeliver send their own
--     row inline instead of the 25 oldest due rows across every workspace
--     (audit API-17).
--
-- Audit API-11. webhook_deliveries_list pages on created_at alone with
-- `created_at < cursor`, and one fan-out inserts many rows with the same
-- now(), so everything after the first page of a tied run was unreachable.
-- It also capped at 200 while the route advertised 500 and computed has_more
-- as `rows = limit`. webhook_deliveries_page keyset-pages on (created_at, id)
-- and allows limit + 1 so the route can tell whether there is more. The old
-- function is left in place: the shipped Worker calls it until it is
-- redeployed, and the new Worker falls back to it when this one is missing.
--
-- Both service-role functions are internal: execute is revoked from public,
-- anon and authenticated (0311). The page function is for authenticated
-- callers and checks membership exactly as webhook_deliveries_list does —
-- integrator: confirm against the live definition before applying, in case
-- that function has been tightened since 0222.

begin;

-- ── one delivery per (hook, event) ──────────────────────────────────────────

update public.webhook_deliveries d
   set event_id = null
 where d.event_id is not null
   and exists (
     select 1 from public.webhook_deliveries o
      where o.webhook_id = d.webhook_id
        and o.event_id = d.event_id
        and (o.created_at, o.id) < (d.created_at, d.id));

create unique index if not exists webhook_deliveries_hook_event_uniq
  on public.webhook_deliveries (webhook_id, event_id);

-- ── fan-out, claimed ────────────────────────────────────────────────────────

create or replace function public.webhook_fan_out(p_limit int default 500)
returns table(events int, deliveries int)
language sql
security definer
set search_path = public
as $$
  with claimed as (
    update public.webhook_events e
       set fanned_at = now()
     where e.id in (
       select p.id from public.webhook_events p
        where p.fanned_at is null
        order by p.id
        limit greatest(1, least(coalesce(p_limit, 500), 1000))
        for update skip locked)
    returning e.id, e.workspace_id, e.board_id, e.event, e.resource, e.created_at
  ),
  made as (
    insert into public.webhook_deliveries (webhook_id, event_id, event, payload)
    select h.id, c.id, c.event,
           jsonb_build_object(
             'type', c.event,
             'resource', jsonb_build_object(
               'type', split_part(c.event, '.', 1),
               'id', coalesce(nullif(c.resource -> 'id', 'null'::jsonb),
                              to_jsonb(c.board_id), 'null'::jsonb)),
             'workspace', jsonb_build_object('id', c.workspace_id),
             'board', case when c.board_id is null then 'null'::jsonb
                           else jsonb_build_object('id', c.board_id) end,
             'data', coalesce(c.resource, '{}'::jsonb),
             'occurred_at', c.created_at)
      from claimed c
      join public.webhooks h
        on h.workspace_id = c.workspace_id and h.active
     where c.event = any(h.events) or '*' = any(h.events)
    on conflict (webhook_id, event_id) do nothing
    returning 1
  )
  select (select count(*) from claimed)::int, (select count(*) from made)::int;
$$;

revoke execute on function public.webhook_fan_out(int) from public, anon, authenticated;
grant execute on function public.webhook_fan_out(int) to service_role;

-- ── delivery, leased ────────────────────────────────────────────────────────

create or replace function public.webhook_deliveries_claim(
  p_limit int default 100, p_lease_seconds int default 900, p_id uuid default null)
returns table(id uuid, webhook_id uuid, event text, payload jsonb, attempt int)
language sql
security definer
set search_path = public
as $$
  update public.webhook_deliveries d
     set next_attempt_at = now()
           + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 900), 3600)))
   where d.id in (
     select q.id from public.webhook_deliveries q
      where q.delivered_at is null
        and q.next_attempt_at <= now()
        and (p_id is null or q.id = p_id)
      order by q.next_attempt_at
      limit greatest(1, least(coalesce(p_limit, 100), 500))
      for update skip locked)
  returning d.id, d.webhook_id, d.event, d.payload, d.attempt;
$$;

revoke execute on function public.webhook_deliveries_claim(int, int, uuid) from public, anon, authenticated;
grant execute on function public.webhook_deliveries_claim(int, int, uuid) to service_role;

-- ── the delivery log, keyset-paged ──────────────────────────────────────────

create or replace function public.webhook_deliveries_page(
  p_webhook_id uuid, p_limit int default 50,
  p_cursor_ts timestamptz default null, p_cursor_id uuid default null)
returns table(id uuid, event text, status int, attempt int, response_ms int,
              error text, created_at timestamptz, delivered_at timestamptz,
              next_attempt_at timestamptz, payload jsonb)
language sql stable
security definer
set search_path = public, auth
as $$
  select d.id, d.event, d.status, d.attempt, d.response_ms, d.error,
         d.created_at, d.delivered_at, d.next_attempt_at, d.payload
    from public.webhook_deliveries d
    join public.webhooks w on w.id = d.webhook_id
   where d.webhook_id = p_webhook_id
     and public.is_workspace_member(w.workspace_id)
     and (p_cursor_ts is null
          or d.created_at < p_cursor_ts
          or (p_cursor_id is not null and d.created_at = p_cursor_ts and d.id < p_cursor_id))
   order by d.created_at desc, d.id desc
   limit greatest(1, least(coalesce(p_limit, 50), 501));
$$;

revoke execute on function public.webhook_deliveries_page(uuid, int, timestamptz, uuid) from public, anon;
grant execute on function public.webhook_deliveries_page(uuid, int, timestamptz, uuid) to authenticated;

-- ── proof ───────────────────────────────────────────────────────────────────

do $$
declare f text;
begin
  foreach f in array array[
    'public.webhook_fan_out(int)',
    'public.webhook_deliveries_claim(int,int,uuid)'
  ] loop
    if has_function_privilege('anon', f, 'execute')
       or has_function_privilege('authenticated', f, 'execute')
       or not has_function_privilege('service_role', f, 'execute') then
      raise exception '0409: grants are wrong on %', f;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.webhook_deliveries_page(uuid,int,timestamptz,uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.webhook_deliveries_page(uuid,int,timestamptz,uuid)', 'execute') then
    raise exception '0409: grants are wrong on webhook_deliveries_page';
  end if;

  if not exists (select 1 from pg_indexes
                  where schemaname = 'public'
                    and indexname = 'webhook_deliveries_hook_event_uniq') then
    raise exception '0409: webhook_deliveries_hook_event_uniq is missing';
  end if;
end $$;

commit;
