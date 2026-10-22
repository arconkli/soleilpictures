-- 0601_rewind_stays_in_its_workspace.sql
--
-- A workspace rewind restores clusters of the workspace it names, and only
-- those. The workspace-rewind edge function checks that the caller owns
-- p_workspace_id; this function now checks that every target cluster belongs
-- to that workspace before restoring anything, and refuses the whole rewind
-- otherwise (the app only ever sends targets from workspace_rewind_preview for
-- the same workspace). perform_board_restore already requires the snapshot to
-- be the cluster's own.
--
-- Re-emitted from the live definition; the only change is the
-- "IF NOT EXISTS (SELECT 1 FROM boards …)" block.

CREATE OR REPLACE FUNCTION public.perform_workspace_rewind(p_workspace_id uuid, p_targets jsonb, p_actor_id uuid, p_reason text, p_client_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_target         jsonb;
  v_results        jsonb := '[]'::jsonb;
  v_one_result     jsonb;
  v_board_id       uuid;
  v_snapshot_id    bigint;
  v_count          int := 0;
  v_skipped        int := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM workspace_anomaly_alerts
    WHERE workspace_id = p_workspace_id
      AND kind = 'workspace.rewind'
      AND (payload->>'client_request_id')::uuid = p_client_request_id
  ) THEN
    RETURN jsonb_build_object('idempotent_hit', true, 'targets_count', jsonb_array_length(p_targets));
  END IF;

  FOR v_target IN SELECT * FROM jsonb_array_elements(p_targets)
  LOOP
    v_board_id := (v_target->>'board_id')::uuid;
    v_snapshot_id := (v_target->>'snapshot_id')::bigint;
    IF v_board_id IS NULL OR v_snapshot_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM boards b
       WHERE b.id = v_board_id
         AND b.workspace_id = p_workspace_id
    ) THEN
      RAISE EXCEPTION 'every cluster in a rewind must belong to the workspace being rewound'
        USING ERRCODE = '42501';
    END IF;
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
$function$;

-- The 0311 habit: the rewind stays callable by the edge function's service
-- role only.
do $$
begin
  if has_function_privilege('anon', 'public.perform_workspace_rewind(uuid,jsonb,uuid,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.perform_workspace_rewind(uuid,jsonb,uuid,text,uuid)', 'EXECUTE') then
    raise exception '0601: perform_workspace_rewind is client-callable';
  end if;
  if not has_function_privilege('service_role', 'public.perform_workspace_rewind(uuid,jsonb,uuid,text,uuid)', 'EXECUTE') then
    raise exception '0601: the workspace-rewind edge function lost perform_workspace_rewind';
  end if;
end $$;
