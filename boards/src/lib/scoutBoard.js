// Scout — writing cards onto a user's board from the server.
//
// A browser client writes THREE places, and so must this. Doing fewer is not a
// degraded experience, it's data loss:
//
//   1. the live PartyKit Y.Doc  — so cards appear on an open canvas immediately
//   2. board_state.doc          — the cold-load source, AND the thing whose
//                                 trigger (board_state_recompute_image_refs,
//                                 0127) populates images.referenced_in_board_ids.
//                                 Skip it and the R2 orphan sweep eventually
//                                 DELETES the user's scout photos.
//   3. card_index               — search, home graph, SEO, and the demo-cap
//                                 trigger that enforces the 100-card wall.
//
// Write ORDER is deliberate. card_index goes first because it carries
// enforce_demo_card_cap_trg (0187): if the user is at their cap we want to find
// out before anything is visible on their canvas, not after. R2 objects are
// already written by then, but the images row carries referenced_in_board_ids
// from birth, so they're never sweep-eligible even if a later step fails.

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { bytesToB64, b64ToBytes, cardToYMap, readCards } from './yhelpers.js';
import { buildCardIndexRows, stampCard } from '../../scripts/lib/cardEncode.mjs';
import { scoutSelect, scoutInsert, scoutRpc } from './scoutDb.js';

const MESSAGE_SYNC = 0;
const SYNC_STEP_2 = 1;
const CONNECT_TIMEOUT_MS = 8_000;
const FLUSH_GRACE_MS = 750;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Headless Yjs peer ────────────────────────────────────────────────────────
//
// We speak the y-websocket wire protocol directly rather than using
// y-partykit/provider: the provider is built for a long-lived browser session
// with reconnection and awareness, and we want one short, deterministic
// push-then-leave. Room is the board id on the default ("main") party, matching
// `new YPartyKitProvider(HOST, boardId, ...)` in yPartyKit.js:62.
//
// Uses the STANDARD WebSocket constructor rather than Cloudflare's
// fetch-with-Upgrade extension, so this file runs unchanged in the Node ingest
// service (Node 22+ ships a global WebSocket). Resolves only once the socket is
// actually open — the caller starts the Yjs handshake immediately and would
// otherwise race the connection.
async function connectPeer(env, boardId, accessToken) {
  const host = env.PARTYKIT_HOST || 'soleil-boards-party.arconkli.partykit.dev';
  const url = `wss://${host}/parties/main/${encodeURIComponent(boardId)}`
    + `?access_token=${encodeURIComponent(accessToken)}`;

  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('partykit connect timeout')), CONNECT_TIMEOUT_MS);
    const done = (fn, err) => { clearTimeout(timer); fn(err); };
    ws.addEventListener('open', () => done(resolve), { once: true });
    ws.addEventListener('error', () => done(reject, new Error('partykit connect failed')), { once: true });
    ws.addEventListener('close', () => done(reject, new Error('partykit closed before open')), { once: true });
  });
  return ws;
}

// Bring `doc` up to the room's current state. Resolves once the server's
// syncStep2 lands, or rejects on timeout — the caller falls back to the
// board_state baseline, which is stale but never wrong.
function syncPeer(ws, doc) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('partykit sync timeout'));
    }, CONNECT_TIMEOUT_MS);

    ws.addEventListener('message', (evt) => {
      let bytes;
      if (evt.data instanceof ArrayBuffer) bytes = new Uint8Array(evt.data);
      else if (typeof evt.data === 'string') return;   // awareness/JSON chatter
      else bytes = new Uint8Array(evt.data);

      try {
        const dec = decoding.createDecoder(bytes);
        const type = decoding.readVarUint(dec);
        if (type !== MESSAGE_SYNC) return;
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        const step = syncProtocol.readSyncMessage(dec, enc, doc, 'scout');
        // Only reply when readSyncMessage actually produced a payload.
        if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
        if (step === SYNC_STEP_2 && !settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      } catch (_) { /* ignore malformed frames */ }
    });

    ws.addEventListener('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('partykit closed during sync'));
    });
    ws.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('partykit socket error'));
    });

    // Kick off: ask the room what it has.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, doc);
    ws.send(encoding.toUint8Array(enc));
  });
}

function pushUpdate(ws, update) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeUpdate(enc, update);
  ws.send(encoding.toUint8Array(enc));
}

// ── Public API ───────────────────────────────────────────────────────────────
//
// addCardsToBoard — load, sync, let the caller decide what to add given the
// board's CURRENT contents, then commit everywhere.
//
//   buildCards(existingCards) → array of card objects WITHOUT x/y/z stamped
//   (the caller positions them; see composeBatch in scoutCards.js).
//
// Returns { cards, live, cardCount }. `live` is false when the PartyKit push
// didn't happen — the cards are still durable, they just won't show up on an
// already-open canvas until it reloads.
export async function addCardsToBoard(env, {
  boardId, workspaceId, userId, accessToken, buildCards,
}) {
  const doc = new Y.Doc();

  // Baseline from Postgres. Works with no network to PartyKit at all.
  const rows = await scoutSelect(env, 'board_state', `board_id=eq.${boardId}&select=doc`).catch(() => []);
  const baseline = rows?.[0]?.doc;
  if (baseline) {
    try { Y.applyUpdate(doc, b64ToBytes(baseline), 'snapshot'); } catch (_) { /* corrupt snapshot → start clean */ }
  }

  // Freshen from the live room so layout is computed against what the user can
  // actually see. Best-effort by design.
  let ws = null;
  let live = false;
  if (accessToken) {
    try {
      ws = await connectPeer(env, boardId, accessToken);
      await syncPeer(ws, doc);
      live = true;
    } catch (_) {
      try { ws?.close(); } catch (_) { /* already gone */ }
      ws = null;
    }
  }

  try {
    const existing = readCards(doc);
    const fresh = (await buildCards(existing)) || [];
    if (!fresh.length) return { cards: [], live, cardCount: existing.length };

    const nowIso = new Date().toISOString();
    const cardsMap = doc.getMap('cards');

    // Resolve ids BEFORE anything is written anywhere.
    //
    // map.set() on an id that already exists REPLACES that card. Our ids carry
    // a timestamp, a counter and 20 bits of randomness so a collision is
    // essentially impossible — but "essentially impossible" is not the standard
    // for silently destroying someone's work, so we check and take a fresh id
    // instead. Doing it here (rather than at write time) keeps card_index and
    // the Y.Doc agreeing on the same ids; resolving later would leave an
    // orphaned index row pointing at an id no card has.
    const taken = new Set();
    const stamped = fresh.map((c, i) => {
      let id = c.id;
      let guard = 0;
      while ((cardsMap.has(id) || taken.has(id)) && guard++ < 10) {
        id = `${c.id}-${Math.random().toString(36).slice(2, 8)}`;
      }
      taken.add(id);
      return {
        ...stampCard({ ...c, id }, existing.length + i, nowIso),
        createdBy: userId || null,
        updatedBy: userId || null,
      };
    }).filter((c) => !cardsMap.has(c.id));   // never clobber, even if we ran out of tries

    if (!stamped.length) return { cards: [], live, cardCount: existing.length };

    // 1. card_index FIRST — this is where the 100-card wall lives. A cap hit
    //    throws here, before anything reaches the user's canvas.
    const indexRows = buildCardIndexRows({ workspaceId, boardId, cards: stamped });
    if (indexRows.length) {
      await scoutInsert(env, 'card_index', indexRows, { onConflict: 'board_id,card_id' });
    }

    // 2. Apply locally, capturing just the delta for the wire.
    const before = Y.encodeStateVector(doc);
    doc.transact(() => {
      for (const c of stamped) cardsMap.set(c.id, cardToYMap(c));
    }, 'scout');
    const delta = Y.encodeStateAsUpdate(doc, before);

    // 3. Live push, so an open canvas animates them in.
    if (ws) {
      try {
        pushUpdate(ws, delta);
        await sleep(FLUSH_GRACE_MS);   // let the frame leave before we hang up
      } catch (_) { live = false; }
    }

    // 4. board_state — cold load, history, and the image-ref recompute that
    //    keeps these photos out of the R2 orphan sweep. Never skip this.
    const full = bytesToB64(Y.encodeStateAsUpdate(doc));
    await scoutInsert(env, 'board_state', [{
      board_id: boardId, doc: full, updated_at: new Date().toISOString(),
    }], { onConflict: 'board_id' });

    return { cards: stamped, live, cardCount: existing.length + stamped.length };
  } finally {
    try { ws?.close(); } catch (_) { /* already gone */ }
    doc.destroy();
  }
}

// Capacity pre-flight. Returns { used, cap, capped, remaining }. Called BEFORE
// any R2 upload so we never spend bytes on a card that will be rejected.
export async function boardCapacity(env, boardId) {
  const res = await scoutRpc(env, 'get_board_capacity', { p_board_id: boardId });
  const row = Array.isArray(res) ? res[0] : res;
  const used = Number(row?.used ?? 0);
  const cap = row?.cap == null ? Infinity : Number(row.cap);
  return {
    used,
    cap,
    capped: !!row?.is_capped,
    remaining: cap === Infinity ? Infinity : Math.max(0, cap - used),
  };
}
