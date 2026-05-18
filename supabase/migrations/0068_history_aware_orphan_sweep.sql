-- 0068_history_aware_orphan_sweep.sql
-- Phase 7 (urgent): replace find_orphan_images with a history-aware version
-- that consults the new reference accounting from migration 0060 + the
-- per-snapshot r2_keys_referenced index from migration 0062 backfill.
--
-- An image is eligible for deletion only when ALL of these hold:
--   1. ref_count = 0  — no live cards reference it
--   2. last_referenced_at IS NULL OR < now() - INTERVAL '30 days'
--   3. created_at < now() - INTERVAL '30 days'
--   4. retention_locked_until IS NULL OR retention_locked_until < now()
--   5. deleted_at IS NULL (not already swept)
--   6. storage_path NOT IN any board_snapshots.r2_keys_referenced
--   7. storage_path NOT IN any board_ops.r2_keys
--
-- Conditions 6 + 7 are the critical history-safety checks. The Phase 3
-- backfill populated r2_keys_referenced on every existing snapshot, and the
-- PartyKit DO populates r2_keys on every captured Y.Update.
--
-- The new RPC ships alongside the old find_orphan_images so the worker can
-- toggle via env var. The old one will be retired in Phase 8 cleanup.

CREATE OR REPLACE FUNCTION find_history_safe_orphan_images(
  p_limit  integer DEFAULT 500,
  p_dryrun boolean DEFAULT true
)
RETURNS TABLE (
  id uuid,
  storage_path text,
  workspace_id uuid,
  ref_count int,
  last_referenced_at timestamptz,
  created_at timestamptz,
  decision text,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT
      i.id,
      i.storage_path,
      i.workspace_id,
      i.ref_count,
      i.last_referenced_at,
      i.created_at,
      i.retention_locked_until,
      i.deleted_at
    FROM images i
    WHERE i.deleted_at IS NULL
      AND COALESCE(i.ref_count, 0) = 0
      AND i.created_at < (v_now - INTERVAL '30 days')
      AND (i.last_referenced_at IS NULL OR i.last_referenced_at < (v_now - INTERVAL '30 days'))
      AND (i.retention_locked_until IS NULL OR i.retention_locked_until < v_now)
    ORDER BY i.created_at ASC
    LIMIT p_limit
  ),
  -- Check each candidate against the snapshot+ops reference index.
  classified AS (
    SELECT
      c.*,
      EXISTS (
        SELECT 1 FROM board_snapshots bs
        WHERE c.storage_path = ANY (bs.r2_keys_referenced)
      ) AS in_snapshot,
      EXISTS (
        SELECT 1 FROM board_ops bo
        WHERE c.storage_path = ANY (bo.r2_keys)
      ) AS in_ops
    FROM candidates c
  )
  SELECT
    cl.id,
    cl.storage_path,
    cl.workspace_id,
    cl.ref_count,
    cl.last_referenced_at,
    cl.created_at,
    CASE
      WHEN cl.in_snapshot THEN 'keep'
      WHEN cl.in_ops      THEN 'keep'
      WHEN p_dryrun       THEN 'skipped_dryrun'
      ELSE 'delete'
    END AS decision,
    CASE
      WHEN cl.in_snapshot THEN 'referenced by retained snapshot history'
      WHEN cl.in_ops      THEN 'referenced by retained op history'
      WHEN p_dryrun       THEN 'eligible but in dry-run mode'
      ELSE 'no remaining references; safe to delete'
    END AS reason
  FROM classified cl;
END;
$$;

REVOKE ALL ON FUNCTION find_history_safe_orphan_images(integer, boolean) FROM public;
GRANT EXECUTE ON FUNCTION find_history_safe_orphan_images(integer, boolean) TO service_role;


-- Record the sweep run into r2_sweep_audit for operator review.
-- Inserts one row per candidate considered, regardless of decision.
CREATE OR REPLACE FUNCTION record_r2_sweep_audit(
  p_run_id uuid,
  p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  INSERT INTO r2_sweep_audit (run_id, run_at, r2_key, image_id, decision, reason, ref_count, last_ref_at, payload)
  SELECT
    p_run_id,
    now(),
    (r->>'storage_path'),
    (r->>'id')::uuid,
    (r->>'decision'),
    (r->>'reason'),
    (r->>'ref_count')::int,
    (r->>'last_referenced_at')::timestamptz,
    r
  FROM jsonb_array_elements(p_rows) AS r;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION record_r2_sweep_audit(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION record_r2_sweep_audit(uuid, jsonb) TO service_role;


-- Atomic batch soft-delete + R2 wipe coordinator. Marks images rows as
-- deleted (deleted_at = now()) so re-runs of the sweep don't reconsider
-- them. The actual R2 .delete() call happens in the Worker; this just
-- closes the loop in Postgres after a successful R2 delete.
CREATE OR REPLACE FUNCTION mark_image_rows_swept(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE images
     SET deleted_at = now()
   WHERE id = ANY(p_ids)
     AND deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION mark_image_rows_swept(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION mark_image_rows_swept(uuid[]) TO service_role;
