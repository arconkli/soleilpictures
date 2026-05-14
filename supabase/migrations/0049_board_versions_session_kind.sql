-- 0049_board_versions_session_kind.sql
-- Adds session + trigger metadata to board_versions for the universal-undo system.
-- All columns nullable. Existing rows untouched.

ALTER TABLE board_versions ADD COLUMN IF NOT EXISTS session_id uuid;
ALTER TABLE board_versions ADD COLUMN IF NOT EXISTS trigger_kind text;
ALTER TABLE board_versions ADD COLUMN IF NOT EXISTS op_summary jsonb;
ALTER TABLE board_versions ADD COLUMN IF NOT EXISTS parent_version_id uuid REFERENCES board_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS board_versions_session_idx
  ON board_versions(board_id, session_id, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS board_versions_recent_idx
  ON board_versions(board_id, snapshot_at DESC);

-- Retention: keep last 200 snapshots per board.
-- Never prune anything inside the last 24h, anything labeled 'manual',
-- or any row whose trigger_kind is 'manual'.
CREATE OR REPLACE FUNCTION prune_board_versions(p_board_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  WITH ranked AS (
    SELECT id,
           snapshot_at,
           label,
           trigger_kind,
           ROW_NUMBER() OVER (ORDER BY snapshot_at DESC) AS rn
    FROM board_versions
    WHERE board_id = p_board_id
  )
  DELETE FROM board_versions bv
  USING ranked r
  WHERE bv.id = r.id
    AND r.rn > 200
    AND r.snapshot_at < (now() - interval '24 hours')
    AND COALESCE(r.label, '') <> 'manual'
    AND COALESCE(r.trigger_kind, '') <> 'manual';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION prune_board_versions(uuid) TO authenticated;
