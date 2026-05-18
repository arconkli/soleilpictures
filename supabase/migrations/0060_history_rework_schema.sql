-- 0060_history_rework_schema.sql
-- Phase 1 of the backups/restore rework. Additive only.
-- Creates the new tables for continuous time-travel history, alters images for
-- history-aware reference counting, and backfills board_state_version rows for
-- every existing board.
--
-- NOTHING in this migration touches existing data on board_state, board_versions,
-- board_meta_history, or images data rows. Old write/read paths continue to function.
--
-- Op bytes and snapshot bytes are stored as base64 TEXT to match the existing
-- convention used by board_state.doc and board_versions.doc.

-- ─────────────────────────────────────────────────────────────────────────────
-- board_ops: append-only op log (hot tier, last ~2h)
-- One row per Y.Update emitted by any client, ordered by per-board monotonic seq.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS board_ops (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id        uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  seq             bigint NOT NULL,
  ts              timestamptz NOT NULL DEFAULT now(),
  author_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_id       text,
  tx_id           uuid,
  tx_role         text CHECK (tx_role IS NULL OR tx_role IN ('single','member')),
  tx_member_index int,
  op_kind         text NOT NULL DEFAULT 'op.other',
  card_ids        text[] NOT NULL DEFAULT '{}',
  r2_keys         text[] NOT NULL DEFAULT '{}',
  update_b64      text NOT NULL,
  update_hash     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS board_ops_board_seq_idx ON board_ops(board_id, seq);
CREATE INDEX IF NOT EXISTS board_ops_board_ts_idx ON board_ops(board_id, ts DESC);
CREATE INDEX IF NOT EXISTS board_ops_tx_idx ON board_ops(tx_id) WHERE tx_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS board_ops_author_ts_idx ON board_ops(author_id, ts DESC);
CREATE INDEX IF NOT EXISTS board_ops_card_gin ON board_ops USING GIN (card_ids);
CREATE INDEX IF NOT EXISTS board_ops_r2_gin ON board_ops USING GIN (r2_keys);

ALTER TABLE board_ops ENABLE ROW LEVEL SECURITY;

-- Read: any workspace member of the board's workspace can read the op log.
CREATE POLICY "board_ops read by members" ON board_ops FOR SELECT
  USING (EXISTS (SELECT 1 FROM boards b WHERE b.id = board_ops.board_id AND is_workspace_member(b.workspace_id)));

-- Writes are server-only (service role). No INSERT/UPDATE/DELETE policy for
-- authenticated; service_role bypasses RLS. The PartyKit DO + edge functions
-- use service role to write here.

-- ─────────────────────────────────────────────────────────────────────────────
-- board_op_batches: index of archived op batches in R2 (warm + cold tiers).
-- Tiny rows (no bytes), so even decades of history fit cheaply.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS board_op_batches (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id            uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  r2_key              text NOT NULL,
  tier                text NOT NULL CHECK (tier IN ('hourly','daily','weekly')),
  from_seq            bigint NOT NULL,
  to_seq              bigint NOT NULL,
  from_ts             timestamptz NOT NULL,
  to_ts               timestamptz NOT NULL,
  op_count            int NOT NULL DEFAULT 0,
  tx_ids              uuid[] NOT NULL DEFAULT '{}',
  r2_keys_referenced  text[] NOT NULL DEFAULT '{}',
  merged_update_hash  text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS board_op_batches_board_seq_idx ON board_op_batches(board_id, from_seq);
CREATE INDEX IF NOT EXISTS board_op_batches_board_ts_idx ON board_op_batches(board_id, from_ts DESC);
CREATE INDEX IF NOT EXISTS board_op_batches_tx_gin ON board_op_batches USING GIN (tx_ids);
CREATE INDEX IF NOT EXISTS board_op_batches_r2_gin ON board_op_batches USING GIN (r2_keys_referenced);
CREATE UNIQUE INDEX IF NOT EXISTS board_op_batches_r2_key_idx ON board_op_batches(r2_key);

ALTER TABLE board_op_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "board_op_batches read by members" ON board_op_batches FOR SELECT
  USING (EXISTS (SELECT 1 FROM boards b WHERE b.id = board_op_batches.board_id AND is_workspace_member(b.workspace_id)));

-- ─────────────────────────────────────────────────────────────────────────────
-- board_snapshots: periodic full-doc snapshots, replay anchors.
-- Tiered: 'postgres' for recent (bytes in column), 'r2' for older (r2_key only).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS board_snapshots (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id            uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  at_seq              bigint NOT NULL DEFAULT 0,
  at_ts               timestamptz NOT NULL DEFAULT now(),
  storage             text NOT NULL DEFAULT 'postgres' CHECK (storage IN ('postgres','r2')),
  doc_b64             text,
  r2_key              text,
  doc_hash            text NOT NULL,
  r2_keys_referenced  text[] NOT NULL DEFAULT '{}',
  kind                text NOT NULL,
  label               text,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  legacy_version_id   uuid REFERENCES board_versions(id) ON DELETE SET NULL,
  CHECK (
    (storage = 'postgres' AND doc_b64 IS NOT NULL AND r2_key IS NULL) OR
    (storage = 'r2' AND r2_key IS NOT NULL AND doc_b64 IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS board_snapshots_board_seq_idx ON board_snapshots(board_id, at_seq DESC);
CREATE INDEX IF NOT EXISTS board_snapshots_board_ts_idx ON board_snapshots(board_id, at_ts DESC);
CREATE INDEX IF NOT EXISTS board_snapshots_kind_idx ON board_snapshots(board_id, kind, at_ts DESC);
CREATE INDEX IF NOT EXISTS board_snapshots_legacy_idx ON board_snapshots(legacy_version_id) WHERE legacy_version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS board_snapshots_r2_gin ON board_snapshots USING GIN (r2_keys_referenced);

ALTER TABLE board_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "board_snapshots read by members" ON board_snapshots FOR SELECT
  USING (EXISTS (SELECT 1 FROM boards b WHERE b.id = board_snapshots.board_id AND is_workspace_member(b.workspace_id)));

-- ─────────────────────────────────────────────────────────────────────────────
-- board_state_version: the reliable restore signal.
-- One row per board. Clients subscribe via Supabase Realtime.
-- - latest_seq is updated on every op flush (frequent)
-- - version is incremented on every restore (rare)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS board_state_version (
  board_id             uuid PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  version              bigint NOT NULL DEFAULT 1,
  latest_seq           bigint NOT NULL DEFAULT 0,
  latest_snapshot_id   bigint REFERENCES board_snapshots(id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS board_state_version_updated_idx ON board_state_version(updated_at DESC);

ALTER TABLE board_state_version ENABLE ROW LEVEL SECURITY;

CREATE POLICY "board_state_version read by members" ON board_state_version FOR SELECT
  USING (EXISTS (SELECT 1 FROM boards b WHERE b.id = board_state_version.board_id AND is_workspace_member(b.workspace_id)));

-- Backfill: one row per existing board.
INSERT INTO board_state_version (board_id, version, latest_seq, latest_snapshot_id, updated_at)
SELECT id, 1, 0, NULL, now()
FROM boards
WHERE NOT EXISTS (SELECT 1 FROM board_state_version bsv WHERE bsv.board_id = boards.id);

-- ─────────────────────────────────────────────────────────────────────────────
-- board_tx: cross-board linked transaction registry.
-- One row per logical multi-board op (e.g. dragging a card between boards).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS board_tx (
  tx_id                uuid PRIMARY KEY,
  kind                 text NOT NULL,
  initiator_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  initiator_board_id   uuid REFERENCES boards(id) ON DELETE SET NULL,
  affected_board_ids   uuid[] NOT NULL DEFAULT '{}',
  started_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  expires_at           timestamptz NOT NULL DEFAULT (now() + interval '60 seconds'),
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','committed','reverted','abandoned')),
  summary              jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS board_tx_affected_gin ON board_tx USING GIN (affected_board_ids);
CREATE INDEX IF NOT EXISTS board_tx_status_idx ON board_tx(status, started_at DESC);
CREATE INDEX IF NOT EXISTS board_tx_pending_expires_idx ON board_tx(expires_at) WHERE status = 'pending';

ALTER TABLE board_tx ENABLE ROW LEVEL SECURITY;

CREATE POLICY "board_tx read by affected board members" ON board_tx FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM boards b
    WHERE b.id = ANY (board_tx.affected_board_ids)
      AND is_workspace_member(b.workspace_id)
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- workspace_anomaly_alerts: anomaly detector output, surfaces in UI banner.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_anomaly_alerts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  board_ids       uuid[] NOT NULL DEFAULT '{}',
  detected_at     timestamptz NOT NULL DEFAULT now(),
  kind            text NOT NULL CHECK (kind IN ('mass_delete','velocity_spike','bulk_card_remove','workspace.rewind','manual')),
  severity        text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  auto_paused     boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS workspace_anomaly_alerts_ws_idx ON workspace_anomaly_alerts(workspace_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS workspace_anomaly_alerts_open_idx
  ON workspace_anomaly_alerts(workspace_id, severity, detected_at DESC)
  WHERE acknowledged_at IS NULL;

ALTER TABLE workspace_anomaly_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anomaly_alerts read by members" ON workspace_anomaly_alerts FOR SELECT
  USING (is_workspace_member(workspace_id));
CREATE POLICY "anomaly_alerts ack by members" ON workspace_anomaly_alerts FOR UPDATE
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- r2_sweep_audit: audit trail for the rewritten orphan sweep.
-- Records every candidate considered, decision made, and reason.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS r2_sweep_audit (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id          uuid NOT NULL,
  run_at          timestamptz NOT NULL DEFAULT now(),
  r2_key          text NOT NULL,
  image_id        uuid,
  decision        text NOT NULL CHECK (decision IN ('keep','delete','skipped_dryrun','error')),
  reason          text,
  ref_count       int,
  last_ref_at     timestamptz,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS r2_sweep_audit_run_idx ON r2_sweep_audit(run_id);
CREATE INDEX IF NOT EXISTS r2_sweep_audit_key_idx ON r2_sweep_audit(r2_key, run_at DESC);

ALTER TABLE r2_sweep_audit ENABLE ROW LEVEL SECURITY;
-- service-role-only; no policy for authenticated.

-- ─────────────────────────────────────────────────────────────────────────────
-- job_runs: tracks last-completed step per job per board, for resumable crons.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_runs (
  job_name        text NOT NULL,
  board_id        uuid NOT NULL,
  last_seq        bigint NOT NULL DEFAULT 0,
  last_run_at     timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','error')),
  error_message   text,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (job_name, board_id)
);

CREATE INDEX IF NOT EXISTS job_runs_last_run_idx ON job_runs(job_name, last_run_at DESC);

ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
-- service-role-only; no policy for authenticated.

-- ─────────────────────────────────────────────────────────────────────────────
-- inconsistency_audit: sentinel job output when board_state cache diverges from
-- replay of (latest_snapshot + ops). Should always be empty in steady state.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inconsistency_audit (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id        uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  cache_hash      text NOT NULL,
  replay_hash     text NOT NULL,
  latest_seq      bigint NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS inconsistency_audit_board_idx ON inconsistency_audit(board_id, detected_at DESC);

ALTER TABLE inconsistency_audit ENABLE ROW LEVEL SECURITY;
-- service-role-only; no policy for authenticated.

-- ─────────────────────────────────────────────────────────────────────────────
-- images: add history-aware reference accounting columns.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE images ADD COLUMN IF NOT EXISTS first_referenced_at    timestamptz;
ALTER TABLE images ADD COLUMN IF NOT EXISTS last_referenced_at     timestamptz;
ALTER TABLE images ADD COLUMN IF NOT EXISTS ref_count              int NOT NULL DEFAULT 0;
ALTER TABLE images ADD COLUMN IF NOT EXISTS referenced_in_board_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE images ADD COLUMN IF NOT EXISTS retention_locked_until timestamptz;
ALTER TABLE images ADD COLUMN IF NOT EXISTS deleted_at             timestamptz;

CREATE INDEX IF NOT EXISTS images_storage_path_idx ON images(storage_path);
CREATE INDEX IF NOT EXISTS images_ref_count_idx ON images(ref_count, last_referenced_at) WHERE ref_count = 0;
CREATE INDEX IF NOT EXISTS images_alive_idx ON images(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS images_boards_gin ON images USING GIN (referenced_in_board_ids);

-- ─────────────────────────────────────────────────────────────────────────────
-- Enable Realtime on board_state_version so clients can subscribe to restores.
-- (Realtime publication is set up by Supabase by default; we just need to make
-- sure this table is included. The CLI auto-detects on migrate; in case it
-- doesn't, the operator can run:
--   ALTER PUBLICATION supabase_realtime ADD TABLE board_state_version;
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'board_state_version'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.board_state_version';
    END IF;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: bump board_state_version.updated_at whenever the row changes.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_board_state_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS board_state_version_touch ON board_state_version;
CREATE TRIGGER board_state_version_touch
  BEFORE UPDATE ON board_state_version
  FOR EACH ROW EXECUTE FUNCTION touch_board_state_version();

-- Note: board_ops is append-only by convention. RLS has no INSERT/UPDATE/DELETE
-- policy for authenticated users, so they cannot mutate it. service_role bypasses
-- RLS but writes are restricted to the PartyKit DO + edge functions, which only
-- INSERT. Retention deletes (compaction → R2 archive → DELETE) are explicit
-- code paths reviewed in Phase 6.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper RPCs for the application (Phase 1 ships these for use by later phases).
-- ─────────────────────────────────────────────────────────────────────────────

-- Atomically advance latest_seq on every op flush. Used by the DO.
-- The op insert + this update are wrapped in a transaction at the call site.
CREATE OR REPLACE FUNCTION advance_board_latest_seq(p_board_id uuid, p_new_seq bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE board_state_version
     SET latest_seq = GREATEST(latest_seq, p_new_seq)
   WHERE board_id = p_board_id;
END;
$$;

GRANT EXECUTE ON FUNCTION advance_board_latest_seq(uuid, bigint) TO service_role;

-- Bump version (for a restore). Returns the new version.
CREATE OR REPLACE FUNCTION bump_board_state_version(
  p_board_id uuid,
  p_new_seq bigint,
  p_snapshot_id bigint
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_version bigint;
BEGIN
  UPDATE board_state_version
     SET version = version + 1,
         latest_seq = p_new_seq,
         latest_snapshot_id = p_snapshot_id
   WHERE board_id = p_board_id
   RETURNING version INTO v_new_version;
  RETURN v_new_version;
END;
$$;

GRANT EXECUTE ON FUNCTION bump_board_state_version(uuid, bigint, bigint) TO service_role;

-- Trigger to keep board_state_version.board_id rows present for new boards.
CREATE OR REPLACE FUNCTION ensure_board_state_version_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO board_state_version (board_id, version, latest_seq)
  VALUES (NEW.id, 1, 0)
  ON CONFLICT (board_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boards_ensure_state_version ON boards;
CREATE TRIGGER boards_ensure_state_version
  AFTER INSERT ON boards
  FOR EACH ROW EXECUTE FUNCTION ensure_board_state_version_row();
