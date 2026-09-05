-- 0298 — the spill watch could not see a statement's FIRST spill.
--
-- 0297 diffed pg_stat_statements against the snapshot with an inner join, so a
-- queryid that had never been seen before was skipped — and the reseed at the
-- end of the same call then added it, so it looked "known" from then on. The
-- net effect is that the first window a statement appears in is invisible,
-- which is exactly the window that matters: a newly deployed RPC that spills
-- 10GB on day one would report nothing, and only a SECOND, additional spill
-- would ever be logged.
--
-- Caught by end-to-end test rather than reading: forcing a 137MB sort with
-- work_mem=64kB produced a new queryid and capture_temp_spill() returned 0.
--
-- Fixed with a left join and a coalesced baseline of zero, so a new statement
-- is reported at its full total. That needs one guard: on the very first run
-- (or the run after a pg_stat_statements_reset) the snapshot is empty and
-- EVERY statement is "new", which would dump hundreds of rows carrying
-- lifetime totals. So an empty snapshot means seed-only, silently.

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
    where (s.temp_blks_written - coalesce(p.temp_blks_written, 0)) * 8192 >= p_min_bytes;
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
