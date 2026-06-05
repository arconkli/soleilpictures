-- 0118_meta_capi_log.sql
--
-- First-party delivery log for Meta Conversions API (CAPI) sends, so conversion
-- delivery is auditable from our own DB instead of only Meta Events Manager.
--
-- _shared/meta-capi.ts (emitCapi → sendCapiEvent) writes one row per send attempt
-- with the outcome (ok / HTTP status / error). Best-effort + service-role, so a
-- log failure never affects the send. NO raw PII is stored — event_id only ever
-- contains reg:<uid> / lead:<uid> / Stripe ids. Reads go through the admin RPC.

create table if not exists public.meta_capi_log (
  id          bigint generated always as identity primary key,
  event_name  text not null,
  event_id    text,
  ok          boolean not null default false,
  status      integer,
  error       text,
  created_at  timestamptz not null default now()
);

create index if not exists meta_capi_log_created_idx on public.meta_capi_log (created_at desc);
create index if not exists meta_capi_log_event_idx   on public.meta_capi_log (event_name, created_at desc);

-- RLS on, no policies: anon/authenticated are denied. Service-role edge-function
-- writes bypass RLS; admins read via the security-definer RPC below.
alter table public.meta_capi_log enable row level security;

-- Per-event delivery health for the admin System view.
create or replace function public.admin_meta_capi_health(p_days integer default 7)
returns table(event_name text, sends bigint, ok bigint, failed bigint, success_pct numeric, last_sent timestamptz, last_error text)
language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 90));
  return query
  select l.event_name,
         count(*)::bigint as sends,
         sum(case when l.ok then 1 else 0 end)::bigint as ok,
         sum(case when l.ok then 0 else 1 end)::bigint as failed,
         round(sum(case when l.ok then 1 else 0 end)::numeric / nullif(count(*), 0), 4) as success_pct,
         max(l.created_at) as last_sent,
         (array_agg(l.error order by l.created_at desc) filter (where not l.ok and l.error is not null))[1] as last_error
    from public.meta_capi_log l
   where l.created_at >= now() - (p_days || ' days')::interval
   group by l.event_name
   order by count(*) desc;
end $function$;

revoke all on function public.admin_meta_capi_health(integer) from public;
grant execute on function public.admin_meta_capi_health(integer) to authenticated;
