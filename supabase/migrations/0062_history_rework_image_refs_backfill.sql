-- 0062_history_rework_image_refs_backfill.sql
-- Phase 3 of the backups/restore rework.
--
-- Populates the new history-aware reference columns on images (ref_count,
-- referenced_in_board_ids, first_referenced_at, last_referenced_at) and the
-- per-snapshot r2_keys_referenced array on board_snapshots, by scanning every
-- existing Y.Doc for r2:<key> references.
--
-- Why pure SQL: Yjs encodes string values inline as UTF-8 in the binary
-- stream, so the literal "r2:<key>" sequences are findable via regex on the
-- base64-decoded bytea without invoking any Yjs runtime. Far cheaper than
-- an edge function would be (a 1300-snapshot backfill in seconds vs minutes,
-- and no memory limits).
--
-- Idempotent: only writes board_snapshots.r2_keys_referenced where it's
-- currently empty; images aggregates are recomputed (overwritten) so
-- re-running after new data is added is safe.

CREATE TEMP TABLE IF NOT EXISTS _phase3_state_refs ON COMMIT DROP AS
SELECT
  bs.board_id,
  bs.updated_at,
  (regexp_matches(
    encode(decode(bs.doc, 'base64'), 'escape'),
    'r2:([A-Za-z0-9_\-./]{20,})',
    'g'
  ))[1] AS r2_key
FROM board_state bs;

CREATE TEMP TABLE IF NOT EXISTS _phase3_snap_refs ON COMMIT DROP AS
SELECT
  bsn.id          AS snapshot_id,
  bsn.board_id,
  bsn.at_ts,
  (regexp_matches(
    encode(decode(bsn.doc_b64, 'base64'), 'escape'),
    'r2:([A-Za-z0-9_\-./]{20,})',
    'g'
  ))[1] AS r2_key
FROM board_snapshots bsn
WHERE bsn.storage = 'postgres' AND bsn.doc_b64 IS NOT NULL;

WITH snap_agg AS (
  SELECT snapshot_id, ARRAY_AGG(DISTINCT r2_key) AS keys
  FROM _phase3_snap_refs
  GROUP BY snapshot_id
)
UPDATE board_snapshots bs
   SET r2_keys_referenced = sa.keys
  FROM snap_agg sa
 WHERE bs.id = sa.snapshot_id
   AND (bs.r2_keys_referenced IS NULL OR cardinality(bs.r2_keys_referenced) = 0);

WITH all_refs AS (
  SELECT r2_key, board_id, updated_at AS ts, true  AS is_live FROM _phase3_state_refs
  UNION ALL
  SELECT r2_key, board_id, at_ts        AS ts, false AS is_live FROM _phase3_snap_refs
),
agg AS (
  SELECT
    r2_key,
    MIN(ts)                                        AS first_ts,
    MAX(ts)                                        AS last_ts,
    COUNT(*) FILTER (WHERE is_live)                AS live_count,
    ARRAY_AGG(DISTINCT board_id)                   AS board_ids
  FROM all_refs
  GROUP BY r2_key
)
UPDATE images i
   SET first_referenced_at    = a.first_ts,
       last_referenced_at     = a.last_ts,
       ref_count              = a.live_count,
       referenced_in_board_ids = a.board_ids
  FROM agg a
 WHERE i.storage_path = a.r2_key;
