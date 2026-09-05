-- 0297 — spill visibility, without the setting we cannot set.
--
-- The obvious way to notice a query spilling to disk is log_temp_files, which
-- writes a log line per spill. It is context='superuser', and on Supabase the
-- `postgres` role is not one: has_parameter_privilege(...,'SET') is false and
-- `alter database postgres set log_temp_files` fails with 42501. Only the
-- Management API can change it (the CLI's postgres-config, or the Dashboard),
-- which is outside SQL and outside MCP.
--
-- The information itself is not out of reach, though. pg_stat_statements
-- already counts temp_blks_written per statement; what is missing is a record
-- of how it CHANGES, because the counters are cumulative and a spill that
-- happened last Tuesday looks identical to one happening now.
--
-- So: snapshot the counters, diff them, and keep the diffs. That is arguably
-- better than the log line — it is queryable, attributed per statement, and
-- carries the call count so a 20MB spill across 400 calls is distinguishable
-- from a single 20MB one.
--
-- Two tables: a one-row-per-statement running snapshot, and an append-only log
-- of intervals where a statement spilled more than the threshold.
--
-- See 0298 and 0299 for two defects in this first version, both found by
-- end-to-end test rather than by reading it back.

create table if not exists public.temp_spill_snapshot (
  queryid            bigint primary key,
  calls              bigint      not null,
  temp_blks_written  bigint      not null,
  captured_at        timestamptz not null default now()
);

create table if not exists public.temp_spill_events (
  id                bigserial primary key,
  observed_at       timestamptz not null default now(),
  window_started_at timestamptz,
  queryid           bigint      not null,
  calls_delta       bigint      not null,
  temp_bytes_delta  bigint      not null,
  mean_exec_ms      numeric,
  query_sample      text
);

create index if not exists temp_spill_events_observed_idx
  on public.temp_spill_events (observed_at desc);

alter table public.temp_spill_snapshot enable row level security;
alter table public.temp_spill_events   enable row level security;

-- No policies at all: RLS on with zero policies denies every non-superuser
-- role, which is what an ops table wants. Grants are revoked explicitly from
-- anon and authenticated BY NAME — `revoke from public` does not reach them,
-- which is how 0285 and 0288 shipped anon-callable functions earlier today.
revoke all on public.temp_spill_snapshot from anon, authenticated, public;
revoke all on public.temp_spill_events   from anon, authenticated, public;

create or replace function public.capture_temp_spill(p_min_bytes bigint default 8388608)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_recorded integer := 0;
  v_reset    boolean;
begin
  select exists (
    select 1
    from pg_stat_statements s
    join public.temp_spill_snapshot p on p.queryid = s.queryid
    where s.temp_blks_written < p.temp_blks_written or s.calls < p.calls
  ) into v_reset;

  if v_reset then
    delete from public.temp_spill_snapshot;
  else
    insert into public.temp_spill_events
      (window_started_at, queryid, calls_delta, temp_bytes_delta, mean_exec_ms, query_sample)
    select p.captured_at,
           s.queryid,
           s.calls - p.calls,
           (s.temp_blks_written - p.temp_blks_written) * 8192,
           round(s.mean_exec_time::numeric, 1),
           left(regexp_replace(s.query, '\s+', ' ', 'g'), 300)
    from pg_stat_statements s
    join public.temp_spill_snapshot p on p.queryid = s.queryid
    where (s.temp_blks_written - p.temp_blks_written) * 8192 >= p_min_bytes;
    get diagnostics v_recorded = row_count;
  end if;

  insert into public.temp_spill_snapshot (queryid, calls, temp_blks_written, captured_at)
  select s.queryid, s.calls, s.temp_blks_written, now()
  from pg_stat_statements s
  where s.temp_blks_written > 0
  on conflict (queryid) do update
    set calls = excluded.calls,
        temp_blks_written = excluded.temp_blks_written,
        captured_at = excluded.captured_at;

  delete from public.temp_spill_events where observed_at < now() - interval '60 days';
  return v_recorded;
end;
$function$;

revoke all on function public.capture_temp_spill(bigint) from anon;
revoke all on function public.capture_temp_spill(bigint) from authenticated;
revoke all on function public.capture_temp_spill(bigint) from public;

select cron.schedule(
  'capture_temp_spill',
  '*/20 * * * *',
  $$ select public.capture_temp_spill(8388608); $$
);
