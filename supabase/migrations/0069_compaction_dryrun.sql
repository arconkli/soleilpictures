-- 0069_compaction_dryrun.sql
-- Phase 6 of the backups/restore rework. Compaction dry-run reports.
--
-- Phase 6 is intentionally observational. We layer in:
--   1. A SQL function that REPORTS what Job 1 (Hot → Warm-recent) would
--      compact if it ran now, without doing any work.
--   2. A scheduled pg_cron that calls the report function hourly and
--      records the summary into job_runs for review.
--
-- Actual compaction (Y.mergeUpdates → R2 PUT → board_op_batches insert →
-- board_ops DELETE) requires R2 access from a JS runtime. That part will
-- be implemented in a Cloudflare Worker (re-using the existing IMAGES R2
-- binding) once we've watched the dry-run output for ~30 days and the
-- operator approves the volumes.
--
-- The hot-buffer cutoff is 2h by default — board_ops rows older than this
-- are eligible for compaction. Tunable via the config row added below.

-- Tunable configuration.
CREATE TABLE IF NOT EXISTS history_rework_config (
  key   text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO history_rework_config (key, value)
VALUES
  ('hot_buffer_interval', '"2 hours"'::jsonb),
  ('hourly_batch_max_op_count', '500'::jsonb),
  ('compaction_dryrun', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE history_rework_config ENABLE ROW LEVEL SECURITY;
-- service-role-only; no public policy needed for the cron worker.


-- Compute what Job 1 would compact. Returns one row per (board_id, hour)
-- bucket eligible for compaction, with the byte size and op count.
CREATE OR REPLACE FUNCTION compaction_job1_candidates()
RETURNS TABLE (
  board_id     uuid,
  hour_bucket  timestamptz,
  from_seq     bigint,
  to_seq       bigint,
  op_count     bigint,
  byte_size    bigint,
  tx_ids       uuid[]
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  WITH cfg AS (
    SELECT (value #>> '{}')::interval AS hot_buffer
      FROM history_rework_config WHERE key = 'hot_buffer_interval'
  ),
  cutoff AS (SELECT now() - (SELECT hot_buffer FROM cfg) AS at)
  SELECT
    bo.board_id,
    date_trunc('hour', bo.ts) AS hour_bucket,
    MIN(bo.seq)               AS from_seq,
    MAX(bo.seq)               AS to_seq,
    COUNT(*)                  AS op_count,
    SUM(octet_length(bo.update_b64)) AS byte_size,
    ARRAY_AGG(DISTINCT bo.tx_id) FILTER (WHERE bo.tx_id IS NOT NULL) AS tx_ids
  FROM board_ops bo, cutoff
  WHERE bo.ts < cutoff.at
  GROUP BY bo.board_id, date_trunc('hour', bo.ts)
  ORDER BY bo.board_id, hour_bucket;
$$;

REVOKE ALL ON FUNCTION compaction_job1_candidates() FROM public;
GRANT EXECUTE ON FUNCTION compaction_job1_candidates() TO service_role;
GRANT EXECUTE ON FUNCTION compaction_job1_candidates() TO authenticated;
-- authenticated grant allows operators to view via SQL editor.


-- Run a dry-run pass: record the candidate list summary into job_runs.
-- Each board_id gets one row keyed (job_name='compaction_job1', board_id),
-- with the latest candidate stats in payload + counts.
CREATE OR REPLACE FUNCTION compaction_job1_dryrun()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_buckets int := 0;
  v_total_ops bigint := 0;
  v_total_bytes bigint := 0;
  v_per_board jsonb := '{}'::jsonb;
  v_at timestamptz := now();
BEGIN
  -- Aggregate per board.
  WITH per_board AS (
    SELECT
      board_id,
      COUNT(*)            AS bucket_count,
      SUM(op_count)       AS op_count,
      SUM(byte_size)      AS byte_size,
      MIN(hour_bucket)    AS oldest_bucket,
      MAX(hour_bucket)    AS newest_bucket
    FROM compaction_job1_candidates()
    GROUP BY board_id
  ),
  upserts AS (
    INSERT INTO job_runs (job_name, board_id, last_seq, last_run_at, status, payload)
    SELECT
      'compaction_job1',
      pb.board_id,
      0,
      v_at,
      'idle',
      jsonb_build_object(
        'dryrun',         true,
        'buckets',        pb.bucket_count,
        'op_count',       pb.op_count,
        'byte_size',      pb.byte_size,
        'oldest_bucket',  pb.oldest_bucket,
        'newest_bucket',  pb.newest_bucket
      )
    FROM per_board pb
    ON CONFLICT (job_name, board_id) DO UPDATE
      SET last_run_at = EXCLUDED.last_run_at,
          payload     = EXCLUDED.payload,
          status      = 'idle'
    RETURNING board_id, payload
  )
  SELECT
    COUNT(*) AS boards,
    SUM((payload->>'buckets')::int) AS buckets,
    SUM((payload->>'op_count')::bigint) AS ops,
    SUM((payload->>'byte_size')::bigint) AS bytes,
    jsonb_object_agg(board_id::text, payload) AS per_board
  INTO v_total_buckets, v_total_buckets, v_total_ops, v_total_bytes, v_per_board
  FROM upserts;

  RETURN jsonb_build_object(
    'ran_at',       v_at,
    'mode',         'dryrun',
    'boards',       COALESCE(jsonb_object_length(v_per_board), 0),
    'total_buckets', COALESCE(v_total_buckets, 0),
    'total_ops',    COALESCE(v_total_ops, 0),
    'total_bytes',  COALESCE(v_total_bytes, 0),
    'per_board',    v_per_board
  );
END;
$$;

REVOKE ALL ON FUNCTION compaction_job1_dryrun() FROM public;
GRANT EXECUTE ON FUNCTION compaction_job1_dryrun() TO service_role;
GRANT EXECUTE ON FUNCTION compaction_job1_dryrun() TO authenticated;


-- Schedule via pg_cron. Runs hourly at :05 so it doesn't collide with
-- the daily retention crons (03:00-03:10) or the R2 sweep (04:00 UTC).
-- pg_cron is already enabled by 0052_schedule_retention_crons.sql.
SELECT cron.schedule(
  'compaction_job1_dryrun',
  '5 * * * *',
  $$SELECT compaction_job1_dryrun();$$
);
