-- 0064_history_rework_perform_restore_rpc.sql
-- Phase 5 of the backups/restore rework. Atomic restore RPC.
--
-- Performs a whole-board restore to a target snapshot, atomically:
--   1. Locks the per-board state-version row (single-writer-per-board).
--   2. Reads the target snapshot's doc bytes.
--   3. Reads the CURRENT board_state and inserts a pre-restore snapshot
--      so the restore is itself undoable.
--   4. Writes the target doc bytes into board_state (the cold-load source).
--   5. Inserts an audit snapshot at the post-restore state pointing at the
--      same bytes (kind='post-restore').
--   6. Bumps board_state_version.version + latest_snapshot_id. This is the
--      durable signal that clients consume via Realtime to remount their
--      Y.Doc.
--
-- Idempotency: client_request_id is recorded as the pre-restore snapshot's
-- label suffix. If the same id is replayed, returns the previous version
-- without doing the work twice.
--
-- Returns: { new_version bigint, new_snapshot_id bigint, pre_restore_snapshot_id bigint }
--
-- Auth: SECURITY DEFINER + service_role-only GRANT. The edge function
-- enforces user-level write access before calling this.

CREATE OR REPLACE FUNCTION perform_board_restore(
  p_board_id           uuid,
  p_target_snapshot_id bigint,
  p_actor_id           uuid,
  p_reason             text,
  p_client_request_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target_doc          text;
  v_target_storage      text;
  v_target_r2_key       text;
  v_current_doc         text;
  v_pre_label           text;
  v_pre_restore_id      bigint;
  v_post_restore_id     bigint;
  v_new_version         bigint;
  v_existing_pre        bigint;
BEGIN
  -- Idempotency check: did we already do this restore?
  v_pre_label := 'pre-restore:' || p_client_request_id::text;
  SELECT id INTO v_existing_pre
    FROM board_snapshots
   WHERE board_id = p_board_id
     AND kind = 'pre-restore'
     AND label = v_pre_label
   LIMIT 1;
  IF v_existing_pre IS NOT NULL THEN
    -- Find the version + new snapshot from the existing restore.
    SELECT version, latest_snapshot_id INTO v_new_version, v_post_restore_id
      FROM board_state_version WHERE board_id = p_board_id;
    RETURN jsonb_build_object(
      'idempotent_hit',         true,
      'new_version',            v_new_version,
      'new_snapshot_id',        v_post_restore_id,
      'pre_restore_snapshot_id', v_existing_pre
    );
  END IF;

  -- Lock the state row (single writer per board for restore).
  PERFORM 1 FROM board_state_version
   WHERE board_id = p_board_id FOR UPDATE;

  -- Load the target snapshot bytes.
  SELECT doc_b64, storage, r2_key
    INTO v_target_doc, v_target_storage, v_target_r2_key
    FROM board_snapshots
   WHERE id = p_target_snapshot_id AND board_id = p_board_id;
  IF v_target_doc IS NULL THEN
    IF v_target_storage = 'r2' THEN
      RAISE EXCEPTION 'target snapshot % is in R2 (key=%); fetch + inline must happen in caller', p_target_snapshot_id, v_target_r2_key;
    END IF;
    RAISE EXCEPTION 'target snapshot % not found for board %', p_target_snapshot_id, p_board_id;
  END IF;

  -- Snapshot the current state as pre-restore (so the restore is undoable).
  SELECT doc INTO v_current_doc
    FROM board_state WHERE board_id = p_board_id;
  IF v_current_doc IS NULL THEN
    -- No current state (brand-new board). Pre-restore snapshot is the empty doc.
    v_current_doc := '';
  END IF;

  INSERT INTO board_snapshots (
    board_id, at_seq, at_ts, storage, doc_b64, doc_hash,
    kind, label, created_by
  ) VALUES (
    p_board_id, 0, now(), 'postgres', v_current_doc,
    'sha256:' || encode(digest(v_current_doc, 'sha256'), 'hex'),
    'pre-restore', v_pre_label, p_actor_id
  ) RETURNING id INTO v_pre_restore_id;

  -- Overwrite board_state with the target bytes.
  -- board_state is the cold-load source for clients reconnecting after the restore.
  UPDATE board_state
     SET doc = v_target_doc,
         updated_at = now()
   WHERE board_id = p_board_id;
  IF NOT FOUND THEN
    INSERT INTO board_state (board_id, doc, updated_at)
    VALUES (p_board_id, v_target_doc, now());
  END IF;

  -- Audit snapshot at the post-restore state (kind='post-restore').
  -- This is the new canonical "latest_snapshot_id" for cold-load.
  INSERT INTO board_snapshots (
    board_id, at_seq, at_ts, storage, doc_b64, doc_hash,
    kind, label, created_by
  ) VALUES (
    p_board_id, 0, now(), 'postgres', v_target_doc,
    'sha256:' || encode(digest(v_target_doc, 'sha256'), 'hex'),
    'post-restore',
    COALESCE(p_reason, '') || ' (from snap ' || p_target_snapshot_id::text || ')',
    p_actor_id
  ) RETURNING id INTO v_post_restore_id;

  -- Bump version (the durable Realtime signal). DO NOT advance latest_seq
  -- here; ops written into board_ops by PartyKit retain their own ordering.
  UPDATE board_state_version
     SET version = version + 1,
         latest_snapshot_id = v_post_restore_id
   WHERE board_id = p_board_id
  RETURNING version INTO v_new_version;

  RETURN jsonb_build_object(
    'idempotent_hit',          false,
    'new_version',             v_new_version,
    'new_snapshot_id',         v_post_restore_id,
    'pre_restore_snapshot_id', v_pre_restore_id
  );
END;
$$;

REVOKE ALL ON FUNCTION perform_board_restore(uuid, bigint, uuid, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION perform_board_restore(uuid, bigint, uuid, text, uuid) TO service_role;


-- Convenience overload: restore from a legacy board_versions.id by mapping
-- to the corresponding board_snapshots row via legacy_version_id. Lets the
-- existing HistoryModal call the new endpoint without restructuring its UI.
CREATE OR REPLACE FUNCTION perform_board_restore_from_legacy(
  p_board_id          uuid,
  p_legacy_version_id uuid,
  p_actor_id          uuid,
  p_reason            text,
  p_client_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_snapshot_id bigint;
BEGIN
  SELECT id INTO v_snapshot_id
    FROM board_snapshots
   WHERE board_id = p_board_id
     AND legacy_version_id = p_legacy_version_id
   LIMIT 1;
  IF v_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'no migrated snapshot found for legacy version %', p_legacy_version_id;
  END IF;
  RETURN perform_board_restore(p_board_id, v_snapshot_id, p_actor_id, p_reason, p_client_request_id);
END;
$$;

REVOKE ALL ON FUNCTION perform_board_restore_from_legacy(uuid, uuid, uuid, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION perform_board_restore_from_legacy(uuid, uuid, uuid, text, uuid) TO service_role;
