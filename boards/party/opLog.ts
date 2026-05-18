// boards/party/opLog.ts
//
// Phase 4: capture every Y.Update emitted in a board's PartyKit room and
// append it to the board_ops log via the append_board_op RPC.
//
// Runs INSIDE the PartyKit Durable Object alongside y-partykit. y-partykit
// owns the authoritative Y.Doc; we attach an 'update' listener once per DO
// boot and, for each update, classify + persist asynchronously.
//
// This is dual-write: y-partykit continues to persist its snapshot to DO
// storage, and the client-side debounced board_state writer is unchanged.
// The new board_ops rows are an *additional* log; nothing reads from them
// yet (Phase 5 will wire them into the new restore UI).
//
// Origins we skip:
//   - 'classifier:*'         our own classifier-tmp-doc updates (never seen here, defensive)
//   - 'restore'              updates that come from a restore (the restore endpoint
//                            inserts the op directly into board_ops; we'd double-write)
//   - 'soleil:cold-load'     initial cold-load syncs that aren't user edits
//
// If SUPABASE_SERVICE_ROLE_KEY is not set in the PartyKit room env, op
// capture silently no-ops — the system still works, the new log just stays
// empty. This makes the deploy safe even before the secret is configured.

import * as Y from "yjs";
import { classifyUpdate, hashUpdateBytes } from "../src/lib/op_classifier.js";

// Base64 encode/decode (Cloudflare Workers have atob/btoa globally).
function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// Origins that should NOT be persisted to board_ops.
const SKIP_ORIGINS = new Set([
  "restore",
  "soleil:cold-load",
]);

function shouldSkip(origin: unknown): boolean {
  if (origin == null) return false;
  const s = typeof origin === "string" ? origin : String(origin);
  if (SKIP_ORIGINS.has(s)) return true;
  if (s.startsWith("classifier:")) return true;
  return false;
}

interface InstallOptions {
  boardId: string;
  yDoc: Y.Doc;
  supabaseUrl: string;
  serviceRoleKey: string | undefined;
  // Bound function to extract the user id of the connection that produced
  // the update. y-partykit doesn't surface the user per-update; for v0 we
  // pass null and accept that author_id is unknown on the server side.
  // Phase 6 work will wire client_id → user_id via a per-connection map.
  resolveAuthor?: (clientId: string | null) => string | null;
}

// Each Durable Object instance installs the listener exactly once. The
// global tracks which DOs have already been wired so a second onConnect
// doesn't double-wire.
const WIRED_DOCS = new WeakSet<Y.Doc>();

export function installOpLogCapture(opts: InstallOptions): void {
  const { boardId, yDoc, supabaseUrl, serviceRoleKey } = opts;
  if (WIRED_DOCS.has(yDoc)) return;
  WIRED_DOCS.add(yDoc);

  if (!serviceRoleKey) {
    console.warn(`[opLog ${boardId}] SUPABASE_SERVICE_ROLE_KEY missing; op capture disabled`);
    return;
  }

  // Maintain the "before" state for the classifier. We update this AFTER
  // each successful capture so subsequent updates see the prior state.
  let beforeState: Uint8Array = Y.encodeStateAsUpdate(yDoc);

  yDoc.on("update", async (update: Uint8Array, origin: unknown) => {
    if (shouldSkip(origin)) return;
    // Capture is async + fire-and-forget. We do NOT block the Y wire
    // protocol. If persistence fails, the system loses one row of history
    // (which board_state still has) and logs a warning.
    const stateAtCapture = beforeState;
    // Move the cursor forward immediately so we never double-persist if
    // updates fire close together.
    beforeState = Y.encodeStateAsUpdate(yDoc);

    try {
      const classification = classifyUpdate(stateAtCapture, update);
      const update_b64 = bytesToB64(update);
      const update_hash = await hashUpdateBytes(update);

      const body = {
        p_board_id: boardId,
        p_author_id: null,
        p_client_id: typeof origin === "string" ? origin : null,
        p_tx_id: null,
        p_tx_role: null,
        p_op_kind: classification.op_kind,
        p_card_ids: classification.card_ids,
        p_r2_keys: classification.r2_keys,
        p_update_b64: update_b64,
        p_update_hash: update_hash,
      };

      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/append_board_op`, {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          Prefer: "params=single-object",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(`[opLog ${boardId}] append failed status=${res.status} body=${text.slice(0, 200)}`);
      }
    } catch (e: any) {
      console.warn(`[opLog ${boardId}] capture threw: ${e?.message || e}`);
    }
  });
}
