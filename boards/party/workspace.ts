// Workspace presence room (PartyServer; PartyKit until October 2026).
//
// One Durable Object per workspace (room id = workspace id). Tracks
// who is currently online and where they are (board id + surface),
// so the topbar avatars + click-to-jump work. Pure broadcast — no
// Y.Doc here, just message fanout + presence tracking.
//
// The room HIBERNATES. A Durable Object is billed for every second it sits in
// memory unable to hibernate, and with plain sockets that was every second any
// tab had its workspace open: presence alone was a third of the party's room
// time the day the account outgrew Cloudflare's free tier (2026-10-18). So no
// roster lives in this object's memory. Each tab's presence rides on its own
// socket (conn.setState, which partyserver writes to the socket's hibernation
// attachment); the runtime can evict the room between heartbeats, and whatever
// wakes it reads the roster back from getConnections(). The rules are pure, in
// lib/workspaceRoster.js.
//
// Wire protocol (JSON over WebSocket):
//   {type:'here', user, location, tabId}        ← client → server (heartbeat)
//   {type:'here', from, user, location}          ← server → other clients
//   {type:'leave', tabId}                        ← client → server (on close)
//   {type:'leave', from}                         ← server → other clients
//   {type:'roster', peers: [...]}                ← server → newly-joined client
//
// Auth: ?access_token=<supabase JWT>; verified against workspace membership.

import { Server, type Connection, type ConnectionContext } from "partyserver";
import type { Env } from "./env";
import { workspaceAccessAmong } from "./auth";
import { heldElsewhere, isFresh, rosterFrom, shouldAnnounce } from "../src/lib/workspaceRoster.js";
import { answerEmptyClose } from "../src/lib/partyClose.js";

// What one socket carries (see lib/workspaceRoster.js).
interface Presence {
  sid: string;
  userId?: string;
  tabId?: string;
  user?: { id: string; name?: string; color?: string; email?: string };
  location?: { boardId?: string; boardName?: string; surface?: string; pageId?: string | null; docCardId?: string | null; isActive?: boolean; scrollTop?: number } | null;
  lastSeen?: number;
}

// How often a room with anyone present checks for stale tabs. A laptop that
// slept or dropped off the network without a clean close (no FIN) leaves its
// socket open but silent; without a sweep it stayed in everyone's topbar for as
// long as nobody else came or went (COMMS-21). The alarm runs every PRUNE_MS
// while anyone is present and lapses once nobody is. Clients need nothing new:
// a stale tab leaves as the `leave` delta they already handle.
const PRUNE_MS = 20_000;
const ACCESS_CHECK_MS = 60_000;

export class WorkspaceParty extends Server<Env> {
  static options = { hibernate: true };

  private presenceOf(conn: Connection): Presence {
    return (conn.state as Presence | null) ?? { sid: "" };
  }

  private presences(): Presence[] {
    return [...this.getConnections()].map((c) => this.presenceOf(c));
  }

  // Auth is index.ts beforeConnect: the token must belong to a member of this
  // workspace, and x-user-id carries the JWT subject so a `here` claiming to be
  // someone else is refused.
  onConnect(conn: Connection, ctx: ConnectionContext) {
    conn.setState({ sid: crypto.randomUUID(), userId: ctx.request.headers.get("x-user-id") || undefined });
    // Everyone present, so the joiner sees existing peers immediately.
    conn.send(JSON.stringify({ type: "roster", peers: rosterFrom(this.presences(), Date.now()) }));
  }

  // In memory, so a steady heartbeat costs no storage call while the room is
  // awake; a woken room starts false and its next `here` checks storage again.
  private pruneArmed = false;

  async armPrune() {
    if (this.pruneArmed) return;
    this.pruneArmed = true;
    try {
      if ((await this.ctx.storage.getAlarm()) == null) {
        await this.ctx.storage.setAlarm(Date.now() + PRUNE_MS);
      }
    } catch (e) {
      this.pruneArmed = false;
      console.warn(`[workspace ${this.name}] could not arm the stale sweep`, e);
    }
  }

  // When the room last asked who may still be in it (in memory: a woken room
  // asks again on its first sweep).
  private accessCheckedAt = 0;

  async onAlarm() {
    this.pruneArmed = false;
    const now = Date.now();
    let conns = [...this.getConnections()];
    // A removed member or a suspended account leaves within a minute: the same
    // question as the door (party_workspace_access), at most once a minute.
    if (conns.length && now - this.accessCheckedAt >= ACCESS_CHECK_MS) {
      this.accessCheckedAt = now;
      const ids = conns.map((c) => this.presenceOf(c).userId || "");
      const access = await workspaceAccessAmong(this.env.SUPABASE_SERVICE_ROLE_KEY, this.name, ids);
      conns = conns.filter((c) => {
        const uid = this.presenceOf(c).userId;
        if (uid && access.get(uid) === false) {
          try { c.close(4401, "access changed"); } catch (_) { /* already gone */ }
          return false;
        }
        return true;
      });
    }
    const all = conns.map((c) => this.presenceOf(c));
    let anyonePresent = false;
    conns.forEach((conn, i) => {
      const p = all[i];
      if (!p.tabId) return;
      if (isFresh(p, now)) { anyonePresent = true; return; }
      // Stale: out of every roster from now on, and gone from everyone's
      // topbar unless the tab is still here through another socket.
      const cleared: Presence = { sid: p.sid, userId: p.userId };
      conn.setState(cleared);
      all[i] = cleared;
      if (!heldElsewhere(all, p.tabId, p.sid, now)) {
        this.broadcast(JSON.stringify({ type: "leave", from: p.tabId }));
      }
    });
    if (anyonePresent) await this.armPrune();   // an empty room lets the alarm lapse
  }

  onMessage(sender: Connection, message: string | ArrayBuffer | ArrayBufferView) {
    if (typeof message !== "string") return;
    let msg: any;
    try { msg = JSON.parse(message); } catch { return; }
    const mine = this.presenceOf(sender);
    if (msg?.type === "here" && msg?.tabId && msg?.user?.id) {
      if (mine.userId && String(msg.user.id) !== mine.userId) {
        // A member claiming to be another member. Drop it; the socket stays
        // open because the rest of the protocol is fine.
        console.warn(`[workspace ${this.name}] presence identity mismatch`);
        return;
      }
      const next: Presence = {
        sid: mine.sid,
        userId: mine.userId,
        tabId: String(msg.tabId),
        user: msg.user,
        location: msg.location ?? null,
        lastSeen: Date.now(),
      };
      sender.setState(next);
      void this.armPrune();
      if (shouldAnnounce(mine, next)) {
        this.broadcast(JSON.stringify({
          type: "here",
          from: next.tabId,
          user: next.user,
          location: next.location,
        }), [sender.id]);
      }
    } else if (msg?.type === "leave" && msg?.tabId) {
      // A socket withdraws only its own tab's presence.
      const tabId = String(msg.tabId);
      if (mine.tabId !== tabId) return;
      sender.setState({ sid: mine.sid, userId: mine.userId });
      this.broadcast(JSON.stringify({ type: "leave", from: tabId }), [sender.id]);
    }
  }

  // Instant departure: a closed socket's tab leaves, unless a reconnect has
  // already brought it back on another socket. The alarm sweep is the backstop
  // for sockets that die without a close.
  onClose(conn: Connection, code: number) {
    this.depart(conn);
    answerEmptyClose(conn, code);
  }

  onError(conn: Connection) {
    this.depart(conn);
  }

  private depart(conn: Connection) {
    const p = this.presenceOf(conn);
    if (!p.tabId) return;
    if (!heldElsewhere(this.presences(), p.tabId, p.sid, Date.now())) {
      this.broadcast(JSON.stringify({ type: "leave", from: p.tabId }));
    }
  }
}
