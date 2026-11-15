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
//   {type:'pings'}                               ← server → client, on connect
//   {type:'stale'}                               ← server → a client the sweep found stale (it answers with 'here')
//   'ping' (text)                                ← client → server, answered 'pong'
//                                                  by the edge without waking the
//                                                  room; counts as the tab still
//                                                  being here
// A client sends the text ping (and `here` only on a change) once it has heard
// {type:'pings'}; an older client keeps sending `here` every heartbeat.
//
// Auth: ?access_token=<supabase JWT>; verified against workspace membership.

import { Server, type Connection, type ConnectionContext } from "partyserver";
import type { Env } from "./env";
import { workspaceAccessAmong } from "./auth";
import { bindReports, reportParty } from "./report";
import { heardBy, heldElsewhere, isFresh, rosterFrom, shouldAnnounce } from "../src/lib/workspaceRoster.js";
import { PING, PONG, WORKSPACE_PINGS_HELLO } from "../src/lib/partyPing.js";
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
// a stale tab leaves as the `leave` delta they already handle. With tabs pinging
// at the edge, the sweep is what wakes a quiet room; each wake is brief, so it
// keeps its pace: a stale tab leaves others' topbars within about a minute and
// twenty seconds.
const PRUNE_MS = 20_000;
const ACCESS_CHECK_MS = 60_000;
const ACCESS_CHECKED_KEY = "accessCheckedAt";

export class WorkspaceParty extends Server<Env> {
  static options = { hibernate: true };

  // The edge answers PING (set in the constructor); the hello goes out only then.
  private pingsAnswered = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    bindReports(env);
    // The tab's keepalive is answered by the edge, so it never wakes the room.
    try {
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
      this.pingsAnswered = true;
    } catch (e) {
      console.warn(`[workspace ${this.name}] could not set the ping auto-response`, e);
    }
  }

  private presenceOf(conn: Connection): Presence {
    return (conn.state as Presence | null) ?? { sid: "" };
  }

  // When the edge last answered this socket's ping, in ms (null if never).
  private autoResponseAt(conn: Connection): number | null {
    try {
      const at = this.ctx.getWebSocketAutoResponseTimestamp(conn as unknown as WebSocket);
      return at ? at.getTime() : null;
    } catch (_) {
      return null;
    }
  }

  // A socket's presence as of now: an answered ping counts as the tab still
  // being here. Only for reading; what the socket stores stays its own.
  private heard(conn: Connection): Presence {
    return heardBy(this.presenceOf(conn), this.autoResponseAt(conn));
  }

  private presences(): Presence[] {
    return [...this.getConnections()].map((c) => this.heard(c));
  }

  // Auth is index.ts beforeConnect: the token must belong to a member of this
  // workspace, and x-user-id carries the JWT subject so a `here` claiming to be
  // someone else is refused.
  onConnect(conn: Connection, ctx: ConnectionContext) {
    conn.setState({ sid: crypto.randomUUID(), userId: ctx.request.headers.get("x-user-id") || undefined });
    // Everyone present, so the joiner sees existing peers immediately.
    conn.send(JSON.stringify({ type: "roster", peers: rosterFrom(this.presences(), Date.now()) }));
    // The tab switches to pings only after this, so either side can be released first.
    // Only when the edge will answer: a tab that switched to PING with no answer
    // would see no PONG and reconnect every half minute.
    if (this.pingsAnswered) conn.send(WORKSPACE_PINGS_HELLO);
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
      void reportParty({ kind: "room", what: "workspace sweep alarm", error: e }, this.ctx);
    }
  }

  // When the room last asked who may still be in it. Kept in storage too, so a
  // woken room checks at most once a minute, not on every wake.
  private accessCheckedAt = 0;

  async onAlarm() {
    this.pruneArmed = false;
    const now = Date.now();
    let conns = [...this.getConnections()];
    // A removed member or a suspended account leaves within a minute: the same
    // question as the door (party_workspace_access), at most once a minute.
    if (conns.length && this.accessCheckedAt === 0) {
      try {
        this.accessCheckedAt = Number(await this.ctx.storage.get(ACCESS_CHECKED_KEY)) || 0;
      } catch (_) { /* unreadable: check now */ }
    }
    if (conns.length && now - this.accessCheckedAt >= ACCESS_CHECK_MS) {
      this.accessCheckedAt = now;
      void this.ctx.storage.put(ACCESS_CHECKED_KEY, now).catch(() => {});
      const ids = conns.map((c) => this.presenceOf(c).userId || "");
      const access = await workspaceAccessAmong(this.env.SUPABASE_SERVICE_ROLE_KEY, this.name, ids);
      conns = conns.filter((c) => {
        const uid = this.presenceOf(c).userId;
        if (uid && access.get(uid) === false) {
          try { c.close(4401, "access ended"); } catch (_) { /* already gone */ }
          return false;
        }
        return true;
      });
    }
    const all = conns.map((c) => this.heard(c));
    let anyonePresent = false;
    conns.forEach((conn, i) => {
      const p = all[i];
      if (!p.tabId) return;
      if (isFresh(p, now)) { anyonePresent = true; return; }
      // Stale: out of every roster from now on, and gone from everyone's
      // topbar unless the tab is still here through another socket.
      const cleared: Presence = { sid: p.sid, userId: p.userId };  // the socket's own state, not the heard-by view
      conn.setState(cleared);
      all[i] = cleared;
      if (!heldElsewhere(all, p.tabId, p.sid, now)) {
        this.broadcast(JSON.stringify({ type: "leave", from: p.tabId }));
      }
      // A live tab whose pings were late (a hidden tab's throttled timers, a network blip) now says 'here'
      // only on a change, so it would stay out of every topbar; told it was swept, it answers with a fresh
      // 'here' (lib/workspacePartyKit.js). A dead one never reads this.
      try { conn.send(JSON.stringify({ type: "stale" })); } catch (_) { /* already gone */ }
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
