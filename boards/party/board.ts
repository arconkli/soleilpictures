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
import { authBoard } from "./auth";

export default class BoardParty implements Party.Server {
  constructor(readonly room: Party.Room) {}

  // Auth check before the WebSocket is upgraded. Returning a Response
  // from onBeforeConnect rejects the connection with that response.
  static async onBeforeConnect(req: Party.Request) {
    const url = new URL(req.url);
    const token = url.searchParams.get("access_token");
    if (!token) return new Response("Missing access_token", { status: 401 });
    // The room id is the board id (last path segment).
    const boardId = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const auth = await authBoard(token, boardId);
    if (!auth.ok) return new Response(auth.reason ?? "Unauthorized", { status: 401 });
    // Stash user info for the connection (read in onConnect via state).
    req.headers.set("x-user-id", auth.userId ?? "");
    req.headers.set("x-user-email", auth.email ?? "");
    return req;
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // y-partykit handles the Y wire protocol over this socket. The
    // server holds an authoritative Y.Doc for this room; clients sync
    // against it. Awareness is built in.
    await onConnect(conn, this.room, {
      // Persist the Y.Doc across DO restarts (lives in DO storage).
      persist: { mode: "snapshot" },
      // Don't trust client-supplied awareness state — we let it through
      // unmodified for now; future: filter cursors to authorized fields.
    });
  }
}
