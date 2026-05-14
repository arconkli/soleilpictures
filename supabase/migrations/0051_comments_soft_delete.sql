-- 0051_comments_soft_delete.sql
-- Soft-delete for comments so "delete this comment" is recoverable for 30 days.
ALTER TABLE comments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS comments_deleted_at_idx ON comments(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS comments_alive_board_idx ON comments(board_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION soft_delete_comment(p_comment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE comments SET deleted_at = now(), updated_at = now()
    WHERE id = p_comment_id AND deleted_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION restore_comment(p_comment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE comments SET deleted_at = NULL, updated_at = now()
    WHERE id = p_comment_id AND deleted_at IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION purge_old_deleted_comments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM comments
   WHERE deleted_at IS NOT NULL
     AND deleted_at < (now() - interval '30 days');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION soft_delete_comment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_comment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION purge_old_deleted_comments() TO authenticated;
