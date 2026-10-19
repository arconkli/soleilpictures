// The board room's side of a shared doc's mirror (DocParty, party/doc.ts).
//
// A doc room subscribes to one card of this board. This room then pushes
// every transaction that touches that card's doc, filtered by
// src/lib/docRoomBridge.js (only that doc, with its own Yjs ids; the rest of
// the cluster as empty GC runs), and applies the guest writes the doc room
// validated and hands back. The board stays the only source of truth.
//
// Cost (2026-10-18): nothing is held open between the two objects. A push
// happens only when a transaction touches a subscribed doc; a doc room with
// no sockets answers 410 and is dropped. With no subscription every hook
// here returns at its first line.
//
// The routes (/bridge/subscribe, /bridge/unsubscribe, /bridge/apply) are
// reachable only from a Durable Object stub: the Worker's beforeRequest
// turns every outside request for them away, and each one checks the
// bridge header too.
import * as Y from "yjs";
import { getServerByName } from "partyserver";
import { extractDocSubtree, filterTransaction, validateGuestUpdate } from "../src/lib/docRoomBridge.js";
import type { Env } from "./env";

const SUBS_KEY = "bridgeSubs";
const PUSH_DELAY_MS = 50;
const ROOM_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(edit|view)\.[0-9a-f]{12}$/i;

// The header one room shows another: its own secret (DOC_BRIDGE_SECRET) when
// the Worker has one, else derived from the service key; no browser has either.
export async function bridgeSecret(env: Env): Promise<string> {
  if (env.DOC_BRIDGE_SECRET && env.DOC_BRIDGE_SECRET.length >= 32) return env.DOC_BRIDGE_SECRET;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${key}:doc-bridge`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function bridgeHeaders(env: Env, extra: Record<string, string> = {}): Promise<Record<string, string>> {
  return { "x-soleil-bridge": await bridgeSecret(env), ...extra };
}

export async function isBridgeRequest(req: Request, env: Env): Promise<boolean> {
  const got = req.headers.get("x-soleil-bridge") || "";
  const want = await bridgeSecret(env);
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

type Sub = {
  room: string;
  cardId: string;
  variant: "edit" | "view";
  sent: Map<number, number>;
  queue: Uint8Array[];
  timer: ReturnType<typeof setTimeout> | null;
};

// Where a transaction applied from a doc room came from.
export type DocRoomOrigin = { docRoom: string; actor: string | null };
const isDocRoomOrigin = (o: unknown): o is DocRoomOrigin =>
  !!o && typeof o === "object" && typeof (o as DocRoomOrigin).docRoom === "string";

export class BoardBridge {
  private subs = new Map<string, Sub>();

  constructor(
    private readonly host: {
      name: string;
      env: Env;
      document: Y.Doc;
      ctx: DurableObjectState;
      resetting: () => boolean;
    },
  ) {}

  get size() { return this.subs.size; }

  async load() {
    try {
      const stored = (await this.host.ctx.storage.get(SUBS_KEY)) as Record<string, { cardId: string; variant: "edit" | "view" }> | undefined;
      for (const [room, s] of Object.entries(stored || {})) {
        if (!ROOM_RE.test(room) || !s?.cardId) continue;
        // After a restart nothing says what the room already holds: the next
        // push carries the doc from the start, which the room merges as a no-op.
        this.subs.set(room, { room, cardId: s.cardId, variant: s.variant === "view" ? "view" : "edit", sent: new Map(), queue: [], timer: null });
      }
    } catch (e) {
      console.warn(`[board ${this.host.name}] bridge subscriptions did not load`, e);
    }
  }

  private async persist() {
    const out: Record<string, { cardId: string; variant: string }> = {};
    for (const [room, s] of this.subs) out[room] = { cardId: s.cardId, variant: s.variant };
    try { await this.host.ctx.storage.put(SUBS_KEY, out); } catch (_) { /* rebuilt on the next subscribe */ }
  }

  // Every transaction of the board: pushed to each mirror whose doc it touches.
  onTransaction(tr: Y.Transaction) {
    if (!this.subs.size || this.host.resetting()) return;
    const cards = this.host.document.getMap("cards");
    for (const sub of this.subs.values()) {
      // Its own writes are already there; the room's other variant still
      // needs them, and gets them below.
      if (isDocRoomOrigin(tr.origin) && tr.origin.docRoom === sub.room) continue;
      if (!cards.has(sub.cardId)) {
        void this.close(sub.room, 4410, "gone");
        continue;
      }
      let update: Uint8Array | null = null;
      try {
        update = filterTransaction(this.host.document, tr, sub.cardId, { variant: sub.variant, sent: sub.sent });
      } catch (e) {
        console.error(`[board ${this.host.name}] bridge filter failed for ${sub.room}`, e);
        void this.close(sub.room, 4012, "rebuild");
        continue;
      }
      if (!update) continue;
      sub.queue.push(update);
      if (!sub.timer) sub.timer = setTimeout(() => { void this.push(sub); }, PUSH_DELAY_MS);
    }
  }

  private async push(sub: Sub) {
    sub.timer = null;
    const batch = sub.queue.splice(0);
    if (!batch.length || !this.subs.has(sub.room)) return;
    const update = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
    try {
      const stub = await getServerByName(this.host.env.Doc as any, sub.room);
      const res = await stub.fetch("https://bridge/push", {
        method: "POST",
        headers: await bridgeHeaders(this.host.env, { "content-type": "application/octet-stream" }),
        body: update,
      });
      // No one there any more: drop it. It subscribes again when someone opens it.
      if (res.status === 410) await this.drop(sub.room);
      else if (!res.ok) await this.close(sub.room, 4012, "rebuild");
    } catch (e) {
      // The room can't hear us: make it rebuild from the board, so nothing is missed.
      console.warn(`[board ${this.host.name}] bridge push to ${sub.room} failed`, e);
      await this.close(sub.room, 4012, "rebuild");
    }
  }

  private async drop(room: string) {
    const sub = this.subs.get(room);
    if (sub?.timer) clearTimeout(sub.timer);
    this.subs.delete(room);
    await this.persist();
  }

  // Tell a doc room to send everyone away (a reset, a deleted card, a gap),
  // and forget it.
  async close(room: string, code: number, reason: string) {
    await this.drop(room);
    try {
      const stub = await getServerByName(this.host.env.Doc as any, room);
      await stub.fetch("https://bridge/close", {
        method: "POST",
        headers: await bridgeHeaders(this.host.env, { "content-type": "application/json" }),
        body: JSON.stringify({ code, reason }),
      });
    } catch (_) { /* it rebuilds on its next connection anyway */ }
  }

  async closeAll(code: number, reason: string) {
    for (const room of [...this.subs.keys()]) await this.close(room, code, reason);
  }

  // /bridge/* from a doc room's stub. Null when the path is not the bridge's.
  async handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (!path.includes("/bridge/")) return null;
    if (req.method !== "POST" || !(await isBridgeRequest(req, this.host.env))) {
      return new Response("Not found", { status: 404 });
    }
    if (this.host.resetting()) return new Response("Resetting", { status: 409 });

    if (path.endsWith("/bridge/subscribe")) {
      const body = (await req.json().catch(() => null)) as { room?: string; cardId?: string; variant?: string } | null;
      const room = String(body?.room || "");
      const cardId = String(body?.cardId || "");
      if (!ROOM_RE.test(room) || !cardId) return new Response("Bad request", { status: 400 });
      const variant = body?.variant === "view" ? "view" : "edit";
      const x = extractDocSubtree(this.host.document, cardId, { variant });
      if (!x) return new Response("Gone", { status: 410 });
      const prev = this.subs.get(room);
      if (prev?.timer) clearTimeout(prev.timer);
      this.subs.set(room, { room, cardId, variant, sent: x.sent, queue: [], timer: null });
      await this.persist();
      return new Response(x.update, { status: 200, headers: { "content-type": "application/octet-stream" } });
    }

    if (path.endsWith("/bridge/unsubscribe")) {
      const body = (await req.json().catch(() => null)) as { room?: string } | null;
      await this.drop(String(body?.room || ""));
      return new Response(null, { status: 204 });
    }

    if (path.endsWith("/bridge/apply")) {
      const room = req.headers.get("x-doc-room") || "";
      const sub = this.subs.get(room);
      // An old generation, or a room this board never served: refused.
      if (!sub || sub.variant !== "edit") return new Response("Gone", { status: 410 });
      const actor = req.headers.get("x-actor") || null;
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (!bytes.length) return new Response(null, { status: 204 });
      // A second look, here, at where it lands: everything inside that card's
      // doc, nothing else of the board (security review: a bug in the room, or
      // a leaked key, can't write anywhere else).
      const placed = validateGuestUpdate(this.host.document, bytes, {
        cardKey: sub.cardId, structureOnly: true, maxBytes: 8 * 1024 * 1024,
      });
      if (!placed.ok) {
        console.warn(`[board ${this.host.name}] refused a doc room's update: ${placed.reason}`);
        return new Response("Refused", { status: 422 });
      }
      try {
        Y.applyUpdate(this.host.document, bytes, { docRoom: room, actor } satisfies DocRoomOrigin);
      } catch (e) {
        console.error(`[board ${this.host.name}] a doc room's update did not apply`, e);
        return new Response("Did not apply", { status: 422 });
      }
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  }
}
