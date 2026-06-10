// supabase/functions/workspace-rewind/index.ts
//
// POST /functions/v1/workspace-rewind
// Headers: Authorization: Bearer <user JWT>
// Body: {
//   action: 'preview' | 'rewind',
//   workspace_id: uuid,
//   // preview:
//   target_ts?: ISO8601,
//   // rewind:
//   targets?: [{ board_id: uuid, snapshot_id: number }, ...],
//   reason?: string,
//   client_request_id?: uuid,
// }
//
// preview: returns the WorkspaceRecoveryModal's impact preview rows (each
//          board's current vs target byte length, snapshot kind/label,
//          current version). Read-only.
//
// rewind:  invokes perform_workspace_rewind which atomically restores
//          every selected board to its snapshot. Issues a separate
//          PartyKit /reset notification per affected board in parallel.
//
// Authorization: requires workspace ownership. Other members get 403.

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

interface RewindBody {
  action?: "preview" | "rewind";
  workspace_id?: string;
  target_ts?: string;
  targets?: Array<{ board_id: string; snapshot_id: number }>;
  reason?: string;
  client_request_id?: string;
}

async function notifyPartyKitReset(boardId: string, userToken: string) {
  try {
    const res = await fetch(
      `https://${PARTYKIT_HOST}/parties/main/${encodeURIComponent(boardId)}/reset`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
        body: "{}",
        // Best-effort: don't let a hung PartyKit stall the rewind response.
        signal: AbortSignal.timeout(10_000),
      },
    );
    return { board_id: boardId, ok: res.ok, status: res.status };
  } catch {
    return { board_id: boardId, ok: false, status: 0 };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const authHeader = req.headers.get("authorization") || "";
  const userToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!userToken) {
    return Response.json({ ok: false, error: "missing bearer token" }, { status: 401, headers: corsHeaders });
  }

  let body: RewindBody;
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "invalid json" }, { status: 400, headers: corsHeaders }); }

  const workspace_id = body.workspace_id;
  if (!workspace_id) {
    return Response.json({ ok: false, error: "workspace_id required" }, { status: 400, headers: corsHeaders });
  }

  // Decode user id from JWT (without signature verification — the membership
  // check below proves who they are via RLS).
  let actor_id: string | null = null;
  try {
    const payload = JSON.parse(atob(userToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    actor_id = payload.sub ?? null;
  } catch { /* ignore */ }

  // Authorization: must be workspace owner. Use a user-token client to RLS-check.
  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  });
  const ws = await userClient
    .from("workspaces")
    .select("id, created_by")
    .eq("id", workspace_id)
    .maybeSingle();
  if (ws.error) {
    return Response.json({ ok: false, error: "workspace lookup failed: " + ws.error.message }, { status: 401, headers: corsHeaders });
  }
  if (!ws.data) {
    return Response.json({ ok: false, error: "workspace not found or no access" }, { status: 404, headers: corsHeaders });
  }
  // Only the owner can do a workspace-wide rewind (this is destructive).
  if (ws.data.created_by !== actor_id) {
    return Response.json({ ok: false, error: "only the workspace owner can perform a workspace rewind" }, { status: 403, headers: corsHeaders });
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  if (body.action === "preview") {
    if (!body.target_ts) {
      return Response.json({ ok: false, error: "target_ts required for preview" }, { status: 400, headers: corsHeaders });
    }
    const preview = await adminClient.rpc("workspace_rewind_preview", {
      p_workspace_id: workspace_id,
      p_target_ts: body.target_ts,
    });
    if (preview.error) {
      return Response.json({ ok: false, error: "preview failed: " + preview.error.message }, { status: 500, headers: corsHeaders });
    }
    return Response.json({ ok: true, rows: preview.data }, { status: 200, headers: corsHeaders });
  }

  if (body.action === "rewind") {
    if (!Array.isArray(body.targets) || body.targets.length === 0) {
      return Response.json({ ok: false, error: "targets[] required for rewind" }, { status: 400, headers: corsHeaders });
    }
    const client_request_id = body.client_request_id || crypto.randomUUID();
    const rpcResult = await adminClient.rpc("perform_workspace_rewind", {
      p_workspace_id: workspace_id,
      p_targets: body.targets,
      p_actor_id: actor_id,
      p_reason: body.reason || null,
      p_client_request_id: client_request_id,
    });
    if (rpcResult.error) {
      return Response.json({ ok: false, error: "rewind failed: " + rpcResult.error.message }, { status: 500, headers: corsHeaders });
    }
    // Fan out PartyKit reset notifications in parallel.
    const partyResults = await Promise.all(
      body.targets.map((t) => notifyPartyKitReset(t.board_id, userToken)),
    );
    return Response.json(
      { ok: true, ...rpcResult.data, client_request_id, partykit_resets: partyResults },
      { status: 200, headers: corsHeaders },
    );
  }

  return Response.json({ ok: false, error: "unknown action; use preview or rewind" }, { status: 400, headers: corsHeaders });
});
