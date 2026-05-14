-- 0050_boards_soft_delete.sql
-- Add a deleted_at column to boards so deletion becomes recoverable.
-- All existing rows have deleted_at NULL (visible). No data touched.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS boards_deleted_at_idx ON boards(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS boards_alive_idx ON boards(workspace_id, parent_board_id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION soft_delete_board(p_board_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE boards SET deleted_at = now(), updated_at = now()
    WHERE id = p_board_id AND deleted_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION restore_board(p_board_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE boards SET deleted_at = NULL, updated_at = now()
    WHERE id = p_board_id AND deleted_at IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION purge_old_deleted_boards()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM boards
   WHERE deleted_at IS NOT NULL
     AND deleted_at < (now() - interval '30 days');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION soft_delete_board(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_board(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION purge_old_deleted_boards() TO authenticated;
