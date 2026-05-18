-- 0063_history_rework_append_op_rpc.sql
-- Phase 4 of the backups/restore rework. Atomic op-log append RPC.
--
-- Called by the PartyKit Durable Object on every Y.Update with a
-- service-role JWT. Locks the per-board state-version row, allocates the
-- next sequence number, inserts the op row, and advances latest_seq —
-- all in one transaction. No client coordination needed for ordering.
--
-- SECURITY DEFINER so the service-role caller doesn't need to manage table
-- grants. Service role bypasses RLS, so authenticated users still can't
-- invoke this directly (the function is GRANTed only to service_role).

CREATE OR REPLACE FUNCTION append_board_op(
  p_board_id     uuid,
  p_author_id    uuid,
  p_client_id    text,
  p_tx_id        uuid,
  p_tx_role      text,
  p_op_kind      text,
  p_card_ids     text[],
  p_r2_keys      text[],
  p_update_b64   text,
  p_update_hash  text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_seq bigint;
BEGIN
  -- Lock the board_state_version row to serialize seq allocation per board.
  -- Concurrent appends from the same DO are rare (a single DO is single-
  -- threaded for Y.Update handling) but separate workspaces or extension
  -- writers might race; this guards us.
  PERFORM 1
    FROM board_state_version
   WHERE board_id = p_board_id
     FOR UPDATE;

  -- Next sequence number for this board.
  SELECT COALESCE(MAX(seq), 0) + 1
    INTO v_seq
    FROM board_ops
   WHERE board_id = p_board_id;

  INSERT INTO board_ops (
    board_id, seq, ts,
    author_id, client_id,
    tx_id, tx_role,
    op_kind, card_ids, r2_keys,
    update_b64, update_hash
  ) VALUES (
    p_board_id, v_seq, now(),
    p_author_id, p_client_id,
    p_tx_id, p_tx_role,
    COALESCE(p_op_kind, 'op.other'),
    COALESCE(p_card_ids, '{}'::text[]),
    COALESCE(p_r2_keys, '{}'::text[]),
    p_update_b64, p_update_hash
  );

  -- Advance the cursor. Does NOT bump `version` (that's reserved for
  -- restores). Clients see latest_seq via Realtime if they're subscribed
  -- but the restoreSignal helper only reacts to version bumps.
  UPDATE board_state_version
     SET latest_seq = v_seq
   WHERE board_id = p_board_id;

  RETURN v_seq;
END;
$$;

REVOKE ALL ON FUNCTION append_board_op(uuid, uuid, text, uuid, text, text, text[], text[], text, text) FROM public;
GRANT EXECUTE ON FUNCTION append_board_op(uuid, uuid, text, uuid, text, text, text[], text[], text, text) TO service_role;
