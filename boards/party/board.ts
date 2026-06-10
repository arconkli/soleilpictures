// Board PartyKit server.
//
// One Durable Object per board (room id = board id). y-partykit handles
// the Y.Doc + Awareness wire protocol natively — clients connect via the
// `y-partykit/provider` and edits/cursors flow without any Phoenix
// channel quirks. Edge-located so latency is single-digit ms.
//
// Auth: every connection must include ?access_token=<supabase JWT>.
// We verify membership against Supabase RLS before allowing the join.
// Unauthorized connections are closed with code 4401.

import type * as Party from "partykit/server";
import { onConnect, unstable_getYDoc } from "y-partykit";
import { authBoard, canWriteBoard } from "./auth";
import { installOpLogCapture } from "./opLog";

export default class BoardParty implements Party.Server {
  constructor(readonly room: Party.Room) {}

  // Auth check before the WebSocket is upgraded. Returning a Response
  // from onBeforeConnect rejects the connection with that response.
  // We also stamp x-can-write so onConnect can mark viewer connections
  // readOnly, which makes y-partykit drop incoming sync-step-2 + update
  // messages from them (the actual write enforcement at the protocol
  // level — without this, viewers could broadcast Y.js updates that
  // ephemerally render in other connected tabs).
  static async onBeforeConnect(req: Party.Request) {
    const url = new URL(req.url);
    const token = url.searchParams.get("access_token");
    if (!token) return new Response("Missing access_token", { status: 401 });
    const boardId = url.pathname.split("/").filter(Boolean).pop() ?? "";
    // Independent checks — run both round-trips concurrently so the WS
    // upgrade waits on one Supabase RTT, not two.
    const [auth, canWrite] = await Promise.all([
      authBoard(token, boardId),
      canWriteBoard(token, boardId),
    ]);
    if (!auth.ok) return new Response(auth.reason ?? "Unauthorized", { status: 401 });
    req.headers.set("x-user-id", auth.userId ?? "");
    req.headers.set("x-user-email", auth.email ?? "");
    req.headers.set("x-workspace-id", auth.workspaceId ?? "");
    req.headers.set("x-can-write", canWrite ? "1" : "0");
    return req;
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const canWrite = ctx.request.headers.get("x-can-write") === "1";

    const yPartyOpts = {
      persist: { mode: "snapshot" as const },
      readOnly: !canWrite,
    };

    // y-partykit handles the Y wire protocol over this socket. The
    // server holds an authoritative Y.Doc for this room; clients sync
    // against it. Awareness is built in. readOnly drops doc-update
    // messages from viewer-share connections; awareness still flows so
    // viewers' cursors/presence are visible to peers.
    await onConnect(conn, this.room, yPartyOpts);

    // Phase 4: dual-write op capture + Phase 6 anomaly detection.
    // Install once per DO boot — installOpLogCapture is idempotent
    // (uses WeakSet) so repeated onConnect calls don't double-wire.
    // No-ops if SUPABASE_SERVICE_ROLE_KEY env var is unset.
    try {
      const yDoc = await unstable_getYDoc(this.room, yPartyOpts);
      const workspaceId = ctx.request.headers.get("x-workspace-id") || undefined;
      installOpLogCapture({
        boardId: this.room.id,
        workspaceId,
        yDoc,
        supabaseUrl: (this.room.env as any)?.SUPABASE_URL
          || "https://ehlhlmbpwwalmeisvmdp.supabase.co",
        serviceRoleKey: (this.room.env as any)?.SUPABASE_SERVICE_ROLE_KEY,
      });
    } catch (e) {
      console.warn(`[board ${this.room.id}] opLog install failed`, e);
    }
  }

  // Admin POST that nukes the room's Durable Object storage and kicks
  // every connected client. Used by the bulletproof-restore flow: the
  // client first writes the restored bytes to board_state (Supabase),
  // then POSTs here to wipe the stale y-partykit snapshot that would
  // otherwise merge the deleted state back in. After this returns the
  // client triggers a Y.Doc remount; cold-load reads the restored
  // bytes from board_state and re-establishes the room from scratch.
  //
  // Auth: same Bearer token as the WebSocket. Requires can_write_board.
  // POST body is optional — we don't read it; the bytes are written
  // to board_state separately by the client.
  async onRequest(req: Party.Request) {
    // CORS preflight. The browser sends OPTIONS before the actual POST
    // because the request carries an Authorization header (custom). Reply
    // with the headers permitting the actual request.
    const origin = req.headers.get("origin") || "*";
    const corsHeaders: Record<string, string> = {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": "86400",
      "vary": "Origin",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }
    const url = new URL(req.url);
    if (!url.pathname.endsWith("/reset")) {
      return new Response("Not found", { status: 404, headers: corsHeaders });
    }
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token) return new Response("Missing token", { status: 401, headers: corsHeaders });
    const boardId = this.room.id;
    const [a, canWrite] = await Promise.all([
      authBoard(token, boardId),
      canWriteBoard(token, boardId),
    ]);
    if (!a.ok) return new Response(a.reason || "Unauthorized", { status: 401, headers: corsHeaders });
    if (!canWrite) return new Response("Read-only", { status: 403, headers: corsHeaders });

    // ── Collab-safe reset sequence ───────────────────────────────────────
    // The order matters. If we close the WS connections first, peers'
    // partysocket auto-reconnects fire instantly — they hit the now-empty
    // DO with their stale local Y.Doc state in memory and push the bad
    // ops back up. To eliminate that race, BROADCAST a remount signal as
    // a text frame to every connection BEFORE wiping/closing. The client
    // intercepts the text frame and triggers a useYBoard remount, which
    // destroys the local Y.Doc and re-cold-loads from board_state (which
    // the restoring client has already written with the restored bytes).
    //
    // We give the broadcast ~150ms to propagate before tearing the
    // connections down — long enough for the WS frame to deliver, short
    // enough that the restore feels instant.
    const signal = JSON.stringify({
      type: "soleil-board-reset",
      boardId,
      ts: Date.now(),
    });
    try { this.room.broadcast(signal); }
    catch (e) { console.error("[board/reset] broadcast failed", e); }

    // Give the text frame time to flush.
    await new Promise((r) => setTimeout(r, 150));

    // Wipe the entire DO storage — this clears every key y-partykit
    // wrote (snapshot, updates, awareness, etc). Next connection cold-
    // loads from scratch.
    try { await this.room.storage.deleteAll(); }
    catch (e) { console.error("[board/reset] deleteAll failed", e); }

    // Close every active connection so they don't immediately
    // re-broadcast their stale local state into the now-empty room.
    // Code 4030 = our convention for "room reset; please reload".
    let kicked = 0;
    for (const conn of this.room.getConnections()) {
      try { conn.close(4030, "room reset"); kicked++; } catch (_) {}
    }

    return new Response(JSON.stringify({ ok: true, kicked, signaled: true }), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
}
