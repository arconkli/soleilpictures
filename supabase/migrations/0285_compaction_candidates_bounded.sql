-- 0285 — the compaction candidate scan detoasts 150MB to compute two columns
-- nobody reads.
--
-- compaction_job1_candidates() returns seven columns. The only consumer,
-- worker-compaction.js, uses two of them:
--
--   compactOneBucket(env, bucket) reads bucket.board_id and bucket.hour_bucket,
--   then calls fetch_ops_for_compaction() and recomputes from_seq, to_seq,
--   tx_ids and the byte count from the ops it just fetched.
--
-- The other five are computed and thrown away, and two of them are expensive:
--
--   sum(octet_length(bo.update_b64))  detoasts every op payload in the table
--   array_agg(distinct bo.tx_id)      forces a sort on tx_id, widening the
--                                     sort input from 32 to 203 bytes a row
--
-- Measured on production, scanning everything older than the 2h hot buffer:
--
--   with byte_size + tx_ids : 179,378 buffers, 12,634 ms, spills to temp
--   without, with limit 50  :   5,912 buffers,    206 ms, no temp
--
-- 30x fewer buffers and 61x faster. shared_buffers on this instance is 224MB
-- (28,672 buffers), so the old shape flushed the entire buffer cache six times
-- over on every run, hourly, from two schedulers.
--
-- The limit is pushed into SQL rather than applied with .slice() in the worker.
-- That matters: the index scan is presorted on board_id, so the GroupAggregate
-- streams and LIMIT 50 stops it early instead of running to completion.
--
-- ORDER BY is deliberately KEPT. It is what makes the incremental sort usable,
-- and it makes each run take the oldest buckets, so successive runs walk
-- forward through the backlog deterministically. Do NOT "optimise" this into a
-- bounded time window (e.g. only the last 26 hours) — every bucket older than
-- the window is exactly the backlog compaction exists to drain, and skipping it
-- would leave those ops in the table forever.

drop function if exists public.compaction_job1_candidates();

create function public.compaction_job1_candidates(p_limit integer default 50)
returns table(
  board_id uuid,
  hour_bucket timestamptz,
  from_seq bigint,
  to_seq bigint,
  op_count bigint
)
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
  with cfg as (
    select (value #>> '{}')::interval as hot_buffer
      from history_rework_config where key = 'hot_buffer_interval'
  ),
  cutoff as (select now() - (select hot_buffer from cfg) as at)
  select
    bo.board_id,
    date_trunc('hour', bo.ts) as hour_bucket,
    min(bo.seq)               as from_seq,
    max(bo.seq)               as to_seq,
    count(*)                  as op_count
  from board_ops bo, cutoff
  where bo.ts < cutoff.at
  group by bo.board_id, date_trunc('hour', bo.ts)
  order by bo.board_id, hour_bucket
  limit p_limit;
$function$;

revoke all on function public.compaction_job1_candidates(integer) from public;
grant execute on function public.compaction_job1_candidates(integer) to service_role;

-- compaction_job1_dryrun() summed byte_size, so it has to lose that column too.
-- It is being unscheduled in the same change (it duplicated the Worker's :15
-- cron and wrote 103MB of WAL into job_runs for a report nobody read), but it
-- stays callable by hand for inspection rather than being left broken.
create or replace function public.compaction_job1_dryrun()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_total_buckets int := 0;
  v_total_ops bigint := 0;
  v_per_board jsonb := '{}'::jsonb;
  v_boards int := 0;
  v_at timestamptz := now();
begin
  with per_board as (
    select
      board_id,
      count(*)         as bucket_count,
      sum(op_count)    as op_count,
      min(hour_bucket) as oldest_bucket,
      max(hour_bucket) as newest_bucket
    from compaction_job1_candidates(1000)
    group by board_id
  ),
  upserts as (
    insert into job_runs (job_name, board_id, last_seq, last_run_at, status, payload)
    select
      'compaction_job1',
      pb.board_id,
      0,
      v_at,
      'idle',
      jsonb_build_object(
        'dryrun', true,
        'buckets', pb.bucket_count,
        'op_count', pb.op_count,
        'oldest_bucket', pb.oldest_bucket,
        'newest_bucket', pb.newest_bucket
      )
    from per_board pb
    on conflict (job_name, board_id) do update
      set last_run_at = excluded.last_run_at,
          payload     = excluded.payload,
          status      = 'idle'
    returning board_id, payload
  )
  select
    count(*),
    coalesce(sum((payload->>'buckets')::int), 0),
    coalesce(sum((payload->>'op_count')::bigint), 0),
    coalesce(jsonb_object_agg(board_id::text, payload), '{}'::jsonb)
  into v_boards, v_total_buckets, v_total_ops, v_per_board
  from upserts;

  return jsonb_build_object(
    'ran_at', v_at,
    'mode', 'dryrun',
    'boards', v_boards,
    'total_buckets', v_total_buckets,
    'total_ops', v_total_ops,
    'per_board', v_per_board
  );
end;
$function$;

-- Two schedulers ran the same hourly probe: pg_cron at :05 and the Cloudflare
-- Worker at :15. The Worker is the one that can actually commit batches, so the
-- SQL half goes. Its cost had roughly tripled in three weeks (6.2s on 08-16,
-- 18.1s on 09-02, peaking at 120s) purely because board_ops kept growing.
select cron.unschedule('compaction_job1_dryrun');
