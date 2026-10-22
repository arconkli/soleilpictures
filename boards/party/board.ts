// Board room: one Durable Object per board (room name = board id), on our own
// Cloudflare account through PartyServer. PartyKit's hosted platform, where this
// ran until October 2026, stopped taking deploys on the 16th and deletes its
// projects on the 23rd.
//
// y-partyserver's YServer speaks the Yjs sync + awareness protocol the client's
// YProvider expects (lib/yPartyKit.js), and the headless peer /api/v1 uses
// (lib/scoutBoard.js) speaks the same frames.
//
// Auth happens before a socket reaches this object: the Worker's
// onBeforeConnect (index.ts) checks the token against Supabase RLS, refuses
// suspended accounts, and stamps x-user-id / x-can-write onto the upgrade
// request. Viewer connections are read-only here (isReadOnly), so their Yjs
// updates are dropped rather than broadcast; awareness still flows so their
// cursors show.
//
// PERSISTENCE, three layers:
//   1. RoomLog: every update in this object's SQLite as it lands.
//   2. board_state in Postgres, written by lib/boardRoomState.js as a
//      compare-and-set: never over a write this room has not seen.
//   3. The op log (opLog.ts), unchanged.
// A cold start loads (1) and merges (2), always: the room never assumes its own
// copy is newer than the database.
//
// gc stays OFF. y-partyserver builds its document with gc on; a GC'd board_state
// would drop deleted cards' file keys while undo, the trash and version history
// can still bring those cards back, and the R2 sweep would then delete the
// files. Storage counting decodes its own gc:true copy (storage-liveness).
//
// One alarm per object (a Durable Object has one): every minute while anyone
// is connected it closes sockets of accounts suspended since they connected
// (4403) and sockets that have gone silent (SILENT_CLOSE_MS), retries a failed
// flush, and probes board_state for writes made some other way; for 15 minutes
// after the room empties it keeps probing, so a write from a tab still on the
// old host is merged even with nobody here.

import { YServer } from "y-partyserver";
import type { Connection, ConnectionContext } from "partyserver";
import * as Y from "yjs";
import { accessAmong, authBoard, bannedAmong, canWriteBoard } from "./auth";
import { installOpLogCapture } from "./opLog";
import { RoomLog, MAX_PENDING_UPDATES } from "./roomLog";
import { DEFAULT_SUPABASE_URL, type Env } from "./env";
import { FLUSH_DEBOUNCE_MS, FLUSH_MAX_WAIT_MS, bytesToB64 } from "../src/lib/boardStateSync.js";
import { BoardRoomState, MERGE_ORIGIN } from "../src/lib/boardRoomState.js";
import { answerEmptyClose } from "../src/lib/partyClose.js";
import { BoardBridge } from "./bridge";

const ALARM_MS = 60_000;
const IDLE_WATCH_MS = 15 * 60_000;
// After a reset, writes from elsewhere are stale echoes of the board before it
// (see boardRoomState.js): overwrite them instead of merging, for this long.
const RESET_FENCE_MS = 30_000;
const FENCE_KEY = "resetFenceUntil";
const ACTIVE_KEY = "lastActiveAt";
// Close code the client treats as "this room was reset; reload from board_state".
const RESET_CLOSE = 4030;
// A socket that has said nothing for this long is dead or frozen: a live tab
// sends its keepalive every 15 s (lib/yPartyKit.js), and a hidden one, however
// hard the browser throttles its timers, at least once a minute until it parks
// (lib/partyPark.js). This room is billed for every second a socket is open, so
// a frozen tab's socket held it for hours (2026-10-18: one sent 6 frames in
// 1.8 h). Closing costs a live client one ordinary reconnect: YProvider
// reconnects on any close, and SILENT_CLOSE means nothing more to it.
const SILENT_CLOSE_MS = 5 * 60_000;
const SILENT_CLOSE = 4000;

type ConnState = { userId?: string; canWrite?: boolean } | null;
const stateOf = (c: Connection) => (c.state as ConnState) || {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class BoardParty extends YServer<Env> {
  static options = { hibernate: false };
  static callbackOptions = {
    debounceWait: FLUSH_DEBOUNCE_MS,
    debounceMaxWait: FLUSH_MAX_WAIT_MS,
    timeout: 5_000,
  };

  private local!: RoomLog;
  private remote!: BoardRoomState;
  // Shared docs' mirrors of this board's doc cards (party/bridge.ts, doc.ts).
  private bridge: BoardBridge | null = null;
  private resetting = false;
  private opLogWired = false;
  private localHeldContent = false;
  // When each socket last sent anything. Keyed by the connection OBJECT:
  // connection.id is stable across a tab's reconnects.
  private lastHeard = new WeakMap<Connection, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Before anything is applied to it — see the header.
    this.document.gc = false;
  }

  private get supabaseUrl() { return this.env.SUPABASE_URL || DEFAULT_SUPABASE_URL; }

  async onStart() {
    this.local = new RoomLog(this.ctx.storage as any);
    const fenceUntil = Number(await this.ctx.storage.get(FENCE_KEY)) || 0;
    this.remote = new BoardRoomState({
      boardId: this.name,
      supabaseUrl: this.supabaseUrl,
      serviceRoleKey: this.env.SUPABASE_SERVICE_ROLE_KEY,
      getDoc: () => this.document,
      fenceUntil,
      onRestore: () => { void this.resetRoom("restore marker"); },
    });

    // onLoad runs inside this; YServer then wires the broadcast and the
    // debounced onSave to the document.
    await super.onStart();

    this.document.on("update", (update: Uint8Array) => {
      if (this.resetting) return;
      try {
        if (!this.local.append(update) || this.local.pending > MAX_PENDING_UPDATES) this.compactLocal();
      } catch (e) {
        console.error(`[board ${this.name}] local log append failed`, e);
      }
    });
    this.compactLocal();
    // A shared doc's mirror hears about every transaction that touches its doc;
    // with no mirror subscribed this returns at its first line.
    this.bridge = new BoardBridge({
      name: this.name, env: this.env, document: this.document, ctx: this.ctx as any,
      resetting: () => this.resetting,
    });
    await this.bridge.load();
    this.document.on("afterTransaction", (tr: Y.Transaction) => this.bridge?.onTransaction(tr));
    // And every presence change, for the doc's readers (inert with no mirror).
    this.document.awareness.on("update", (changes: { added: number[]; updated: number[]; removed: number[] }) =>
      this.bridge?.onAwareness(changes));
    // The local copy held something: make sure the database gets it now
    // rather than at the next edit. The write is a compare-and-set, so this can
    // only add to what is stored.
    if (this.localHeldContent) void this.remote.flush({ force: true });
  }

  async onLoad() {
    const doc = new Y.Doc({ gc: false });
    let applied = 0;
    for (const update of this.local.load()) {
      try {
        Y.applyUpdate(doc, update, MERGE_ORIGIN);
        applied++;
      } catch (e) {
        console.error(`[board ${this.name}] a locally stored update did not apply`, e);
      }
    }
    this.localHeldContent = applied > 0;
    const loaded = await this.remote.loadInto(doc);
    // Nothing local: the doc IS the row, so the first flush has nothing to say
    // until someone edits.
    if (loaded && !this.localHeldContent) this.remote.noteStored(bytesToB64(Y.encodeStateAsUpdate(doc)));
    return doc;
  }

  async onSave() {
    if (this.resetting) return;
    await this.remote.flush();
    if (this.local.pending > 0) this.compactLocal();
  }

  private compactLocal() {
    if (this.resetting) return;
    try {
      this.local.compact(Y.encodeStateAsUpdate(this.document));
    } catch (e) {
      console.error(`[board ${this.name}] local compaction failed`, e);
    }
  }

  isReadOnly(connection: Connection) {
    return stateOf(connection).canWrite !== true;
  }

  async onConnect(conn: Connection, ctx: ConnectionContext) {
    if (this.resetting) {
      try { conn.close(RESET_CLOSE, "room reset"); } catch (_) { /* already gone */ }
      return;
    }
    this.lastHeard.set(conn, Date.now());
    const h = ctx.request.headers;
    conn.setState((prev: unknown) => ({
      ...((prev as object) || {}),
      userId: h.get("x-user-id") || "",
      canWrite: h.get("x-can-write") === "1",
    }));
    super.onConnect(conn, ctx);

    // The op log (and the mass-delete detector it feeds) is wired once per
    // object, on the first connection, which is where the workspace id comes
    // from.
    if (!this.opLogWired) {
      this.opLogWired = true;
      try {
        installOpLogCapture({
          boardId: this.name,
          workspaceId: h.get("x-workspace-id") || undefined,
          yDoc: this.document,
          supabaseUrl: this.supabaseUrl,
          serviceRoleKey: this.env.SUPABASE_SERVICE_ROLE_KEY,
        });
      } catch (e) {
        console.warn(`[board ${this.name}] opLog install failed`, e);
      }
    }
    await this.armAlarm();
  }

  onMessage(conn: Connection, message: string | ArrayBuffer | ArrayBufferView) {
    this.lastHeard.set(conn, Date.now());
    super.onMessage(conn, message);
  }

  // A close with no status code gets its answer (lib/partyClose.js).
  onClose(conn: Connection, code: number, reason: string, wasClean: boolean) {
    try { super.onClose(conn, code, reason, wasClean); } finally { answerEmptyClose(conn, code); }
  }

  private async armAlarm() {
    try {
      await this.ctx.storage.put(ACTIVE_KEY, Date.now());
      if ((await this.ctx.storage.getAlarm()) == null) {
        await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
      }
    } catch (e) {
      console.warn(`[board ${this.name}] could not arm the alarm`, e);
    }
  }

  async onAlarm() {
    if (this.resetting) return;
    const conns = [...this.getConnections()];
    let keepGoing = conns.length > 0;
    if (conns.length) {
      try { await this.ctx.storage.put(ACTIVE_KEY, Date.now()); } catch (_) { /* best effort */ }
      // Audit AC-2: an account banned mid-session stops editing within a minute.
      // And so does anyone who has lost access since they connected (removed,
      // unshared, or made a viewer): no read closes the socket, and a lost write
      // closes it too, so the client reconnects as read-only.
      const ids = conns.map((c) => stateOf(c).userId || "");
      const [banned, access] = await Promise.all([
        bannedAmong(this.env.SUPABASE_SERVICE_ROLE_KEY, ids),
        accessAmong(this.env.SUPABASE_SERVICE_ROLE_KEY, this.name, ids),
      ]);
      const now = Date.now();
      for (const c of conns) {
        const uid = stateOf(c).userId;
        if (uid && banned.has(uid)) {
          try { c.close(4403, "account suspended"); } catch (_) { /* already gone */ }
          continue;
        }
        const may = uid ? access.get(uid) : undefined;
        if (may && (!may.canRead || (stateOf(c).canWrite === true && !may.canWrite))) {
          try { c.close(4401, "access changed"); } catch (_) { /* already gone */ }
          continue;
        }
        const heard = this.lastHeard.get(c);
        if (heard == null) { this.lastHeard.set(c, now); continue; }
        if (now - heard > SILENT_CLOSE_MS) {
          try { c.close(SILENT_CLOSE, "silent"); } catch (_) { /* already gone */ }
        }
      }
    } else {
      const lastActive = Number(await this.ctx.storage.get(ACTIVE_KEY)) || 0;
      keepGoing = Date.now() - lastActive < IDLE_WATCH_MS;
    }
    await this.remote.retryIfDirty();
    await this.remote.checkForeign();
    if (this.local.pending > 0) this.compactLocal();
    if (keepGoing && !this.resetting) {
      try { await this.ctx.storage.setAlarm(Date.now() + ALARM_MS); } catch (_) { /* next connect re-arms */ }
    }
  }

  // Throw this board's room away and make every client reload it from
  // board_state. Used by POST /reset (a restore, a cross-board move into a board
  // that was not open, a workspace rewind) and by the restore marker.
  //
  // The order matters, and is PartyKit's: the reset frame first, so clients
  // remount from board_state BEFORE their socket drops (closing first would have
  // them reconnect and push their stale doc straight back into the room); then
  // wipe; then close. The frame stays a RAW JSON text frame: the client's
  // listener (lib/yPartyKit.js) parses exactly that, and YServer's
  // custom-message helpers would prefix it with __YPS:, which it ignores.
  private async resetRoom(reason: string): Promise<number> {
    if (this.resetting) return 0;
    this.resetting = true;
    this.remote?.stop();
    try {
      this.broadcast(JSON.stringify({ type: "soleil-board-reset", boardId: this.name, ts: Date.now() }));
    } catch (e) {
      console.error(`[board ${this.name}] reset broadcast failed`, e);
    }
    // Shared docs' rooms start over from the restored board (a new generation).
    try { await this.bridge?.closeAll(4012, "reset"); } catch (_) { /* they rebuild on their own */ }
    await sleep(150);
    try { this.local.wipe(); } catch (_) { /* deleteAll below */ }
    try { await this.ctx.storage.deleteAll(); } catch (e) { console.error(`[board ${this.name}] deleteAll failed`, e); }
    try { await this.ctx.storage.deleteAlarm(); } catch (_) { /* none set */ }
    try { await this.ctx.storage.put(FENCE_KEY, Date.now() + RESET_FENCE_MS); } catch (_) { /* fence is best effort */ }
    let kicked = 0;
    for (const conn of this.getConnections()) {
      try { conn.close(RESET_CLOSE, "room reset"); kicked++; } catch (_) { /* already gone */ }
    }
    try { await this.ctx.storage.sync(); } catch (_) { /* nothing pending */ }
    // This object's document still holds the board as it was. Drop the whole
    // instance, so the next connection starts from board_state alone.
    console.log(`[board ${this.name}] reset (${reason}); kicked ${kicked}`);
    setTimeout(() => this.ctx.abort(`board reset: ${reason}`), 100);
    return kicked;
  }

  // POST /parties/main/<boardId>/reset — Bearer token, can_write_board.
  // The client writes the restored bytes to board_state first and then calls
  // this (through the same-origin Worker proxy, src/worker.js); see
  // bulletproofRestore in lib/boardsApi.js.
  async onRequest(req: Request): Promise<Response> {
    const origin = req.headers.get("origin") || "*";
    const corsHeaders: Record<string, string> = {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": "86400",
      "vary": "Origin",
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    const url = new URL(req.url);
    // A shared doc's room, through its Durable Object stub (never from outside:
    // the Worker's beforeRequest lets only /reset through).
    if (url.pathname.includes("/bridge/") && this.bridge) {
      const res = await this.bridge.handle(req);
      if (res) return res;
    }
    if (!url.pathname.endsWith("/reset")) return new Response("Not found", { status: 404, headers: corsHeaders });

    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token) return new Response("Missing token", { status: 401, headers: corsHeaders });
    const [a, canWrite] = await Promise.all([authBoard(token, this.name), canWriteBoard(token, this.name)]);
    if (!a.ok) return new Response(a.reason || "Unauthorized", { status: 401, headers: corsHeaders });
    if (!canWrite) return new Response("Read-only", { status: 403, headers: corsHeaders });

    const kicked = await this.resetRoom("reset requested");
    return new Response(JSON.stringify({ ok: true, kicked, signaled: true }), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
}
