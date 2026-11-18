-- 0908 — the database's memory, watched from outside the database.
--
-- On 17 Nov 2026 the database server ran short of memory for hours, swapping,
-- then locked up and was restarted. Every check we had ran inside Postgres, so
-- the first page came after the restart. The Worker now reads the server's own
-- figures every five minutes from Supabase's metrics endpoint
-- (worker-dbmemory.js, judged by lib/dbMemory.js), keeps them here, and pages
-- through ops_alert_raise while memory is running out, before anything stops.
--
-- db_memory_readings: one row per reading, node_exporter's raw figures: bytes,
-- and counters of pages since the server booted. Only db_memory_record writes
-- it. Row level security on and no policies, and no client grants.
--
-- db_memory_record(p): service_role only. Stores the reading, returns the one
-- before it with its age in seconds (so the Worker can turn counters into
-- rates), and drops readings older than 14 days. A figure that is missing is
-- stored as null.

begin;

create table if not exists public.db_memory_readings (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default clock_timestamp(),
  mem_total     bigint,
  mem_available bigint,
  swap_total    bigint,
  swap_free     bigint,
  pswpin        bigint,
  pswpout       bigint,
  pgmajfault    bigint
);
create index if not exists db_memory_readings_at on public.db_memory_readings (at);
alter table public.db_memory_readings enable row level security;
revoke all on table public.db_memory_readings from public, anon, authenticated;

create or replace function public.db_memory_record(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_prev jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'db_memory_record: expected an object' using errcode = '22023';
  end if;
  select jsonb_build_object(
           'age_s',         extract(epoch from clock_timestamp() - r.at),
           'mem_total',     r.mem_total,
           'mem_available', r.mem_available,
           'swap_total',    r.swap_total,
           'swap_free',     r.swap_free,
           'pswpin',        r.pswpin,
           'pswpout',       r.pswpout,
           'pgmajfault',    r.pgmajfault)
    into v_prev
    from db_memory_readings r
   order by r.at desc
   limit 1;
  insert into db_memory_readings (mem_total, mem_available, swap_total, swap_free, pswpin, pswpout, pgmajfault)
  select round(x.mem_total), round(x.mem_available), round(x.swap_total), round(x.swap_free),
         round(x.pswpin), round(x.pswpout), round(x.pgmajfault)
    from jsonb_to_record(p) as x(mem_total numeric, mem_available numeric, swap_total numeric,
                                 swap_free numeric, pswpin numeric, pswpout numeric, pgmajfault numeric);
  delete from db_memory_readings where at < clock_timestamp() - interval '14 days';
  return v_prev;
end;
$$;

revoke execute on function public.db_memory_record(jsonb) from public, anon, authenticated;
grant execute on function public.db_memory_record(jsonb) to service_role;

-- 0311 proof.
do $$
begin
  if has_function_privilege('anon', 'public.db_memory_record(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.db_memory_record(jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.db_memory_record(jsonb)', 'execute') then
    raise exception '0908: db_memory_record grants are wrong';
  end if;
  if has_table_privilege('anon', 'public.db_memory_readings', 'select')
     or has_table_privilege('authenticated', 'public.db_memory_readings', 'select')
     or has_table_privilege('anon', 'public.db_memory_readings', 'insert')
     or has_table_privilege('authenticated', 'public.db_memory_readings', 'insert') then
    raise exception '0908: db_memory_readings is open to clients';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.db_memory_readings'::regclass) then
    raise exception '0908: db_memory_readings has no row level security';
  end if;
end $$;

commit;
