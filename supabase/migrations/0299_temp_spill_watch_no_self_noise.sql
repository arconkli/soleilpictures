-- 0299 — the spill watch reported itself, every time.
--
-- capture_temp_spill scans all of pg_stat_statements (3,300+ rows, each with a
-- query text) and joins it to the snapshot. At work_mem=2184kB that spills
-- about 8MB — which is over its own 8MB threshold, so it logged itself on the
-- first real run. On a 20-minute schedule that is ~72 self-reports a day, which
-- would bury the signal it exists to surface.
--
-- Two fixes, because either alone is incomplete:
--   1. Give the function enough work_mem to stop spilling in the first place.
--      It is a single-threaded ops job on a 20-minute timer, so 16MB is free.
--   2. Exclude its own statement from the report anyway, so that if it ever
--      does spill again it stays quiet about itself rather than filling the
--      table. Its cost is still plainly visible in pg_stat_statements to
--      anyone who looks.

create or replace function public.capture_temp_spill(p_min_bytes bigint default 8388608)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_recorded integer := 0;
  v_reset    boolean;
  v_seeded   boolean;
begin
  select exists (select 1 from public.temp_spill_snapshot) into v_seeded;

  select exists (
    select 1
    from pg_stat_statements s
    join public.temp_spill_snapshot p on p.queryid = s.queryid
    where s.temp_blks_written < p.temp_blks_written or s.calls < p.calls
  ) into v_reset;

  if v_reset then
    delete from public.temp_spill_snapshot;
    v_seeded := false;
  end if;

  if v_seeded then
    insert into public.temp_spill_events
      (window_started_at, queryid, calls_delta, temp_bytes_delta, mean_exec_ms, query_sample)
    select p.captured_at,
           s.queryid,
           s.calls - coalesce(p.calls, 0),
           (s.temp_blks_written - coalesce(p.temp_blks_written, 0)) * 8192,
           round(s.mean_exec_time::numeric, 1),
           left(regexp_replace(s.query, '\s+', ' ', 'g'), 300)
    from pg_stat_statements s
    left join public.temp_spill_snapshot p on p.queryid = s.queryid
    where (s.temp_blks_written - coalesce(p.temp_blks_written, 0)) * 8192 >= p_min_bytes
      and s.query not like '%capture_temp_spill%';
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

alter function public.capture_temp_spill(bigint) set work_mem = '16MB';

revoke all on function public.capture_temp_spill(bigint) from anon;
revoke all on function public.capture_temp_spill(bigint) from authenticated;
revoke all on function public.capture_temp_spill(bigint) from public;

delete from public.temp_spill_events where query_sample like '%capture_temp_spill%';
