-- 0288 — three retention holes, one of which had never deleted a single row.
--
-- 1. prune_board_versions kept the newest 200 versions PER BOARD and had no
--    age bound at all. Real boards hold roughly a dozen versions each, nowhere
--    near 200, so the condition has never once been true. The nightly cron has
--    run since May and deleted nothing, which is why the table reached 203MB
--    (187MB of it TOAST) and became the largest relation in the database.
--
--    Adding an age arm alongside the count cap: keep the 20 newest per board
--    whatever their age, keep everything from the last 30 days, keep every
--    manual snapshot forever, drop the rest. On the data at time of writing
--    that released 82MB while leaving the recent window and every manual
--    snapshot intact. The existing rn>200/24h arm stays, so a board that
--    really does churn out hundreds of versions in a day is still capped.
--
-- 2. prune_all_board_versions looped over every board and ran a windowed
--    delete per board — one round trip per board, every night, to delete
--    nothing. It is one set-based statement now.
--
-- 3. cron.job_run_details has no pruning at all. Supabase does not manage it
--    and autovacuum had never touched it: 37MB going back to May, 6.5% of the
--    database, recording cron bookkeeping nobody reads. The minutely counter
--    job alone wrote 1,440 rows a day.
--
-- 4. universe_counters_minutely reconciled four table counts every 60 seconds
--    for a number the pipeline moves roughly once every 20 minutes.

create or replace function public.prune_board_versions(p_board_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_deleted integer := 0;
begin
  with ranked as (
    select id, snapshot_at, label, trigger_kind,
           row_number() over (order by snapshot_at desc) as rn
    from board_versions
    where board_id = p_board_id
  )
  delete from board_versions bv
  using ranked r
  where bv.id = r.id
    and coalesce(r.label, '') <> 'manual'
    and coalesce(r.trigger_kind, '') <> 'manual'
    and (
      (r.rn > 200 and r.snapshot_at < (now() - interval '24 hours'))
      or (r.rn > 20 and r.snapshot_at < (now() - interval '30 days'))
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

create or replace function public.prune_all_board_versions()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_deleted integer := 0;
begin
  with ranked as (
    select id, snapshot_at, label, trigger_kind,
           row_number() over (partition by board_id order by snapshot_at desc) as rn
    from board_versions
  )
  delete from board_versions bv
  using ranked r
  where bv.id = r.id
    and coalesce(r.label, '') <> 'manual'
    and coalesce(r.trigger_kind, '') <> 'manual'
    and (
      (r.rn > 200 and r.snapshot_at < (now() - interval '24 hours'))
      or (r.rn > 20 and r.snapshot_at < (now() - interval '30 days'))
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

create or replace function public.purge_cron_job_run_details(p_days integer default 7)
returns integer
language plpgsql
security definer
set search_path to 'cron', 'public'
as $function$
declare
  v_deleted integer := 0;
begin
  delete from cron.job_run_details
  where end_time < now() - (greatest(1, least(p_days, 90)) || ' days')::interval;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

revoke all on function public.purge_cron_job_run_details(integer) from public;

select cron.schedule(
  'purge_cron_job_run_details',
  '25 3 * * *',
  $$ select public.purge_cron_job_run_details(7); $$
);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'universe_counters_minutely'),
  schedule => '*/15 * * * *'
);
