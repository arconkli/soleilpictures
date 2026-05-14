-- 0053_board_meta_history.sql
-- Audit + undo log for board metadata edits (name/cover/view/bg_color/meta).

CREATE TABLE IF NOT EXISTS board_meta_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  field text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  session_id uuid
);

CREATE INDEX IF NOT EXISTS board_meta_history_board_idx
  ON board_meta_history(board_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS board_meta_history_recent_idx
  ON board_meta_history(workspace_id, changed_at DESC);

ALTER TABLE board_meta_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bmh_select ON board_meta_history;
CREATE POLICY bmh_select ON board_meta_history
  FOR SELECT
  USING (can_read_board(board_id));

DROP POLICY IF EXISTS bmh_insert ON board_meta_history;
CREATE POLICY bmh_insert ON board_meta_history
  FOR INSERT
  WITH CHECK (can_write_board(board_id));
