-- 0070_workspace_rewind.sql
-- Follow-up 1 of the backups/restore rework. Workspace-wide rewind.
--
-- Atomically rewinds EVERY board in a workspace to the latest snapshot
-- at-or-before a target timestamp. The operation runs inside a single
-- Postgres transaction so either all selected boards advance to their
-- new state-version, or none do. Each board gets its own pre-restore
-- snapshot, so the entire operation is itself reversible.
--
-- This is the catastrophic-recovery mechanism: when a bug deletes
-- everything across many boards, the user clicks one button and the
-- whole workspace rolls back.

-- Compute the impact preview for a given target_ts. For each board, find
-- the latest snapshot at-or-before target_ts and decode its card count.
-- Returns rows the WorkspaceRecoveryModal renders in its impact preview.
--
-- Cards-then is approximated via the snapshot's stored doc_b64 length —
-- decoding every snapshot's Y.Doc just for card count would be expensive
-- on a workspace-wide query. The frontend can decode lazily on hover.
CREATE OR REPLACE FUNCTION workspace_rewind_preview(
  p_workspace_id uuid,
  p_target_ts    timestamptz
)
RETURNS TABLE (
  board_id         uuid,
  board_name       text,
  target_snapshot_id bigint,
  target_at_ts     timestamptz,
  target_kind      text,
  target_label     text,
  current_seq      bigint,
  current_version  bigint,
  current_doc_len  bigint,
  target_doc_len   bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  WITH workspace_boards AS (
    SELECT b.id, b.name
      FROM boards b
     WHERE b.workspace_id = p_workspace_id
       AND b.deleted_at IS NULL
  ),
  per_board_target AS (
    SELECT DISTINCT ON (bs.board_id)
      bs.board_id,
      bs.id     AS snapshot_id,
      bs.at_ts,
      bs.kind,
      bs.label,
      bs.doc_b64
    FROM board_snapshots bs
    JOIN workspace_boards wb ON wb.id = bs.board_id
    WHERE bs.at_ts <= p_target_ts
      AND bs.storage = 'postgres'   -- TODO: r2 fetch in caller for older snapshots
    ORDER BY bs.board_id, bs.at_ts DESC
  )
  SELECT
    wb.id                                                  AS board_id,
    wb.name                                                AS board_name,
    pbt.snapshot_id                                        AS target_snapshot_id,
    pbt.at_ts                                              AS target_at_ts,
    pbt.kind                                               AS target_kind,
    pbt.label                                              AS target_label,
    bsv.latest_seq                                         AS current_seq,
    bsv.version                                            AS current_version,
    COALESCE(octet_length(bst.doc), 0)::bigint             AS current_doc_len,
    COALESCE(octet_length(pbt.doc_b64), 0)::bigint         AS target_doc_len
  FROM workspace_boards wb
  LEFT JOIN per_board_target pbt ON pbt.board_id = wb.id
  LEFT JOIN board_state_version bsv ON bsv.board_id = wb.id
  LEFT JOIN board_state bst ON bst.board_id = wb.id
  ORDER BY wb.name;
$$;

REVOKE ALL ON FUNCTION workspace_rewind_preview(uuid, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION workspace_rewind_preview(uuid, timestamptz) TO authenticated, service_role;


-- Atomic workspace-wide rewind. Calls perform_board_restore for each
-- (board_id, snapshot_id) pair inside one transaction. If any board
-- fails (e.g. the target snapshot is no longer present), the whole
-- transaction rolls back — atomicity is the whole point of this
-- function vs the frontend looping perform_board_restore.
--
-- p_targets is jsonb in the shape:
--   [ { "board_id": uuid, "snapshot_id": bigint }, ... ]
--
-- The caller (edge function) computes p_targets from workspace_rewind_preview
-- + user selection so that the operator can deselect boards if needed.
CREATE OR REPLACE FUNCTION perform_workspace_rewind(
  p_workspace_id      uuid,
  p_targets           jsonb,
  p_actor_id          uuid,
  p_reason            text,
  p_client_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target         jsonb;
  v_results        jsonb := '[]'::jsonb;
  v_one_result     jsonb;
  v_board_id       uuid;
  v_snapshot_id    bigint;
  v_count          int := 0;
  v_skipped        int := 0;
  v_per_board_id   uuid;
BEGIN
  -- Idempotency: a workspace_anomaly_alerts row with this client_request_id
  -- in payload means we already performed this rewind.
  IF EXISTS (
    SELECT 1 FROM workspace_anomaly_alerts
    WHERE workspace_id = p_workspace_id
      AND kind = 'workspace.rewind'
      AND (payload->>'client_request_id')::uuid = p_client_request_id
  ) THEN
    RETURN jsonb_build_object('idempotent_hit', true, 'targets_count', jsonb_array_length(p_targets));
  END IF;

  -- Iterate the targets. Each call to perform_board_restore is itself
  -- atomic; running them in the same transaction makes the WHOLE rewind
  -- atomic — any failure aborts everything.
  FOR v_target IN SELECT * FROM jsonb_array_elements(p_targets)
  LOOP
    v_board_id := (v_target->>'board_id')::uuid;
    v_snapshot_id := (v_target->>'snapshot_id')::bigint;
    IF v_board_id IS NULL OR v_snapshot_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    -- Per-board restore. Inherits its idempotency via a derived
    -- client_request_id so identical rewind retries are no-ops.
    v_one_result := perform_board_restore(
      v_board_id,
      v_snapshot_id,
      p_actor_id,
      'workspace rewind: ' || COALESCE(p_reason, ''),
      uuid_generate_v5(p_client_request_id, v_board_id::text)
    );
    v_results := v_results || jsonb_build_object(
      'board_id', v_board_id,
      'snapshot_id', v_snapshot_id,
      'result', v_one_result
    );
    v_count := v_count + 1;
  END LOOP;

  -- Audit row in workspace_anomaly_alerts. Surfaces the rewind in the UI
  -- alert history so operators can see (and undo, if desired) what was
  -- done at a workspace level.
  INSERT INTO workspace_anomaly_alerts (
    workspace_id, board_ids, kind, severity, payload, acknowledged_at, acknowledged_by
  ) VALUES (
    p_workspace_id,
    ARRAY(SELECT (v->>'board_id')::uuid FROM jsonb_array_elements(p_targets) v),
    'workspace.rewind',
    'info',
    jsonb_build_object(
      'client_request_id', p_client_request_id,
      'targets_count', v_count,
      'skipped_count', v_skipped,
      'reason', p_reason,
      'results', v_results,
      'actor_id', p_actor_id
    ),
    now(),
    p_actor_id
  );

  RETURN jsonb_build_object(
    'idempotent_hit', false,
    'targets_count', v_count,
    'skipped_count', v_skipped,
    'results', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION perform_workspace_rewind(uuid, jsonb, uuid, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION perform_workspace_rewind(uuid, jsonb, uuid, text, uuid) TO service_role;


-- uuid-ossp's uuid_generate_v5 is in the supabase pg_uuidv5 extension or
-- the older uuid-ossp. Enable if not already present.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
