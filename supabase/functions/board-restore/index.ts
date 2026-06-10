// supabase/functions/board-restore/index.ts
//
// Phase 5 of the backups/restore rework: the user-facing restore endpoint.
//
// POST /functions/v1/board-restore
// Headers: Authorization: Bearer <user JWT>
// Body: {
//   board_id: uuid,
//   // Provide EXACTLY one of these:
//   target_snapshot_id?: number,      // board_snapshots.id (new system)
//   target_legacy_version_id?: uuid,  // board_versions.id (legacy)
//   reason?: string,
//   client_request_id?: uuid          // idempotency key; auto-generated if absent
// }
//
// Flow (Section 3 of the design):
//   1. Verify user has write access to the board (RLS via the user's token).
//   2. Call perform_board_restore RPC with service role:
//      - locks board_state_version row
//      - takes pre-restore snapshot
//      - writes target bytes to board_state
//      - inserts post-restore snapshot
//      - bumps board_state_version.version
//   3. Notify PartyKit /reset so the in-memory Y.Doc is wiped + clients reload.
//   4. Return the new version + snapshot id.
//
// Reliability: the durable signal is the board_state_version.version bump.
// Clients subscribe to it via Realtime (see boards/src/lib/restoreSignal.js).
// The PartyKit notify is best-effort — if it fails, clients still pick up
// the bump via Realtime within 10s.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PARTYKIT_HOST = Deno.env.get("PARTYKIT_HOST") || "soleil-boards-party.arconkli.partykit.dev";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

function uuid(): string {
  return crypto.randomUUID();
}

interface RestoreBody {
  board_id?: string;
  target_snapshot_id?: number;
  target_legacy_version_id?: string;
  reason?: string;
  client_request_id?: string;
}

async function notifyPartyKitReset(boardId: string, userToken: string): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await fetch(
      `https://${PARTYKIT_HOST}/parties/main/${encodeURIComponent(boardId)}/reset`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        // A hung PartyKit would otherwise stall the user-visible restore
        // response indefinitely; the reset is best-effort (clients also
        // remount on the board_state change).
        signal: AbortSignal.timeout(10_000),
      },
    );
    return { ok: res.ok, status: res.status };
  } catch (e: any) {
    return { ok: false, status: 0 };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("authorization") || "";
  const userToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!userToken) {
    return Response.json({ ok: false, error: "missing bearer token" }, { status: 401, headers: corsHeaders });
  }

  let body: RestoreBody;
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "invalid json body" }, { status: 400, headers: corsHeaders }); }

  const board_id = body.board_id;
  if (!board_id) {
    return Response.json({ ok: false, error: "board_id required" }, { status: 400, headers: corsHeaders });
  }
  if (!body.target_snapshot_id && !body.target_legacy_version_id) {
    return Response.json(
      { ok: false, error: "target_snapshot_id or target_legacy_version_id required" },
      { status: 400, headers: corsHeaders },
    );
  }

  // Step 1: verify user has write access. Use the user's token (RLS-gated).
  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  });
  // can_write_board is the existing RPC the upload party also uses.
  const writeCheck = await userClient.rpc("can_write_board", { p_board_id: board_id });
  if (writeCheck.error) {
    return Response.json(
      { ok: false, error: "write check failed: " + writeCheck.error.message },
      { status: 401, headers: corsHeaders },
    );
  }
  if (writeCheck.data !== true) {
    return Response.json({ ok: false, error: "no write access" }, { status: 403, headers: corsHeaders });
  }

  // Decode the user id from the JWT (the RPC needs an actor for the snapshot
  // created_by column). We don't validate signature here because we already
  // proved write access via the RLS-gated RPC above.
  let actor_id: string | null = null;
  try {
    const payload = JSON.parse(atob(userToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    actor_id = payload.sub ?? null;
  } catch { /* leave null */ }

  const client_request_id = body.client_request_id || uuid();

  // Step 2: run the restore RPC with service role.
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  let rpcResult;
  if (body.target_snapshot_id != null) {
    rpcResult = await adminClient.rpc("perform_board_restore", {
      p_board_id: board_id,
      p_target_snapshot_id: body.target_snapshot_id,
      p_actor_id: actor_id,
      p_reason: body.reason || null,
      p_client_request_id: client_request_id,
    });
  } else {
    rpcResult = await adminClient.rpc("perform_board_restore_from_legacy", {
      p_board_id: board_id,
      p_legacy_version_id: body.target_legacy_version_id!,
      p_actor_id: actor_id,
      p_reason: body.reason || null,
      p_client_request_id: client_request_id,
    });
  }
  if (rpcResult.error) {
    return Response.json(
      { ok: false, error: "restore rpc failed: " + rpcResult.error.message },
      { status: 500, headers: corsHeaders },
    );
  }

  // Step 3: notify PartyKit to wipe in-memory Y.Doc + kick clients.
  // Best-effort: even if it fails, Realtime delivers the version bump.
  const partyResult = await notifyPartyKitReset(board_id, userToken);

  return Response.json(
    {
      ok: true,
      ...rpcResult.data,
      client_request_id,
      partykit_reset: partyResult,
    },
    { status: 200, headers: corsHeaders },
  );
});
