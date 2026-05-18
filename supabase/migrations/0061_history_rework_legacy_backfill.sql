-- 0061_history_rework_legacy_backfill.sql
-- Phase 2 of the backups/restore rework. Copies every existing board_versions
-- row into board_snapshots with a legacy_version_id mapping, byte-identical.
-- The original board_versions table is left untouched and continues to serve
-- the legacy HistoryModal until Phase 7 cutover.
--
-- Idempotent: re-running this skips rows already mapped via legacy_version_id.

-- Enable pgcrypto for digest() if not already present (Supabase has it by default).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO board_snapshots (
  board_id,
  at_seq,
  at_ts,
  storage,
  doc_b64,
  doc_hash,
  r2_keys_referenced,
  kind,
  label,
  created_by,
  created_at,
  legacy_version_id
)
SELECT
  bv.board_id,
  0 AS at_seq,            -- legacy snapshots predate the op seq; use 0
  bv.snapshot_at AS at_ts,
  'postgres' AS storage,
  bv.doc AS doc_b64,
  'sha256:' || encode(digest(bv.doc, 'sha256'), 'hex') AS doc_hash,
  '{}'::text[] AS r2_keys_referenced,  -- filled by Phase 3 backfill
  'legacy-' || COALESCE(bv.trigger_kind, 'unknown') AS kind,
  bv.label AS label,
  bv.made_by AS created_by,
  bv.snapshot_at AS created_at,
  bv.id AS legacy_version_id
FROM board_versions bv
WHERE NOT EXISTS (
  SELECT 1 FROM board_snapshots bs
  WHERE bs.legacy_version_id = bv.id
);

-- Sanity: every existing board_versions row should now have a snapshot.
DO $$
DECLARE
  missing_count integer;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM board_versions bv
  WHERE NOT EXISTS (
    SELECT 1 FROM board_snapshots bs WHERE bs.legacy_version_id = bv.id
  );
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Phase 2 backfill incomplete: % board_versions rows missing from board_snapshots', missing_count;
  END IF;
END $$;
