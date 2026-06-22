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
  location?: { boardId?: string; boardName?: string; surface?: string; pageId?: string | null; docCardId?: string | null; isActive?: boolean; scrollTop?: number };
  lastSeen: number;
  // Epoch of the connection that currently owns this tab (see connInfo). A
  // stale onClose only fires `leave` when its epoch still matches this.
  ownerEpoch?: number;
}

const STALE_MS = 60_000;     // peers go stale after 60s with no heartbeat (backstop only)

// True when nothing a consumer renders has changed between two records — used to
// suppress steady-state heartbeat fanout. Mirrors useWorkspacePresence.peerKey:
// only the fields consumers actually differentiate on (identity + the rendered
// location bits), NOT scrollTop.
function sameUserLoc(a: PeerRecord, b: PeerRecord): boolean {
  const au = a.user || ({} as any), bu = b.user || ({} as any);
  if (au.id !== bu.id || au.name !== bu.name || au.color !== bu.color) return false;
  const al = a.location || ({} as any), bl = b.location || ({} as any);
  return al.boardId === bl.boardId
      && al.surface === bl.surface
      && al.pageId === bl.pageId
      && al.docCardId === bl.docCardId
      && al.isActive === bl.isActive;
}

export default class WorkspaceParty implements Party.Server {
  // tabId → record. Lives in DO memory; on restart the room re-populates
  // as peers reconnect and re-broadcast their location.
  private peers: Map<string, PeerRecord> = new Map();
  // Per-connection state, keyed by the Party.Connection OBJECT (a WeakMap, so it
  // GCs with the socket). A reconnect REUSES connection.id but is a distinct
  // connection object with a fresh, higher epoch — that epoch is how onClose
  // tells a dead old socket from the live new one (connection.id can't: it's
  // stable across reconnects). tabId lets onClose fire a precise INSTANT leave
  // instead of waiting out STALE_MS.
  private connInfo: WeakMap<Party.Connection, { tabId?: string; epoch: number }> = new WeakMap();
  private epoch = 0;

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
    // Stamp a fresh epoch for this connection object up front, so even a
    // reconnect that reuses connection.id is distinguishable from its dead
    // predecessor.
    this.connInfo.set(conn, { epoch: ++this.epoch });
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
      const tabId = String(msg.tabId);
      const prev = this.peers.get(tabId);
      // Stamp this connection as the tab's current owner (fresh epoch per
      // connection object) so a later stale onClose from a reconnected socket
      // can't delete the live peer.
      const info = this.connInfo.get(sender) ?? { epoch: ++this.epoch };
      info.tabId = tabId;
      this.connInfo.set(sender, info);
      const rec: PeerRecord = {
        tabId,
        user: msg.user,
        location: msg.location ?? null,
        lastSeen: Date.now(),
        ownerEpoch: info.epoch,
      };
      this.peers.set(tabId, rec);
      // Only fan out when something a consumer renders actually changed: a new
      // peer, an identity change, or a navigation. A steady-state heartbeat
      // with an unchanged location is suppressed — idle fanout drops to ~zero,
      // which is the difference between O(N) and O(N^2) chatter as a workspace
      // fills up.
      if (!prev || !sameUserLoc(prev, rec)) {
        this.room.broadcast(JSON.stringify({
          type: "here",
          from: tabId,
          user: rec.user,
          location: rec.location,
        }), [sender.id]);
      }
    } else if (msg?.type === "leave" && msg?.tabId) {
      const tabId = String(msg.tabId);
      this.peers.delete(tabId);
      const info = this.connInfo.get(sender);
      if (info) info.tabId = undefined;  // an explicit leave clears ownership
      this.room.broadcast(JSON.stringify({ type: "leave", from: tabId }), [sender.id]);
    }
  }

  onClose(conn: Party.Connection) {
    // Precise instant departure — but ONLY if this closing connection is still
    // the tab's live owner. A reconnect reuses connection.id and is a distinct
    // connection object with a higher epoch; once it re-sends `here`, the peer's
    // ownerEpoch advances past this (dead) socket's epoch, so we suppress the
    // phantom `leave` that would otherwise flicker the live peer out of other
    // viewers' rosters. STALE_MS pruning below stays as the backstop.
    const info = this.connInfo.get(conn);
    this.connInfo.delete(conn);
    const tabId = info?.tabId;
    if (tabId) {
      const rec = this.peers.get(tabId);
      if (rec && rec.ownerEpoch === info!.epoch) {
        this.peers.delete(tabId);
        this.room.broadcast(JSON.stringify({ type: "leave", from: tabId }));
      }
    }
    this.pruneStale();
  }

  private pruneStale() {
    const now = Date.now();
    const removed: string[] = [];
    for (const [k, p] of this.peers) {
      if (now - p.lastSeen > STALE_MS) { this.peers.delete(k); removed.push(k); }
    }
    // Emit a `leave` DELTA per stale tab instead of rebroadcasting the entire
    // roster to everyone (the old O(N) cost on every prune). Clients already
    // handle `leave` by dropping that tab.
    for (const tabId of removed) {
      this.room.broadcast(JSON.stringify({ type: "leave", from: tabId }));
    }
  }
}
