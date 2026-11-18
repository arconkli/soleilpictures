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
// gc runs through lib/roomGc.js. Plain gc on would drop deleted cards' file
// keys from board_state while undo, the trash and version history can still
// bring those cards back, and the R2 sweep would then delete the files; gc off
// kept every deleted value instead, every keystroke's copy of a note's html
// among them, until one board's state took the database down (2026-10-26). The
// filter keeps types, everything under a deleted one and anything naming a
// file, and lets the rest go. Storage counting decodes its own gc:true copy
// (storage-liveness).
//
// HIBERNATION. The room sleeps between events: Cloudflare evicts it after a
// quiet spell and wakes it for the next message, close or alarm, and it is not
// billed while asleep. A tab's keepalive is a text ping the edge answers
// (lib/partyPing.js) without waking it. What survives a nap, and where:
//   * the document: RoomLog (this object's SQLite);
//   * the save baseline (what the room last saw of board_state), the together
//     state and when the periodic checks last ran: this object's storage;
//   * each socket's account, workspace, when it was last heard and its own
//     presence: the socket's attachment (connection.state).
// Anything else held in memory is gone on a wake, so nothing here may depend on
// a timer or a field that was not put back in onStart.
//
// One alarm per object (a Durable Object has one). While anyone is connected it
// comes every minute when people are working and every few minutes when nothing
// has happened (lib/roomWake.js: nextAlarmIn); an edit or a cursor move that
// finds the checks due runs them at once. The checks close sockets of accounts
// suspended since they connected (4403) and sockets that have gone silent
// (SILENT_CLOSE_MS), retry a failed flush, and probe board_state for writes made
// some other way. An empty room with its saves done keeps no alarm: a write made
// while nobody is here is merged by the next cold start's load, or by the probe
// a connect triggers.

import { YServer } from "y-partyserver";
import type { Connection, ConnectionContext } from "partyserver";
import * as Y from "yjs";
import { accessAmong, authBoard, bannedAmong, canWriteBoard } from "./auth";
import { installOpLogCapture } from "./opLog";
import { RoomLog, MAX_PENDING_UPDATES } from "./roomLog";
import { DEFAULT_SUPABASE_URL, type Env } from "./env";
import { FLUSH_DEBOUNCE_MS, FLUSH_MAX_WAIT_MS, bytesToB64 } from "../src/lib/boardStateSync.js";
import { BoardRoomState, MERGE_ORIGIN } from "../src/lib/boardRoomState.js";
import { roomGcFilter } from "../src/lib/roomGc.js";
import { answerEmptyClose } from "../src/lib/partyClose.js";
import { PING, PONG, PINGS_HELLO, WAKE } from "../src/lib/partyPing.js";
import {
  ACTIVE_ALARM_MS, ACTIVITY_SAVE_EVERY_MS, HEARD_SAVE_EVERY_MS, PRESENCE_KEY,
  checkDue, isSilent, keptPresence, lastHeardAt, nextAlarmIn, restorePresence, sameEntries,
} from "../src/lib/roomWake.js";
import { ROOM_ANSWERS, answerAck } from "../src/lib/roomAck.js";
import { BoardBridge, isDocRoomOrigin } from "./bridge";
import { bindReports, reportParty } from "./report";
import { TogetherWatch } from "./together";

// After a reset, writes from elsewhere are stale echoes of the board before it
// (see boardRoomState.js): overwrite them instead of merging, for this long.
const RESET_FENCE_MS = 30_000;
const FENCE_KEY = "resetFenceUntil";
// The last activity (an edit or a presence move from a socket), for the alarm's pace.
const ACTIVE_KEY = "lastActiveAt";
// A local-log append or compaction failed and none has caught up since: kept so a nap does not forget it.
const UNLOGGED_KEY = "unlogged";
const BASELINE_KEY = "saveBaseline";
const TOGETHER_KEY = "together";
const CHECKED_KEY = "lastCheckAt";
// Close code the client treats as "this room was reset; reload from board_state".
const RESET_CLOSE = 4030;
// A socket that has said nothing for this long is dead or frozen: a live tab
// sends its keepalive every 15 s (lib/yPartyKit.js), and a hidden one, however
// hard the browser throttles its timers, at least once a minute until it parks
// (lib/partyPark.js). The edge answers a PING without waking the room, and the
// room counts that answer as hearing the socket (getWebSocketAutoResponseTimestamp).
// A frozen tab's socket held a room open for hours (2026-10-18: one sent 6
// frames in 1.8 h). Closing costs a live client one ordinary reconnect:
// YProvider reconnects on any close, and SILENT_CLOSE means nothing more to it.
// The limit is SILENT_CLOSE_MS in lib/roomWake.js (isSilent).
const SILENT_CLOSE = 4000;

// The socket's attachment: it survives hibernation. PRESENCE_KEY holds the
// socket's own presence (lib/roomWake.js); __ypsAwarenessIds is y-partyserver's
// record of which awareness ids the socket owns.
type ConnState = {
  userId?: string; canWrite?: boolean; workspaceId?: string; heardAt?: number;
  __ypsAwarenessIds?: unknown; [key: string]: unknown;
} | null;
const stateOf = (c: Connection) => ((c.state as ConnState) || {}) as NonNullable<ConnState>;
// A Yjs origin that is a socket: the sender of an edit or a presence move.
const isSocket = (o: unknown): boolean =>
  !!o && typeof o === "object" && typeof (o as { send?: unknown }).send === "function" && "id" in (o as object);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class BoardParty extends YServer<Env> {
  static options = { hibernate: true };
  static callbackOptions = {
    debounceWait: FLUSH_DEBOUNCE_MS,
    debounceMaxWait: FLUSH_MAX_WAIT_MS,
    timeout: 5_000,
  };

  private local!: RoomLog;
  private remote!: BoardRoomState;
  // Shared docs' mirrors of this board's doc cards (party/bridge.ts, doc.ts).
  private bridge: BoardBridge | null = null;
  // Who is working here together, for the cards it earns (party/together.ts).
  private together: TogetherWatch | null = null;
  private resetting = false;
  // This life of the object began with sockets already open (a nap, not a cold
  // start): the document is what the room held and the baseline came back.
  private woke = false;
  private lastCheckAt = 0;
  private lastActivityAt = 0;
  private activitySavedAt = 0;
  private checking: Promise<void> | null = null;
  private opLogWired = false;
  private localHeldContent = false;
  // The local copy failed to take an update, and no compaction has caught up
  // since: until one does, this room can't say a change is stored (onCustomMessage).
  private unlogged = false;
  // The edge answers PING (set in the constructor); the hello goes out only then.
  private pingsAnswered = false;
  // When each socket last sent anything. Keyed by the connection OBJECT:
  // connection.id is stable across a tab's reconnects.
  private lastHeard = new WeakMap<Connection, number>();
  // Sockets whose close is being handled right now. By then the runtime may no
  // longer list them and getConnections() never does, yet a close is often what
  // wakes a napping room.
  private closing = new Set<WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    bindReports(env);
    // The edge answers a tab's keepalive without waking this room.
    try {
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
      this.pingsAnswered = true;
    } catch (e) {
      console.warn("[board] could not set the keepalive auto-response", e);
    }
    // Before anything is applied to it — see the header.
    this.document.gc = true;
    this.document.gcFilter = roomGcFilter;
  }

  private get supabaseUrl() { return this.env.SUPABASE_URL || DEFAULT_SUPABASE_URL; }

  // A failure in this room's own machinery, recorded (report.ts) by what
  // failed and the board's id.
  private problem(what: string, error: unknown, kind = "room") {
    void reportParty({ kind, what, error, boardId: this.name }, this.ctx);
  }

  // A write to this object's storage. Not while resetting: the reset wipes it.
  private put(key: string, value: unknown) {
    if (this.resetting) return;
    void this.ctx.storage.put(key, value).catch((e) => this.problem("room storage", e));
  }

  // Every socket the room holds, plus the ones whose close is being handled:
  // getConnections() yields only open sockets, and a close that wakes the room
  // arrives after its socket stopped being open (the runtime may not list it at
  // all, so this.closing carries it). A socket the room closed itself, for
  // silence or access, can stay listed as CLOSING when its client never answers;
  // it is not someone present, so only open sockets and the one closing now
  // count. partyserver keeps {__pk, __user} in the attachment, and __user is
  // what connection.state returns.
  private heldStates(): NonNullable<ConnState>[] {
    const out: NonNullable<ConnState>[] = [];
    const seen = new Set<WebSocket>();
    for (const ws of [...this.ctx.getWebSockets(), ...this.closing]) {
      if (seen.has(ws)) continue;
      seen.add(ws);
      if (ws.readyState !== WebSocket.READY_STATE_OPEN && !this.closing.has(ws)) continue;
      try {
        const a = WebSocket.prototype.deserializeAttachment.call(ws) as { __pk?: unknown; __user?: unknown } | null;
        if (!a || typeof a !== "object" || !a.__pk || typeof a.__pk !== "object") continue;
        out.push(((a.__user as ConnState) || {}) as NonNullable<ConnState>);
      } catch (_) { /* not one of ours */ }
    }
    return out;
  }

  async onStart() {
    this.local = new RoomLog(this.ctx.storage as any);
    const saved = await this.ctx.storage.get([FENCE_KEY, BASELINE_KEY, TOGETHER_KEY, CHECKED_KEY, ACTIVE_KEY, UNLOGGED_KEY]);
    const fenceUntil = Number(saved.get(FENCE_KEY)) || 0;
    const held = this.heldStates();
    this.remote = new BoardRoomState({
      boardId: this.name,
      supabaseUrl: this.supabaseUrl,
      serviceRoleKey: this.env.SUPABASE_SERVICE_ROLE_KEY,
      getDoc: () => this.document,
      fenceUntil,
      // A save that failed has a retry coming, even in a room nobody is in, until
      // retryWanted says an empty room has tried long enough.
      onBaseline: (b: unknown) => { this.put(BASELINE_KEY, b); if ((b as any)?.dirty && this.retryWanted()) void this.armSoon(); },
      onRestore: () => { void this.resetRoom("restore marker"); },
      report: (kind: string, info: Record<string, unknown>) => { void reportParty({ kind, ...info }, this.ctx); },
      // The board was deleted for good (its board_state write hit 23503), so no
      // save can land: close everyone with 4401, which the client stops
      // reconnecting on, as when access ends.
      onGone: () => {
        for (const c of this.getConnections()) {
          try { c.close(4401, "board deleted"); } catch (_) { /* already gone */ }
        }
      },
    });

    // Sockets held at start, closing ones included, mean a wake: the baseline
    // comes back with them, or this is treated as a cold start (onLoad). A failed
    // local append before the nap means the log may lack an update, so that is a
    // cold start too: it loads and merges board_state, and compactLocal then
    // rewrites a complete log and clears the flag.
    if (saved.get(UNLOGGED_KEY)) this.unlogged = true;
    this.woke = held.length > 0 && !this.unlogged && saved.get(BASELINE_KEY) != null
      && this.remote.restoreBaseline(saved.get(BASELINE_KEY));
    // A cold start keeps only the unsaved state, so an empty room's retry window survives it.
    if (!this.woke) this.remote.carryUnsaved(saved.get(BASELINE_KEY));
    this.lastCheckAt = Number(saved.get(CHECKED_KEY)) || 0;
    this.lastActivityAt = Number(saved.get(ACTIVE_KEY)) || 0;
    this.activitySavedAt = this.lastActivityAt;

    // onLoad runs inside this; YServer then wires the broadcast and the
    // debounced onSave to the document, and says hello to every open socket.
    await super.onStart();
    // The room's awareness lives in memory and a nap emptied it. Put each
    // socket's own presence back before anything listens, so a newcomer sees who
    // is here and a close removes the person (YServer's onClose can only remove
    // ids the awareness holds).
    if (held.length) {
      const now = Date.now();
      for (const state of held) {
        try { restorePresence(this.document.awareness, state[PRESENCE_KEY], now); } catch (_) { /* skip this one */ }
      }
    }

    this.document.on("update", (update: Uint8Array) => {
      if (this.resetting) return;
      try {
        if (!this.local.append(update) || this.local.pending > MAX_PENDING_UPDATES) this.compactLocal();
      } catch (e) {
        this.markUnlogged();
        console.error(`[board ${this.name}] local log append failed`, e);
        this.problem("local log append", e);
      }
    });
    if (!this.woke || this.local.pending > 0 || this.unlogged) this.compactLocal();
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
    // Working together: an edit or a presence move marks its sender active. The
    // origin is the sender's socket (y-partyserver passes it to Yjs), whose
    // account the door verified; the room's own writes carry no account.
    this.together = new TogetherWatch({
      boardId: this.name,
      supabaseUrl: this.supabaseUrl,
      serviceKey: this.env.SUPABASE_SERVICE_ROLE_KEY,
      send: (conn, message) => this.sendCustomMessage(conn, message),
      persist: (snapshot) => this.put(TOGETHER_KEY, snapshot),
    });
    this.together.restore(saved.get(TOGETHER_KEY));
    // An edit or a presence move from a socket is also what keeps the alarm at
    // its working pace and runs the checks when they are due (noteActivity). So is
    // an edit from a shared doc's guests, which arrives through the bridge with a
    // doc-room origin and is broadcast to every socket all the same.
    this.document.on("update", (_update: Uint8Array, origin: unknown) => {
      this.together?.onDocUpdate(origin);
      if (isSocket(origin) || isDocRoomOrigin(origin)) this.noteActivity();
    });
    this.document.awareness.on("change",
      (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        this.together?.onAwarenessChange(changes, origin, this.document.awareness.getStates());
        if (isSocket(origin)) this.noteActivity();
      });
    // The local copy held something: make sure the database gets it now
    // rather than at the next edit. The write is a compare-and-set, so this can
    // only add to what is stored. Not forced: loadInto noted the row's bytes, so
    // this writes only when the merged doc differs from the row (the local copy
    // holds something the row lacks). Forced, it wrote the same doc back on every
    // cold start, and an empty cluster's alarm woke it every minute to do it
    // again (the 17 Nov 2026 database restart).
    if (!this.woke && this.localHeldContent) void this.remote.flush();
    for (const state of held) {
      const ws = state.workspaceId;
      if (ws) { this.wireOpLog(ws); break; }
    }
  }

  async onLoad() {
    const doc = new Y.Doc({ gcFilter: roomGcFilter });
    let applied = 0;
    for (const update of this.local.load()) {
      try {
        Y.applyUpdate(doc, update, MERGE_ORIGIN);
        applied++;
      } catch (e) {
        console.error(`[board ${this.name}] a locally stored update did not apply`, e);
        this.problem("local update apply", e, "room_load");
      }
    }
    this.localHeldContent = applied > 0;
    // A nap: the local copy is exactly what the room held, and the save baseline
    // came back from storage, so there is nothing to read or merge.
    if (this.woke && applied > 0) {
      // A room can't nap with a save pending (the save's debounce timer keeps it awake), so a clean baseline
      // means this doc is what board_state holds: the last close's flush then has nothing to write.
      if (!this.remote.dirty) this.remote.noteStored(bytesToB64(Y.encodeStateAsUpdate(doc)));
      return doc;
    }
    // Woke with nothing local to go on: treat it as a cold start.
    this.woke = false;
    const loaded = await this.remote.loadInto(doc);
    // Nothing local: the doc IS the row, so the first flush has nothing to say
    // until someone edits.
    if (loaded && !this.localHeldContent) this.remote.noteStored(bytesToB64(Y.encodeStateAsUpdate(doc)));
    return doc;
  }

  async onSave() {
    if (this.resetting) return;
    await this.remote.flush();
    if (this.local.pending > 0 || this.unlogged) this.compactLocal();
  }

  // A failed append or compaction: remember it across a nap (onStart), once.
  private markUnlogged() {
    if (this.unlogged) return;
    this.unlogged = true;
    this.put(UNLOGGED_KEY, true);
  }

  private compactLocal() {
    if (this.resetting) return;
    try {
      this.local.compact(Y.encodeStateAsUpdate(this.document));
      if (this.unlogged) {
        if (!this.resetting) void this.ctx.storage.delete(UNLOGGED_KEY).catch((e) => this.problem("room storage", e));
        this.unlogged = false;
      }
    } catch (e) {
      this.markUnlogged();
      console.error(`[board ${this.name}] local compaction failed`, e);
      this.problem("local compaction", e);
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
    const now = Date.now();
    this.lastHeard.set(conn, now);
    const h = ctx.request.headers;
    conn.setState((prev: unknown) => ({
      ...((prev as object) || {}),
      userId: h.get("x-user-id") || "",
      canWrite: h.get("x-can-write") === "1",
      workspaceId: h.get("x-workspace-id") || "",
      heardAt: now,
    }));
    super.onConnect(conn, ctx);
    // This room answers a doc's save line (onCustomMessage): said ahead of its
    // sync reply, so a device that syncs without it knows not to wait for one.
    this.sendCustomMessage(conn, ROOM_ANSWERS);
    // The tab switches its keepalive to PING only after hearing this, so either
    // side can be released first.
    // Only when the edge will answer: a tab that switched to PING with no answer
    // would see no PONG and reconnect every half minute.
    if (this.pingsAnswered) this.sendCustomMessage(conn, PINGS_HELLO);

    this.wireOpLog(h.get("x-workspace-id") || undefined);
    this.noteActivity();
    // A room with sockets must always have an alarm.
    await this.armSoon();
  }

  // The op log (and the mass-delete detector it feeds) is wired once per
  // object, on the first connection, which is where the workspace id comes
  // from (after a nap, from a socket's attachment).
  private wireOpLog(workspaceId: string | undefined) {
    if (this.opLogWired) return;
    this.opLogWired = true;
    try {
      installOpLogCapture({
        boardId: this.name,
        workspaceId,
        yDoc: this.document,
        supabaseUrl: this.supabaseUrl,
        serviceRoleKey: this.env.SUPABASE_SERVICE_ROLE_KEY,
      });
    } catch (e) {
      console.warn(`[board ${this.name}] opLog install failed`, e);
      this.problem("op log install", e, "op_log");
    }
  }

  onMessage(conn: Connection, message: string | ArrayBuffer | ArrayBufferView) {
    const now = Date.now();
    this.lastHeard.set(conn, now);
    if (now - (Number(stateOf(conn).heardAt) || 0) >= HEARD_SAVE_EVERY_MS) {
      conn.setState((prev: unknown) => ({ ...((prev as object) || {}), heardAt: now }));
    }
    super.onMessage(conn, message);
    // y-protocols messageAwareness is 1.
    const first = message instanceof ArrayBuffer ? new Uint8Array(message)[0]
      : ArrayBuffer.isView(message) ? new Uint8Array(message.buffer, message.byteOffset, message.byteLength)[0]
      : undefined;
    if (first === 1) this.savePresence(conn);
  }

  // The room's awareness lives in memory; after a nap it is rebuilt from what
  // each socket kept here, so a newcomer sees who is here and a close still
  // tells everyone the person left.
  private savePresence(conn: Connection) {
    try {
      const ids = stateOf(conn).__ypsAwarenessIds || [];
      const entries = keptPresence(ids, this.document.awareness);
      if (!sameEntries(entries, stateOf(conn)[PRESENCE_KEY])) {
        conn.setState((prev: unknown) => ({ ...((prev as object) || {}), [PRESENCE_KEY]: entries }));
      }
    } catch (_) { /* newcomers see this cursor when it next moves */ }
  }

  // A doc's save line asking whether this room has stored its changes
  // (lib/roomAck.js: every update is in the local copy before anything later
  // leaves this object). Nothing else is spoken this way, so anything else
  // gets no answer, as does any question while the answer would prove nothing.
  onCustomMessage(conn: Connection, message: string) {
    if (message === WAKE) return;   // a tab reaching for a napping cluster wakes it ahead of its first change (lib/partyPing.js); nothing to answer
    if (this.resetting || this.unlogged) return;
    const reply = answerAck(this.document, message, { canWrite: !this.isReadOnly(conn) });
    if (reply) this.sendCustomMessage(conn, reply);
  }

  // The Durable Object entry point for a close. Marks the socket as closing for
  // the duration, so a wake caused by this close still finds it (heldStates).
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    this.closing.add(ws);
    try { await super.webSocketClose(ws, code, reason, wasClean); } finally { this.closing.delete(ws); }
  }

  // Same for a socket that ended in an error: it is no longer open either.
  async webSocketError(ws: WebSocket, error: unknown) {
    this.closing.add(ws);
    try { await super.webSocketError(ws, error); } finally { this.closing.delete(ws); }
  }

  // A close with no status code gets its answer (lib/partyClose.js).
  async onClose(conn: Connection, code: number, reason: string, wasClean: boolean) {
    // A close can be what wakes the room; put the closing socket's presence back
    // if the wake missed it, so YServer's onClose removes it for everyone
    // (restorePresence skips ids already held).
    try { restorePresence(this.document.awareness, stateOf(conn)[PRESENCE_KEY], Date.now()); } catch (_) { /* nothing to put back */ }
    try { super.onClose(conn, code, reason, wasClean); } finally { answerEmptyClose(conn, code); }
    if (!this.resetting && ![...this.getConnections()].some((c) => c !== conn)) await this.roomEmptied();
  }

  // The last person left: save now (a no-op when nothing changed) and drop the
  // alarm unless a save failed.
  private async roomEmptied() {
    // The room emptying starts a failed save's retry window (lib/roomWake.js
    // nextAlarmIn); kept in storage so the alarm's cold start sees it.
    this.lastActivityAt = this.activitySavedAt = Date.now();
    this.put(ACTIVE_KEY, this.lastActivityAt);
    await this.remote.flush();
    if (this.local.pending > 0 || this.unlogged) this.compactLocal();
    await this.armNext();
  }

  // An edit or a presence move from a socket: keeps the alarm at its working
  // pace and runs the checks when they are due. Runs inside Yjs's emits, so it
  // must never throw.
  private noteActivity() {
    try {
      const now = Date.now();
      this.lastActivityAt = now;
      if (now - this.activitySavedAt >= ACTIVITY_SAVE_EVERY_MS) {
        this.activitySavedAt = now;
        this.put(ACTIVE_KEY, now);
      }
      // The check only acts on board sockets, so a room with none (a guest typing
      // in a shared doc of a board nobody has open) skips it and its alarm.
      if (checkDue(now, this.lastCheckAt) && !this.checking && !this.resetting && this.hasSockets()) {
        void this.runCheck();
        void this.armSoon();
      }
    } catch (_) { /* counting is never worth an edit */ }
  }

  private hasSockets(): boolean {
    for (const _ of this.getConnections()) return true;
    return false;
  }

  // Make sure an alarm is set within the working pace (never pushes one back).
  private async armSoon() {
    if (this.resetting) return;
    try {
      const at = await this.ctx.storage.getAlarm();
      const want = Date.now() + ACTIVE_ALARM_MS;
      if (at == null || at > want) await this.ctx.storage.setAlarm(want);
    } catch (e) {
      console.warn(`[board ${this.name}] could not arm the alarm`, e);
      this.problem("alarm", e);
    }
  }

  private runCheck(): Promise<void> {
    if (!this.checking) this.checking = this.check().finally(() => { this.checking = null; });
    return this.checking;
  }

  private autoResponseAt(c: Connection): Date | null {
    try { return this.ctx.getWebSocketAutoResponseTimestamp(c as unknown as WebSocket); } catch { return null; }
  }

  // The periodic checks, run from the alarm or from an edit that finds them due.
  private async check() {
    if (this.resetting) return;
    const checkedAt = Date.now();
    this.lastCheckAt = checkedAt;
    this.put(CHECKED_KEY, checkedAt);
    const conns = [...this.getConnections()];
    if (conns.length) {
      // Audit AC-2: an account banned mid-session stops editing within a minute.
      // And so does anyone who has lost access since they connected: no read
      // closes the socket with 4401, after which the client stops reconnecting
      // (lib/yPartyKit.js); a lost write closes it with 4409, and the client
      // reconnects as read-only.
      const ids = conns.map((c) => stateOf(c).userId || "");
      const [banned, access] = await Promise.all([
        bannedAmong(this.env.SUPABASE_SERVICE_ROLE_KEY, ids),
        accessAmong(this.env.SUPABASE_SERVICE_ROLE_KEY, this.name, ids),
      ]);
      const now = Date.now();
      const stays: Connection[] = [];
      for (const c of conns) {
        const uid = stateOf(c).userId;
        if (uid && banned.has(uid)) {
          try { c.close(4403, "account suspended"); } catch (_) { /* already gone */ }
          continue;
        }
        const may = uid ? access.get(uid) : undefined;
        if (may && !may.canRead) {
          try { c.close(4401, "access ended"); } catch (_) { /* already gone */ }
          continue;
        }
        if (may && stateOf(c).canWrite === true && !may.canWrite) {
          try { c.close(4409, "role changed"); } catch (_) { /* already gone */ }
          continue;
        }
        const heard = lastHeardAt(this.lastHeard.get(c), stateOf(c).heardAt, this.autoResponseAt(c));
        if (!heard) { this.lastHeard.set(c, now); stays.push(c); continue; }
        if (isSilent(now, heard)) {
          try { c.close(SILENT_CLOSE, "silent"); } catch (_) { /* already gone */ }
          continue;
        }
        stays.push(c);
      }
      // Working together: who among those still here earned cards this minute
      // (party/together.ts; it never throws, and fails closed).
      try { await this.together?.tick(stays); } catch (e) { this.problem("together tick", e, "together"); }
    }
    await this.remote.retryIfDirty();
    await this.remote.checkForeign();
    if (this.local.pending > 0) this.compactLocal();
  }

  async onAlarm() {
    if (this.resetting) return;
    if ([...this.getConnections()].length) await this.runCheck();
    else {
      await this.remote.retryIfDirty();
      // A save still running (the cold start's, or the retry) ends inside this
      // alarm, so the next alarm is armed only if it failed.
      await this.remote.settle();
    }
    await this.armNext();
  }

  // The next alarm, or none: an empty room with its saves done keeps no alarm,
  // so it costs nothing until someone opens the cluster.
  private alarmDelay(): number | null {
    return nextAlarmIn({
      now: Date.now(),
      sockets: [...this.getConnections()].length,
      lastActivityAt: this.lastActivityAt,
      dirty: this.remote.dirty,
      dirtySince: this.remote.dirtySince,
      busy: this.remote.pendingForeign || this.remote.inFlight != null,
    });
  }

  // Whether a failed save should keep an alarm coming; never throws.
  private retryWanted(): boolean {
    try { return this.alarmDelay() != null; } catch (_) { return false; }
  }

  private async armNext() {
    if (this.resetting) return;
    try {
      const delay = this.alarmDelay();
      if (delay == null) await this.ctx.storage.deleteAlarm();
      else await this.ctx.storage.setAlarm(Date.now() + delay);
    } catch (e) {
      console.warn(`[board ${this.name}] could not set the next alarm`, e);
      this.problem("alarm", e);
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
      this.problem("reset broadcast", e);
    }
    // Shared docs' rooms start over from the restored board (a new generation).
    try { await this.bridge?.closeAll(4012, "reset"); } catch (_) { /* they rebuild on their own */ }
    await sleep(150);
    try { this.local.wipe(); } catch (_) { /* deleteAll below */ }
    try { await this.ctx.storage.deleteAll(); } catch (e) { console.error(`[board ${this.name}] deleteAll failed`, e); this.problem("reset storage", e); }
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
