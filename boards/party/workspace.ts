// Workspace presence PartyKit server.
//
// One Durable Object per workspace (room id = workspace id). Tracks
// who is currently online and where they are (board id + surface),
// so the topbar avatars + click-to-jump work. Pure broadcast — no
// Y.Doc here, just message fanout + presence tracking.
//
// Wire protocol (JSON over WebSocket):
//   {type:'here', user, location, tabId}        ← client → server (heartbeat)
//   {type:'here', from, user, location}          ← server → other clients
//   {type:'leave', tabId}                        ← client → server (on close)
//   {type:'leave', from}                         ← server → other clients
//   {type:'roster', peers: [...]}                ← server → newly-joined client
//
// Auth: ?access_token=<supabase JWT>; verified against workspace membership.

import type * as Party from "partykit/server";
import { authWorkspace } from "./auth";

interface PeerRecord {
  tabId: string;
  user: { id: string; name?: string; color?: string; email?: string };
  location?: { boardId?: string; boardName?: string; surface?: string; pageId?: string | null; scrollTop?: number };
  lastSeen: number;
}

const STALE_MS = 60_000;     // peers go stale after 60s with no heartbeat

export default class WorkspaceParty implements Party.Server {
  // tabId → record. Lives in DO memory; on restart the room re-populates
  // as peers reconnect and re-broadcast their location.
  private peers: Map<string, PeerRecord> = new Map();

  constructor(readonly room: Party.Room) {}

  static async onBeforeConnect(req: Party.Request) {
    const url = new URL(req.url);
    const token = url.searchParams.get("access_token");
    if (!token) return new Response("Missing access_token", { status: 401 });
    const workspaceId = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const auth = await authWorkspace(token, workspaceId);
    if (!auth.ok) return new Response(auth.reason ?? "Unauthorized", { status: 401 });
    return req;
  }

  onConnect(conn: Party.Connection) {
    // Send the current roster (minus the joiner themselves — they don't
    // need to see their own row) so they see existing peers immediately.
    this.pruneStale();
    const roster = [...this.peers.values()];
    conn.send(JSON.stringify({ type: "roster", peers: roster }));
  }

  onMessage(message: string, sender: Party.Connection) {
    let msg: any;
    try { msg = JSON.parse(message); } catch { return; }
    if (msg?.type === "here" && msg?.tabId && msg?.user?.id) {
      const rec: PeerRecord = {
        tabId: String(msg.tabId),
        user: msg.user,
        location: msg.location ?? null,
        lastSeen: Date.now(),
      };
      this.peers.set(rec.tabId, rec);
      // Fanout to everyone except sender.
      this.room.broadcast(JSON.stringify({
        type: "here",
        from: rec.tabId,
        user: rec.user,
        location: rec.location,
      }), [sender.id]);
    } else if (msg?.type === "leave" && msg?.tabId) {
      const tabId = String(msg.tabId);
      this.peers.delete(tabId);
      this.room.broadcast(JSON.stringify({ type: "leave", from: tabId }), [sender.id]);
    }
  }

  onClose(conn: Party.Connection) {
    // We don't have a perfect mapping from connection.id to tabId, but
    // any orphaned peer entry will time out via STALE_MS pruning on the
    // next message. (Clients send an explicit `leave` on unmount when
    // possible.)
    this.pruneStale();
  }

  private pruneStale() {
    const now = Date.now();
    let changed = false;
    for (const [k, p] of this.peers) {
      if (now - p.lastSeen > STALE_MS) { this.peers.delete(k); changed = true; }
    }
    if (changed) {
      // Tell everyone the new roster so stale entries disappear from
      // their UIs without waiting for the next own-broadcast cycle.
      this.room.broadcast(JSON.stringify({ type: "roster", peers: [...this.peers.values()] }));
    }
  }
}
