// A shared doc's live room (DocParty): the people a doc was shared with, on
// a mirror of that one doc (src/lib/docRoomBridge.js), while the cluster's
// own room (BoardParty) stays the source of truth. The board pushes every
// transaction that touches the doc here; every write from here is checked by
// validateGuestUpdate and handed back to the board (party/bridge.ts).
//
// The room is <share id>.<edit|view>.<generation> (0426 doc_room_access). The
// edit room takes writes from people who may edit; the view room is read
// only and holds no comment threads. A restore or a move gives a new
// generation: an old room sends everyone on (4012) and dies.
//
// Who is here is decided in the Worker before the socket opens (index.ts,
// doc_room_access as the caller) and asked again every minute, and at once on
// POST /recheck after the owner changes the sharing (_doc_room_recheck):
// losing access closes the socket (4401), a suspended account too (4403),
// and someone who may now only view is sent to the view room (4012).
//
// Costs (2026-10-18): not hibernating, like the board room: a socket silent
// for 5 minutes is closed (4000), the client parks when hidden or idle and
// closes with a code, and an empty close is answered. Nothing is held open to
// the board: it pushes on change, and when the last socket leaves this room
// lets go of its subscription and throws its copy away (leave()).
//
// Only the board saying "no such card" or the database saying "no such
// share" closes a room for good (4410). Not being able to ask (a network
// error, a 5xx, a 404 from a board room still on older code) is 4503: the
// client keeps its copy and tries again (2026-10-19: a view room built in the
// minute after a deploy closed "gone" twice and stayed dead, then worked).
import { YServer } from "y-partyserver";
import type { Connection, ConnectionContext } from "partyserver";
import { getServerByName } from "partyserver";
import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import { bannedAmong } from "./auth";
import { DEFAULT_SUPABASE_URL, type Env } from "./env";
import { bridgeHeaders, isBridgeRequest } from "./bridge";
import { validateGuestUpdate, r2KeysIn } from "../src/lib/docRoomBridge.js";
import { PRESENCE_FLUSH_MS, decodePresence, docPresenceOf, encodePresence } from "../src/lib/docRoomPresence.js";
import {
  DOC_ROOM_FRAME_MAX_BYTES, DOC_ROOM_GUEST_UPDATES, DOC_ROOM_GUEST_UPDATES_WINDOW_MS,
  DOC_ROOM_GUEST_AWARENESS_PER_S, DOC_ROOM_MAX_CONNECTIONS, DOC_ROOM_GUEST_DOC_MAX_BYTES,
  DOC_ROOM_SILENT_CLOSE_MS, DOC_ROOM_RECHECK_MS, rateWindow,
} from "../src/lib/docRoomLimits.js";
import { answerEmptyClose } from "../src/lib/partyClose.js";

const ROOM_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(edit|view)\.([0-9a-f]{12})$/i;
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;
const FLUSH_MS = 50;
const CLAIMS_KEY = "claims";
// The fields of a presence that cross: what the doc's cursors need. The name
// and color are the room's, never the browser's.
const AWARENESS_FIELDS = ["cursor", "docCursor", "docCaret", "docSelection"];
const AWARENESS_STATE_MAX = 4096;
const AWARENESS_FRAME_MAX = 16 * 1024;

export const CLOSE = {
  SILENT: 4000, MOVED: 4012, LOST: 4401, SUSPENDED: 4403, GONE: 4410, BUSY: 4429, UNAVAILABLE: 4503, TOO_BIG: 1009,
} as const;

type ConnState = {
  userId: string; access: string; anon: boolean; tokenOk: boolean; name: string; color: string;
  readOnly: boolean; claims: number[]; awareness: number[];
};
const stateOf = (c: Connection) => ((c.state as ConnState) || {}) as ConnState;

const COLORS = ["#4f8df8", "#2fb67c", "#e8833a", "#b46cf0", "#e5484d", "#14a3b8", "#c99a2e", "#7c8cf8"];
function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function toBytes(m: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (m instanceof Uint8Array) return m;
  if (m instanceof ArrayBuffer) return new Uint8Array(m);
  return new Uint8Array(m.buffer, m.byteOffset, m.byteLength);
}

// What serviceRpc answers when the question got no answer: not the same as
// an answer of null ("no such share").
const FAILED = Symbol("failed");

async function serviceRpc(env: Env, name: string, args: Record<string, unknown>): Promise<any> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) return FAILED;
  try {
    const res = await fetch(`${env.SUPABASE_URL || DEFAULT_SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      console.warn(`[doc] ${name} answered ${res.status}`);
      return FAILED;
    }
    return await res.json();
  } catch (e) {
    console.warn(`[doc] ${name} failed`, e);
    return FAILED;
  }
}

export class DocParty extends YServer<Env> {
  static options = { hibernate: false };
  // Nothing is saved here: the board holds the doc.
  static callbackOptions = { debounceWait: 60_000, debounceMaxWait: 120_000, timeout: 5_000 };

  private target: { shareId: string; variant: "edit" | "view"; gen: string; boardId: string; cardId: string } | null = null;
  private dead: { code: number; reason: string } | null = null;
  private trusted = new Set<string>();
  private queue: Array<{ update: Uint8Array; actor: string }> = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private docBytes = 0;
  private lastHeard = new Map<Connection, number>();
  private limits = new Map<Connection, { updates: ReturnType<typeof rateWindow>; awareness: ReturnType<typeof rateWindow> }>();
  private claims = new Map<number, string>();   // a guest's Yjs client id → their user id
  // Presence across the mirror (lib/docRoomPresence.js): the members the board
  // shows here, and guests' changes waiting to cross to it.
  private boardClients = new Set<number>();
  private presenceQueue = new Set<number>();
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceWired = false;

  // Nothing happens until a socket arrives: an HTTP wake (a /recheck, a stray
  // /push) never wakes the board or builds the mirror (security review: a
  // loop of cheap requests must not keep two rooms awake and billing).
  async onLoad() {
    return null;
  }

  private ready: Promise<void> | null = null;
  private subscribed = false;
  private leaving = false;

  // The room's doc, once: where it lives, then the board's mirror of it.
  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.prepare().catch((e) => {
        console.error(`[doc ${this.name}] the room could not be built`, e);
        this.dead = { code: CLOSE.UNAVAILABLE, reason: "unavailable" };
      });
    }
    return this.ready;
  }

  // The room is built before a socket is let in. y-partyserver sends every
  // change of the document to every open socket, so a socket admitted first
  // would get the board's copy twice: once as it lands, once in reply to its
  // own sync step 1.
  async getConnectionTags(_conn: Connection, _ctx: ConnectionContext): Promise<string[]> {
    await this.ensureReady();
    return [];
  }

  private async prepare() {
    this.dead = null;
    const m = ROOM_RE.exec(this.name || "");
    if (!m) { this.dead = { code: CLOSE.GONE, reason: "gone" }; return; }
    const [, shareId, variant, gen] = m;
    const t = await serviceRpc(this.env, "_doc_room_target", { p_share: shareId });
    if (t === FAILED) { this.dead = { code: CLOSE.UNAVAILABLE, reason: "unavailable" }; return; }
    if (!t || !t.board_id) {
      console.warn(`[doc ${this.name}] no such share`);
      this.dead = { code: CLOSE.GONE, reason: "gone" };
      return;
    }
    if (t.gen !== gen.toLowerCase()) { this.dead = { code: CLOSE.MOVED, reason: "moved" }; return; }
    this.target = { shareId, variant: variant === "view" ? "view" : "edit", gen: gen.toLowerCase(), boardId: t.board_id, cardId: t.card_id };
    try {
      const stored = (await this.ctx.storage.get(CLAIMS_KEY)) as Record<string, string> | undefined;
      for (const [c, u] of Object.entries(stored || {})) this.claims.set(Number(c), u);
    } catch (_) { /* guests claim again */ }
    let res: Response;
    try {
      const stub = await getServerByName(this.env.Main as any, this.target.boardId);
      res = await stub.fetch("https://bridge/bridge/subscribe", {
        method: "POST",
        headers: await bridgeHeaders(this.env, { "content-type": "application/json" }),
        body: JSON.stringify({ room: this.name, cardId: this.target.cardId, variant: this.target.variant }),
      });
    } catch (e) {
      console.warn(`[doc ${this.name}] subscribe failed`, e);
      this.dead = { code: CLOSE.UNAVAILABLE, reason: "unavailable" };
      return;
    }
    // Only the bridge's 410 says the card is not on the board.
    if (res.status === 410) {
      console.warn(`[doc ${this.name}] the board has no card ${this.target.cardId}`);
      this.dead = { code: CLOSE.GONE, reason: "gone" };
      return;
    }
    if (!res.ok) {
      console.warn(`[doc ${this.name}] the board answered ${res.status} to subscribe`);
      this.dead = { code: CLOSE.UNAVAILABLE, reason: "unavailable" };
      return;
    }
    try {
      const bytes = new Uint8Array(await res.arrayBuffer());
      Y.applyUpdate(this.document, bytes, "board");
      for (const k of r2KeysIn(bytes)) this.trusted.add(k);
      this.docBytes = bytes.length;
      this.subscribed = true;
      if (!this.presenceWired) {
        this.presenceWired = true;
        this.document.awareness.on("update", (changes: { added: number[]; updated: number[]; removed: number[] }) =>
          this.onAwareness(changes));
      }
    } catch (e) {
      // Whatever landed of it, this copy is thrown away (leave(), from onConnect).
      console.error(`[doc ${this.name}] the board's copy did not apply`, e);
      this.dead = { code: CLOSE.UNAVAILABLE, reason: "unavailable" };
    }
  }

  // Never called with anything to save (the board holds the doc).
  async onSave() {}

  isReadOnly(conn: Connection) {
    return stateOf(conn).readOnly !== false;
  }

  async onConnect(conn: Connection, ctx: ConnectionContext) {
    await this.ensureReady();
    if (this.leaving || this.dead || !this.target) {
      const d = (!this.leaving && this.dead) || { code: CLOSE.UNAVAILABLE, reason: "unavailable" };
      try { conn.close(d.code, d.reason); } catch (_) { /* already gone */ }
      // A room that could not be built is no use to anyone: the next socket
      // finds a fresh one.
      if (d.code === CLOSE.UNAVAILABLE) this.leave();
      return;
    }
    if ([...this.getConnections()].length > DOC_ROOM_MAX_CONNECTIONS) {
      try { conn.close(CLOSE.BUSY, "full"); } catch (_) { /* already gone */ }
      return;
    }
    const h = ctx.request.headers;
    const userId = h.get("x-user-id") || "";
    const access = h.get("x-doc-access") || "view";
    const anon = h.get("x-anon") === "1" || !userId;
    const readOnly = this.target.variant !== "edit" || anon || !(access === "edit" || access === "manage");
    const name = (h.get("x-doc-name") || "").slice(0, 80) || (anon ? "Viewer" : "Guest");
    const claims = userId ? [...this.claims].filter(([, u]) => u === userId).map(([c]) => c) : [];
    conn.setState({
      userId, access, anon, tokenOk: h.get("x-token-ok") === "1", name, color: colorFor(userId || conn.id),
      readOnly, claims, awareness: [],
    } satisfies ConnState);
    this.lastHeard.set(conn, Date.now());
    this.limits.set(conn, {
      updates: rateWindow(DOC_ROOM_GUEST_UPDATES, DOC_ROOM_GUEST_UPDATES_WINDOW_MS),
      awareness: rateWindow(DOC_ROOM_GUEST_AWARENESS_PER_S, 1000),
    });
    super.onConnect(conn, ctx);
    const st = stateOf(conn);
    this.sendCustomMessage(conn, JSON.stringify({
      type: "hello", me: { name: st.name, color: st.color }, access, readOnly, variant: this.target.variant,
    }));
    await this.armAlarm();
  }

  onMessage(conn: Connection, message: string | ArrayBuffer | ArrayBufferView) {
    this.lastHeard.set(conn, Date.now());
    if (typeof message === "string") return super.onMessage(conn, message);
    const bytes = toBytes(message);
    let type: number;
    let decoder: decoding.Decoder;
    try {
      decoder = decoding.createDecoder(bytes);
      type = decoding.readVarUint(decoder);
    } catch (_) { return; }

    if (type === MSG_SYNC) {
      let sub: number;
      try { sub = decoding.readVarUint(decoder); } catch (_) { return; }
      // A request for what the room holds: answer it.
      if (sub === SYNC_STEP1) return super.onMessage(conn, message);
      if (sub !== SYNC_STEP2 && sub !== SYNC_UPDATE) return;
      const st = stateOf(conn);
      if (st.readOnly) return;
      if (bytes.length > DOC_ROOM_FRAME_MAX_BYTES) {
        try { conn.close(CLOSE.TOO_BIG, "too large"); } catch (_) { /* gone */ }
        return;
      }
      if (!this.limits.get(conn)?.updates.hit()) {
        try { conn.close(CLOSE.BUSY, "too many edits"); } catch (_) { /* gone */ }
        return;
      }
      let update: Uint8Array;
      try { update = decoding.readVarUint8Array(decoder); } catch (_) { return; }
      if (this.docBytes > DOC_ROOM_GUEST_DOC_MAX_BYTES) { this.refuse(conn, "doc_full"); return; }
      const verdict = validateGuestUpdate(this.document, update, {
        cardKey: this.target?.cardId, claims: new Set(st.claims), userId: st.userId, displayName: st.name,
        trustedKeys: this.trusted, maxBytes: DOC_ROOM_FRAME_MAX_BYTES,
      });
      if (!verdict.ok) { this.refuse(conn, verdict.reason); return; }
      if (verdict.empty) return super.onMessage(conn, message);
      let claimed = false;
      for (const c of verdict.clients) {
        if (!st.claims.includes(c)) { st.claims.push(c); this.claims.set(c, st.userId); claimed = true; }
      }
      conn.setState(st);
      if (claimed) void this.saveClaims();
      super.onMessage(conn, message);
      this.docBytes += update.length;
      this.forward(update, st.userId);
      return;
    }

    if (type === MSG_AWARENESS) {
      if (bytes.length > AWARENESS_FRAME_MAX) return;
      if (!this.limits.get(conn)?.awareness.hit()) return;
      let data: Uint8Array;
      try { data = decoding.readVarUint8Array(decoder); } catch (_) { return; }
      const cleaned = this.cleanAwareness(conn, data);
      if (!cleaned) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, cleaned);
      return super.onMessage(conn, encoding.toUint8Array(enc));
    }
  }

  // A presence update: only the connection's own client ids, only the fields
  // the doc's cursors need, and the name and color the room gave it.
  private cleanAwareness(conn: Connection, data: Uint8Array): Uint8Array | null {
    const st = stateOf(conn);
    // Taken: another guest's ids, and the members' the board shows here.
    const taken = new Set<number>(this.boardClients);
    for (const c of this.getConnections()) if (c !== conn) for (const id of stateOf(c).awareness || []) taken.add(id);
    try {
      const dec = decoding.createDecoder(data);
      const n = decoding.readVarUint(dec);
      const out: Array<{ id: number; clock: number; state: string }> = [];
      for (let i = 0; i < n; i++) {
        const id = decoding.readVarUint(dec);
        const clock = decoding.readVarUint(dec);
        const raw = decoding.readVarString(dec);
        if (!st.awareness.includes(id)) {
          if (taken.has(id) || st.awareness.length >= 4) continue;
          st.awareness.push(id);
        }
        let state: Record<string, unknown> | null = null;
        if (raw !== "null") {
          let parsed: any = null;
          try { parsed = JSON.parse(raw); } catch (_) { continue; }
          if (!parsed || typeof parsed !== "object") continue;
          state = { user: { id: `p:${id}`, name: st.name, color: st.color, guest: true } };
          for (const f of AWARENESS_FIELDS) if (f in parsed) state[f] = parsed[f];
        }
        const json = JSON.stringify(state);
        if (json.length > AWARENESS_STATE_MAX) continue;
        out.push({ id, clock, state: json });
      }
      conn.setState(st);
      if (!out.length) return null;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, out.length);
      for (const e of out) {
        encoding.writeVarUint(enc, e.id);
        encoding.writeVarUint(enc, e.clock);
        encoding.writeVarString(enc, e.state);
      }
      return encoding.toUint8Array(enc);
    } catch (_) {
      return null;
    }
  }

  // A write that was refused never reaches anyone. The client starts over from
  // what the room holds.
  private refuse(conn: Connection, reason: string) {
    this.sendCustomMessage(conn, JSON.stringify({ type: "refused", reason }));
  }

  private async saveClaims() {
    // Oldest first out past a few hundred: a guest who comes back after that
    // claims a fresh client id with a fresh doc.
    while (this.claims.size > 500) this.claims.delete(this.claims.keys().next().value as number);
    try { await this.ctx.storage.put(CLAIMS_KEY, Object.fromEntries([...this.claims].map(([c, u]) => [String(c), u]))); } catch (_) { /* best effort */ }
  }

  // ── presence, to the board ────────────────────────────────────────────────

  // A guest's presence changed (or they left): it crosses to the board, which
  // shows it to the members and to the doc's other room.
  private onAwareness(changes: { added: number[]; updated: number[]; removed: number[] }) {
    if (!this.subscribed || this.dead || this.leaving) return;
    for (const id of [...changes.added, ...changes.updated, ...changes.removed]) {
      if (!this.boardClients.has(id)) this.presenceQueue.add(id);
    }
    if (this.presenceQueue.size && !this.presenceTimer) {
      this.presenceTimer = setTimeout(() => { void this.flushPresence(); }, PRESENCE_FLUSH_MS);
    }
  }

  private async flushPresence() {
    if (this.presenceTimer) { clearTimeout(this.presenceTimer); this.presenceTimer = null; }
    if (!this.target || !this.presenceQueue.size) return;
    const aw = this.document.awareness;
    const entries: Array<{ id: number; clock: number; state: unknown }> = [];
    for (const id of this.presenceQueue) {
      const meta = aw.meta.get(id);
      if (meta) entries.push({ id, clock: meta.clock, state: docPresenceOf(aw.getStates().get(id), this.target.cardId, id) });
    }
    this.presenceQueue.clear();
    if (!entries.length) return;
    try {
      const stub = await getServerByName(this.env.Main as any, this.target.boardId);
      await stub.fetch("https://bridge/bridge/presence", {
        method: "POST",
        headers: await bridgeHeaders(this.env, { "content-type": "application/octet-stream", "x-doc-room": this.name }),
        body: encodePresence(entries),
      });
    } catch (_) { /* best effort: the 15 s renewal sends it again */ }
  }

  // ── to the board ──────────────────────────────────────────────────────────

  private forward(update: Uint8Array, actor: string) {
    this.queue.push({ update, actor });
    if (!this.flushTimer) this.flushTimer = setTimeout(() => { void this.flush(); }, FLUSH_MS);
  }

  private async flush() {
    this.flushTimer = null;
    if (!this.target || !this.queue.length) return;
    const batch = this.queue.splice(0);
    const byActor = new Map<string, Uint8Array[]>();
    for (const q of batch) {
      if (!byActor.has(q.actor)) byActor.set(q.actor, []);
      byActor.get(q.actor)!.push(q.update);
    }
    for (const [actor, updates] of byActor) {
      const update = updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);
      const status = await this.pushToBoard(update, actor);
      if (status === "ok") { this.failures = 0; continue; }
      if (status === "gone") { this.sendAway(CLOSE.GONE, "gone"); return; }
      // Keep it, in order, and try again; past three failures the room starts over.
      this.queue.unshift(...updates.map((u) => ({ update: u, actor })));
      this.failures += 1;
      if (this.failures >= 3) { this.startOver(); return; }
      if (!this.flushTimer) this.flushTimer = setTimeout(() => { void this.flush(); }, 500 * this.failures);
      return;
    }
  }

  private async pushToBoard(update: Uint8Array, actor: string): Promise<"ok" | "gone" | "retry"> {
    if (!this.target) return "gone";
    try {
      const stub = await getServerByName(this.env.Main as any, this.target.boardId);
      const res = await stub.fetch("https://bridge/bridge/apply", {
        method: "POST",
        headers: await bridgeHeaders(this.env, {
          "content-type": "application/octet-stream", "x-doc-room": this.name, "x-actor": actor || "",
        }),
        body: update,
      });
      if (res.ok) return "ok";
      if (res.status === 410) return "gone";
      return "retry";
    } catch (_) {
      return "retry";
    }
  }

  // The board could not take these writes. Everyone leaves; a fresh room
  // reloads from the board, and each client's own copy sends again what never
  // reached it.
  private startOver() {
    this.sendAway(CLOSE.UNAVAILABLE, "unavailable");
    setTimeout(() => this.ctx.abort("doc bridge failed"), 100);
  }

  private sendAway(code: number, reason: string) {
    this.dead = { code, reason };
    for (const c of this.getConnections()) {
      try { c.close(code, reason); } catch (_) { /* already gone */ }
    }
  }

  private async unsubscribe() {
    if (!this.target) return;
    if (this.queue.length) await this.flush();
    try {
      const stub = await getServerByName(this.env.Main as any, this.target.boardId);
      await stub.fetch("https://bridge/bridge/unsubscribe", {
        method: "POST",
        headers: await bridgeHeaders(this.env, { "content-type": "application/json" }),
        body: JSON.stringify({ room: this.name }),
      });
    } catch (_) { /* the board drops it at its next push (410) */ }
  }

  // The last one out lets go of the board and throws this copy away; a socket
  // that arrives meanwhile is sent to try again (4503). Subscribing this copy
  // again would miss what the board deleted while it was unsubscribed: the
  // board's copy carries a deletion as a deleted struct, which a copy that
  // already holds that struct skips.
  private leave() {
    if (this.leaving) return;
    this.leaving = true;
    void (async () => {
      await this.flushPresence();
      await this.unsubscribe();
      try { await this.ctx.storage.deleteAlarm(); } catch (_) { /* none set */ }
      try { this.ctx.abort("the room emptied"); } catch (_) { /* already resetting */ }
    })();
  }

  // ── from the board, the upload party and the dialog ──────────────────────

  async onRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const cors = {
      "access-control-allow-origin": req.headers.get("origin") || "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "vary": "Origin",
    };
    // After the owner changes who may be here: ask again now, not in a minute.
    if (url.pathname.endsWith("/recheck")) {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
      void this.recheck();
      return new Response(null, { status: 204, headers: cors });
    }
    if (req.method !== "POST" || !(await isBridgeRequest(req, this.env))) return new Response("Not found", { status: 404 });

    if (url.pathname.endsWith("/push")) {
      if (!this.subscribed || !this.target || this.dead || this.leaving) return new Response("Gone", { status: 410 });
      if ([...this.getConnections()].length === 0) return new Response("Nobody here", { status: 410 });
      const bytes = new Uint8Array(await req.arrayBuffer());
      try {
        Y.applyUpdate(this.document, bytes, "board");
      } catch (e) {
        console.error(`[doc ${this.name}] a board push did not apply`, e);
        this.sendAway(CLOSE.MOVED, "rebuild");
        return new Response("Did not apply", { status: 422 });
      }
      // Files the members put in the doc are ones a guest may show again.
      for (const k of r2KeysIn(bytes)) this.trusted.add(k);
      this.docBytes += bytes.length;
      return new Response(null, { status: 204 });
    }

    // The members the board shows in this doc. Never over a guest's own client
    // id, and only this doc's fields; marked before they land, so they are not
    // sent back.
    if (url.pathname.endsWith("/presence")) {
      if (!this.subscribed || !this.target || this.dead || this.leaving) return new Response("Gone", { status: 410 });
      if ([...this.getConnections()].length === 0) return new Response("Nobody here", { status: 410 });
      const guests = new Set<number>();
      for (const c of this.getConnections()) for (const id of stateOf(c).awareness || []) guests.add(id);
      const keep: Array<{ id: number; clock: number; state: ReturnType<typeof docPresenceOf> }> = [];
      for (const e of decodePresence(new Uint8Array(await req.arrayBuffer()))) {
        if (guests.has(e.id)) continue;
        const state = e.state === null ? null : docPresenceOf(e.state, this.target.cardId, e.id);
        if (e.state !== null && !state) continue;
        keep.push({ id: e.id, clock: e.clock, state });
      }
      if (keep.length) {
        for (const e of keep) if (e.state) this.boardClients.add(e.id);
        awarenessProtocol.applyAwarenessUpdate(this.document.awareness, encodePresence(keep), null);
        for (const e of keep) if (!e.state) this.boardClients.delete(e.id);
      }
      return new Response(null, { status: 204 });
    }

    if (url.pathname.endsWith("/close")) {
      const body = (await req.json().catch(() => null)) as { code?: number; reason?: string } | null;
      const code = Number(body?.code) || CLOSE.MOVED;
      this.sendAway(code, String(body?.reason || "moved").slice(0, 60));
      setTimeout(() => this.ctx.abort("doc room closed by its board"), 100);
      return new Response(null, { status: 204 });
    }

    // The images the doc holds: the only ones the upload party will sign for
    // someone reading it through its link.
    if (url.pathname.endsWith("/keys")) {
      return Response.json({ keys: this.dead ? [] : [...this.trusted] });
    }

    return new Response("Not found", { status: 404 });
  }

  // ── who may still be here ─────────────────────────────────────────────────

  private recheckRunning = false;
  private recheckAt = 0;

  // At most one every 5 seconds, and never two at once.
  private async recheck() {
    if (!this.target || this.dead || this.leaving || this.recheckRunning || Date.now() - this.recheckAt < 5_000) return;
    const conns = [...this.getConnections()];
    if (!conns.length) return;
    this.recheckRunning = true;
    this.recheckAt = Date.now();
    try { await this.recheckNow(conns); } finally { this.recheckRunning = false; }
  }

  private async recheckNow(conns: Connection[]) {
    if (!this.target) return;
    const subjects = conns.map((c) => ({ key: c.id, user_id: stateOf(c).userId || null, token_ok: stateOf(c).tokenOk }));
    const asked = await serviceRpc(this.env, "_doc_room_recheck", { p_share: this.target.shareId, p_subjects: subjects });
    // No answer: everyone stays until the next minute's question.
    const r = asked === FAILED ? null : asked;
    if (r && r.gone) { this.sendAway(CLOSE.GONE, "gone"); return; }
    if (r && r.gen && r.gen !== this.target.gen) { this.sendAway(CLOSE.MOVED, "moved"); return; }
    if (r && r.access) {
      for (const c of conns) {
        const a = r.access[c.id];
        if (!a || a === "none" || a === "gone") {
          try { c.close(CLOSE.LOST, "access ended"); } catch (_) { /* gone */ }
        } else if (this.target.variant === "edit" && !stateOf(c).readOnly && !(a === "edit" || a === "manage")) {
          // May only view now: to the view room.
          try { c.close(CLOSE.MOVED, "view only"); } catch (_) { /* gone */ }
        }
      }
    }
    const ids = conns.map((c) => stateOf(c).userId).filter(Boolean);
    if (ids.length) {
      const banned = await bannedAmong(this.env.SUPABASE_SERVICE_ROLE_KEY, ids);
      for (const c of conns) {
        const uid = stateOf(c).userId;
        if (uid && banned.has(uid)) { try { c.close(CLOSE.SUSPENDED, "account suspended"); } catch (_) { /* gone */ } }
      }
    }
  }

  private async armAlarm() {
    try {
      if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + DOC_ROOM_RECHECK_MS);
    } catch (_) { /* the next connect re-arms */ }
  }

  async onAlarm() {
    const conns = [...this.getConnections()];
    if (!conns.length) { this.leave(); return; }
    await this.recheck();
    const now = Date.now();
    for (const c of this.getConnections()) {
      const heard = this.lastHeard.get(c);
      if (heard == null) { this.lastHeard.set(c, now); continue; }
      if (now - heard > DOC_ROOM_SILENT_CLOSE_MS) { try { c.close(CLOSE.SILENT, "silent"); } catch (_) { /* gone */ } }
    }
    if (!this.dead) {
      try { await this.ctx.storage.setAlarm(Date.now() + DOC_ROOM_RECHECK_MS); } catch (_) { /* next connect re-arms */ }
    }
  }

  // A close with no status code gets its answer (lib/partyClose.js); the last
  // one out lets go of the board (leave()). partyserver has already dropped
  // the closing socket from getConnections().
  onClose(conn: Connection, code: number, reason: string, wasClean: boolean) {
    try { super.onClose(conn, code, reason, wasClean); } finally { answerEmptyClose(conn, code); }
    this.lastHeard.delete(conn);
    this.limits.delete(conn);
    if ([...this.getConnections()].length === 0) this.leave();
  }
}
