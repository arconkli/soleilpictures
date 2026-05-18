-- 0072_op_density.sql
-- Follow-up 3: density histogram for the TimeTravelModal op timeline.
--
-- Returns op counts per bucket so the UI can render a horizontal density
-- bar. Bucket size is caller-supplied so the same RPC serves "last hour
-- at 1-min granularity" and "last 30 days at 1-day granularity".
--
-- Returns empty until Phase 4 starts populating board_ops (the PartyKit
-- DO captures + appends every Y.Update).

CREATE OR REPLACE FUNCTION board_op_density(
  p_board_id        uuid,
  p_from_ts         timestamptz,
  p_to_ts           timestamptz,
  p_bucket_seconds  int DEFAULT 300
)
RETURNS TABLE (
  bucket_start timestamptz,
  op_count     bigint,
  delete_count bigint,
  authors      uuid[]
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  WITH ops AS (
    SELECT
      to_timestamp(
        floor(extract(epoch FROM bo.ts) / p_bucket_seconds) * p_bucket_seconds
      ) AS bucket_start,
      bo.op_kind,
      bo.author_id
    FROM board_ops bo
    WHERE bo.board_id = p_board_id
      AND bo.ts >= p_from_ts
      AND bo.ts <  p_to_ts
  )
  SELECT
    bucket_start,
    COUNT(*)                                              AS op_count,
    COUNT(*) FILTER (WHERE op_kind LIKE 'card.delete%'
                     OR op_kind LIKE 'text.delete%')      AS delete_count,
    COALESCE(ARRAY_AGG(DISTINCT author_id)
              FILTER (WHERE author_id IS NOT NULL), '{}'::uuid[]) AS authors
  FROM ops
  GROUP BY bucket_start
  ORDER BY bucket_start;
$$;

REVOKE ALL ON FUNCTION board_op_density(uuid, timestamptz, timestamptz, int) FROM public;
GRANT EXECUTE ON FUNCTION board_op_density(uuid, timestamptz, timestamptz, int) TO authenticated, service_role;
