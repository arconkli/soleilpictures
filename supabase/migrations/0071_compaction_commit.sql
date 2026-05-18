-- 0071_compaction_commit.sql
-- Follow-up 4: atomic commit RPC for Job 1 compaction.
--
-- Two functions paired with the Cloudflare Worker that does the Y.js
-- merge + R2 PUT. The Worker:
--   1. Calls fetch_ops_for_compaction → gets the rows for a (board_id, hour)
--   2. Merges via Y.mergeUpdates locally
--   3. PUTs the merged update to R2 at boards/{board_id}/ops/hourly/{from}-{to}.bin
--   4. Calls commit_op_batch → atomically inserts board_op_batches row +
--      deletes the source board_ops rows in one transaction
--
-- If the worker crashes between (3) and (4), the R2 object exists but the
-- batch index doesn't and the source ops are still in Postgres. The next
-- run picks them up again, producing a different R2 key. Cleanup of
-- orphaned R2 objects from such crashes is handled by the daily sweep
-- (the worker can also list R2 keys NOT in board_op_batches and reclaim).

CREATE OR REPLACE FUNCTION fetch_ops_for_compaction(
  p_board_id   uuid,
  p_hour_start timestamptz,
  p_hour_end   timestamptz,
  p_max_ops    integer DEFAULT 500
)
RETURNS TABLE (
  id         bigint,
  seq        bigint,
  ts         timestamptz,
  tx_id      uuid,
  r2_keys    text[],
  update_b64 text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT bo.id, bo.seq, bo.ts, bo.tx_id, bo.r2_keys, bo.update_b64
  FROM board_ops bo
  WHERE bo.board_id = p_board_id
    AND bo.ts >= p_hour_start
    AND bo.ts <  p_hour_end
  ORDER BY bo.seq ASC
  LIMIT p_max_ops;
$$;

REVOKE ALL ON FUNCTION fetch_ops_for_compaction(uuid, timestamptz, timestamptz, integer) FROM public;
GRANT EXECUTE ON FUNCTION fetch_ops_for_compaction(uuid, timestamptz, timestamptz, integer) TO service_role;


-- Atomic commit: insert the batch index row, delete the source ops in
-- the same transaction. Returns the new batch id.
CREATE OR REPLACE FUNCTION commit_op_batch(
  p_board_id           uuid,
  p_r2_key             text,
  p_tier               text,
  p_from_seq           bigint,
  p_to_seq             bigint,
  p_from_ts            timestamptz,
  p_to_ts              timestamptz,
  p_op_count           int,
  p_tx_ids             uuid[],
  p_r2_keys_referenced text[],
  p_merged_update_hash text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_batch_id bigint;
  v_deleted_count int := 0;
BEGIN
  -- Idempotency: if the r2_key already exists, just return the existing batch id.
  -- (The R2 object is content-addressed by from_seq-to_seq, so a duplicate
  -- means a previous run already committed this batch.)
  SELECT id INTO v_batch_id FROM board_op_batches WHERE r2_key = p_r2_key;
  IF v_batch_id IS NOT NULL THEN
    RETURN v_batch_id;
  END IF;

  INSERT INTO board_op_batches (
    board_id, r2_key, tier, from_seq, to_seq, from_ts, to_ts,
    op_count, tx_ids, r2_keys_referenced, merged_update_hash
  ) VALUES (
    p_board_id, p_r2_key, p_tier, p_from_seq, p_to_seq, p_from_ts, p_to_ts,
    p_op_count,
    COALESCE(p_tx_ids, '{}'::uuid[]),
    COALESCE(p_r2_keys_referenced, '{}'::text[]),
    p_merged_update_hash
  ) RETURNING id INTO v_batch_id;

  -- Delete the source ops now that they're archived.
  DELETE FROM board_ops
   WHERE board_id = p_board_id
     AND seq BETWEEN p_from_seq AND p_to_seq;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- Audit row in job_runs.payload.
  INSERT INTO job_runs (job_name, board_id, last_seq, last_run_at, status, payload)
  VALUES (
    'compaction_job1',
    p_board_id,
    p_to_seq,
    now(),
    'idle',
    jsonb_build_object(
      'last_committed_batch_id', v_batch_id,
      'last_committed_at', now(),
      'committed_op_count', v_deleted_count
    )
  )
  ON CONFLICT (job_name, board_id) DO UPDATE
    SET last_seq = GREATEST(job_runs.last_seq, EXCLUDED.last_seq),
        last_run_at = EXCLUDED.last_run_at,
        payload = job_runs.payload || EXCLUDED.payload;

  RETURN v_batch_id;
END;
$$;

REVOKE ALL ON FUNCTION commit_op_batch(uuid, text, text, bigint, bigint, timestamptz, timestamptz, int, uuid[], text[], text) FROM public;
GRANT EXECUTE ON FUNCTION commit_op_batch(uuid, text, text, bigint, bigint, timestamptz, timestamptz, int, uuid[], text[], text) TO service_role;
