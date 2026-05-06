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
import { onConnect } from "y-partykit";
import { authBoard, canWriteBoard } from "./auth";

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
    const auth = await authBoard(token, boardId);
    if (!auth.ok) return new Response(auth.reason ?? "Unauthorized", { status: 401 });
    const canWrite = await canWriteBoard(token, boardId);
    req.headers.set("x-user-id", auth.userId ?? "");
    req.headers.set("x-user-email", auth.email ?? "");
    req.headers.set("x-can-write", canWrite ? "1" : "0");
    return req;
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const canWrite = ctx.request.headers.get("x-can-write") === "1";
    // y-partykit handles the Y wire protocol over this socket. The
    // server holds an authoritative Y.Doc for this room; clients sync
    // against it. Awareness is built in. readOnly drops doc-update
    // messages from viewer-share connections; awareness still flows so
    // viewers' cursors/presence are visible to peers.
    await onConnect(conn, this.room, {
      persist: { mode: "snapshot" },
      readOnly: !canWrite,
    });
  }
}
