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
import { bytesToB64, b64ToBytes, cardToYMap, readCards, writeCardFields } from './yhelpers.js';
import { buildCardIndexRows, stampCard } from '../../scripts/lib/cardEncode.mjs';
import { scoutSelect, scoutInsert, scoutRpc, scoutPatch, scoutDelete } from './scoutDb.js';
import { PARTY_HOST } from './partyHost.js';
import { unlinkGridForCopy, gridLinkOf } from './gridState.js';

const MESSAGE_SYNC = 0;
const SYNC_STEP_1 = 0;
const SYNC_STEP_2 = 1;
const CONNECT_TIMEOUT_MS = 8_000;
const CONFIRM_TIMEOUT_MS = 5_000;
const FLUSH_GRACE_MS = 750;

function roomUnavailable(message) {
  const e = new Error(message);
  e.code = 'room_unavailable';
  return e;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Headless Yjs peer ────────────────────────────────────────────────────────
//
// We speak the y-websocket wire protocol directly rather than using
// y-partykit/provider: the provider is built for a long-lived browser session
// with reconnection and awareness, and we want one short, deterministic
// push-then-leave. Room is the board id on the "main" party, matching
// `new YProvider(PARTY_HOST, boardId, ..., { party: 'main' })` in yPartyKit.js.
//
// Uses the STANDARD WebSocket constructor rather than Cloudflare's
// fetch-with-Upgrade extension, so this file runs unchanged in the Node ingest
// service (Node 22+ ships a global WebSocket). Resolves only once the socket is
// actually open — the caller starts the Yjs handshake immediately and would
// otherwise race the connection.
async function connectPeer(env, boardId, accessToken) {
  const host = env.PARTY_HOST || PARTY_HOST;
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

// Wait until the frame has actually left, rather than sleeping a flat 750ms and
// hoping.
//
// There is no ack for an update in the y-websocket protocol, and the obvious
// substitute — send syncStep1 and wait for the reply — is a trap here: the
// server answers with the diff against OUR state vector, and a doc holding only
// the new cards would be answered with the ENTIRE BOARD. That is precisely the
// transfer this path exists to avoid.
//
// Draining the send buffer is the right barrier instead, because of what the
// room does on receipt: y-partykit's bindState registers an update listener
// that writes straight to Durable Object storage, so an update is durable the
// moment the room applies it — the board_state flush is a second replica, not
// the commit. Messages are ordered and the DO is single-threaded, so once the
// bytes are gone they will be applied.
async function drain(ws, timeoutMs = 5_000) {
  if (typeof ws.bufferedAmount !== 'number') {
    await sleep(FLUSH_GRACE_MS);          // no visibility → the old fixed wait
    return true;
  }
  const t0 = Date.now();
  while (ws.bufferedAmount > 0 && Date.now() - t0 < timeoutMs) await sleep(15);
  if (ws.bufferedAmount > 0) return false;
  await sleep(50);                        // let the last frame land
  return true;
}

// ── Confirming a write ───────────────────────────────────────────────────────
//
// drain() proves the bytes left, not that the room APPLIED them, and they can
// leave and still be lost:
//   - The room treats a connection as read-only unless can_write_board said
//     yes when it connected (party/board.ts isReadOnly), and a check that
//     merely failed reads as no. A read-only connection's updates are dropped
//     without a word (y-partyserver's readSyncMessage).
//   - A Worker's socket may have no bufferedAmount, and drain() then sleeps
//     and says yes regardless.
//   - The room no longer writes an update to storage on receipt (the comment
//     above predates our own party worker): it saves on a debounce, so even an
//     applied update lives only in the room until that save.
// A caller that deletes something next on the strength of a write (the
// sidebar's move takes the cards off the source) needs better than that, so
// it asks the room:
//   1. syncStep1 on the SAME socket, after the update. The room handles one
//      socket's messages in order and answers a step1 at once, so the reply
//      means the update has been dealt with — applied, or dropped.
//   2. A FRESH connection, which the room opens by sending its own state
//      vector. If that vector has reached this doc's own clock, the room's doc
//      holds every change this doc made.
// Only for docs that hold the whole board (openBoard's): the step1 reply is
// the diff against OUR state vector, which is small for a synced doc. A doc
// holding only new cards (appendViaRoom) would be sent the entire board back.
function readFrame(evt) {
  if (evt.data instanceof ArrayBuffer) return new Uint8Array(evt.data);
  if (typeof evt.data === 'string') return null;     // awareness/JSON chatter
  return new Uint8Array(evt.data);
}

// The next syncStep2 on `ws`, after asking for one; false on timeout or close.
function awaitReply(ws, doc, timeoutMs = CONFIRM_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.removeEventListener?.('message', onMessage);
      ws.removeEventListener?.('close', onClose);
      resolve(ok);
    };
    const onMessage = (evt) => {
      const bytes = readFrame(evt);
      if (!bytes) return;
      try {
        const dec = decoding.createDecoder(bytes);
        if (decoding.readVarUint(dec) !== MESSAGE_SYNC) return;
        if (decoding.readVarUint(dec) === SYNC_STEP_2) finish(true);
      } catch (_) { /* not ours */ }
    };
    const onClose = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    try {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(enc, doc);
      ws.send(encoding.toUint8Array(enc));
    } catch (_) { finish(false); }
  });
}

// true / false when the room answered; null when it couldn't be asked.
//
// Two things are checked, because Yjs records them differently:
//   - what this doc ADDED or REPLACED is new items under its own client id, so
//     the room holds it once its state vector reaches this doc's clock;
//   - what it DELETED is not an item at all and leaves no mark on a state
//     vector, so for those the room is asked for what a copy of the doc as it
//     was BEFORE the change lacks. The answer carries the room's whole delete
//     set; applied to that copy, a card the room let go of is gone from it.
async function roomHolds(env, boardId, accessToken, { doc, pre, deleted }) {
  const need = Y.getState(doc.store, doc.clientID);
  if (!need && !deleted.length) return true;     // this doc wrote nothing
  const scratch = new Y.Doc();
  let ws = null;
  try {
    if (deleted.length) Y.applyUpdate(scratch, pre, 'snapshot');
    ws = await connectPeer(env, boardId, accessToken);
    const got = await new Promise((resolve, reject) => {
      const out = { sv: null, diff: !deleted.length };
      const timer = setTimeout(() => reject(new Error('the room did not answer')), CONFIRM_TIMEOUT_MS);
      ws.addEventListener('message', (evt) => {
        const bytes = readFrame(evt);
        if (!bytes) return;
        try {
          const dec = decoding.createDecoder(bytes);
          if (decoding.readVarUint(dec) !== MESSAGE_SYNC) return;
          const step = decoding.readVarUint(dec);
          if (step === SYNC_STEP_1 && !out.sv) out.sv = Y.decodeStateVector(decoding.readVarUint8Array(dec));
          else if (step === SYNC_STEP_2 && !out.diff) {
            Y.applyUpdate(scratch, decoding.readVarUint8Array(dec), 'room');
            out.diff = true;
          }
          if (out.sv && out.diff) { clearTimeout(timer); resolve(out); }
        } catch (_) { /* not ours */ }
      });
      ws.addEventListener('close', () => { clearTimeout(timer); reject(new Error('closed')); });
      if (deleted.length) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeSyncStep1(enc, scratch);
        ws.send(encoding.toUint8Array(enc));
      }
    });
    const added = (got.sv.get(doc.clientID) || 0) >= need;
    const cards = scratch.getMap('cards');
    return added && deleted.every((id) => !cards.has(id));
  } catch (_) {
    return null;
  } finally {
    try { ws?.close(); } catch (_) { /* already gone */ }
    scratch.destroy();
  }
}

// `change` is what commitDoc recorded: the doc before the mutation (encoded)
// and the card ids the mutation deleted.
async function confirmApplied(env, boardId, { ws, doc, accessToken }, change) {
  if (!ws || !accessToken) return false;
  if (!await awaitReply(ws, doc)) return false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const holds = await roomHolds(env, boardId, accessToken, { doc, ...change });
    if (holds !== null) return holds;
  }
  return false;
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
// Append pre-positioned cards WITHOUT ever loading the board.
//
// This is the whole reason bulk ingest is possible. The ordinary path below
// downloads board_state, decodes it, syncs the entire document over a
// WebSocket, re-encodes it and uploads it — to add one card. Production already
// holds a document of 596,720 bytes for two cards (Yjs history tracks total
// edits ever, not current cards), so the Nth write costs O(N) and a Worker
// isolate has 128MB for the four copies that needs. Adding a million cards that
// way is quadratic and dies long before it finishes.
//
// Here the update is built in a FRESH document holding only the new cards. That
// is a valid Yjs update from a different client id, and because every key is a
// new one it merges into the room with no baseline required. Cost is O(batch),
// whatever the board already holds — the 30MB board and the empty one are the
// same call.
//
// Requires: cards already carry x/y (there is nothing to lay out against, since
// we deliberately have not read what is there), and a live room (which now owns
// persisting board_state — see lib/boardStateSync.js). Returns null when the
// room cannot take it, so the caller can fall back rather than leave the cards
// half-written.
async function appendViaRoom(env, { boardId, workspaceId, accessToken, stamped }) {
  if (!accessToken || !stamped.length) return null;

  let ws = null;
  try {
    ws = await connectPeer(env, boardId, accessToken);
  } catch (_) {
    return null;                          // no room → the caller's problem to solve
  }

  try {
    // card_index FIRST, exactly as below: this is where the cap wall lives, and
    // a refusal has to happen before anything reaches the canvas. A cap hit is
    // a real answer and must NOT be retried down the slow path, so it is
    // rethrown rather than turned into a null.
    const indexRows = buildCardIndexRows({ workspaceId, boardId, cards: stamped });
    if (indexRows.length) {
      await scoutInsert(env, 'card_index', indexRows, { onConflict: 'board_id,card_id' });
    }

    const seed = new Y.Doc();
    const map = seed.getMap('cards');
    seed.transact(() => {
      for (const c of stamped) map.set(c.id, cardToYMap(c));
    }, 'scout');
    const delta = Y.encodeStateAsUpdate(seed);
    seed.destroy();

    pushUpdate(ws, delta);
    if (!await drain(ws)) return null;    // never left the buffer → not durable

    return { cards: stamped, live: true, cardCount: null, delta: delta.length };
  } catch (e) {
    if (e?.isCapHit) throw e;
    return null;
  } finally {
    try { ws?.close(); } catch (_) { /* already gone */ }
  }
}

// Stamp ids, z and timestamps without needing to know what is already there.
//
// Ids are UUIDs on this path rather than the `api-<ts>-<rand>` form: the
// collision check the slow path does needs the loaded document, and the whole
// point here is not to load it. 122 bits of randomness is a better guarantee
// than the check it replaces.
function stampForAppend(cards, userId, startZ = 0) {
  const nowIso = new Date().toISOString();
  return cards.map((c, i) => ({
    ...stampCard({ ...c, id: c.id || crypto.randomUUID() }, startZ + i, nowIso),
    createdBy: userId || null,
    updatedBy: userId || null,
  }));
}

//
// requireLive (the sidebar's routes): refuse before writing unless the room is
// live, and treat a push the room doesn't confirm as nothing added — the index
// rows that went in first (for the cap) are taken back out, and board_state is
// left alone. skipExisting: a card whose id the board already holds is left
// as it is and reported in `existing`, rather than landed again under a new
// id — so a retried append, or an Undo that already happened, adds nothing.
// afterInsert(doc, cardYMap, card): fills a card's own nested content (a doc's
// pages) in the same transaction as its insert, as the app's addCard does, so
// the card and what it holds arrive as one. Read-modify-write path only.
export async function addCardsToBoard(env, {
  boardId, workspaceId, userId, accessToken, buildCards, appendCards,
  requireLive = false, skipExisting = false, afterInsert = null,
}) {
  // The O(batch) path, when the caller has already decided where the cards go.
  if (appendCards?.length && !afterInsert) {
    const stamped = stampForAppend(appendCards, userId);
    const fast = await appendViaRoom(env, { boardId, workspaceId, accessToken, stamped });
    if (fast) return fast;
    // The room refused or was unreachable. Fall through to the read-modify-
    // write with the SAME stamped cards, so the ids already written to
    // card_index are the ids that reach the document.
    buildCards = () => stamped;
  }

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
    if (requireLive && !live) throw roomUnavailable('the cluster could not be reached; nothing was added');
    const existing = readCards(doc);
    const cardsMap = doc.getMap('cards');
    let fresh = (await buildCards(existing)) || [];
    const already = skipExisting ? fresh.filter((c) => c.id && cardsMap.has(String(c.id))).map((c) => String(c.id)) : [];
    if (already.length) fresh = fresh.filter((c) => !already.includes(String(c.id)));
    if (!fresh.length) return { cards: [], existing: already, live, cardCount: existing.length };

    const nowIso = new Date().toISOString();

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

    if (!stamped.length) return { cards: [], existing: already, live, cardCount: existing.length };

    // 1. card_index FIRST — this is where the 100-card wall lives. A cap hit
    //    throws here, before anything reaches the user's canvas.
    const indexRows = buildCardIndexRows({ workspaceId, boardId, cards: stamped });
    if (indexRows.length) {
      await scoutInsert(env, 'card_index', indexRows, { onConflict: 'board_id,card_id' });
    }

    // 2. Apply locally, capturing just the delta for the wire. A throw from
    //    afterInsert leaves before anything is pushed or saved; the index rows
    //    that went in first come back out.
    const before = Y.encodeStateVector(doc);
    try {
      doc.transact(() => {
        for (const c of stamped) {
          cardsMap.set(c.id, cardToYMap(c));
          afterInsert?.(doc, cardsMap.get(c.id), c);
        }
      }, 'scout');
    } catch (e) {
      if (indexRows.length) {
        await scoutDelete(env, 'card_index',
          `board_id=eq.${boardId}&card_id=in.${encodeURIComponent(inList(stamped.map((c) => c.id)))}`).catch(() => {});
      }
      throw e;
    }
    const delta = Y.encodeStateAsUpdate(doc, before);

    // 3. Live push, so an open canvas animates them in.
    if (ws) {
      try {
        pushUpdate(ws, delta);
        // Only additions here, so the room's state vector says it all.
        if (requireLive) live = await confirmApplied(env, boardId, { ws, doc, accessToken }, { pre: null, deleted: [] });
        else await drain(ws);          // let the frame leave before we hang up
      } catch (_) { live = false; }
    }
    if (requireLive && !live) {
      await scoutDelete(env, 'card_index',
        `board_id=eq.${boardId}&card_id=in.${encodeURIComponent(inList(stamped.map((c) => c.id)))}`).catch(() => {});
      throw roomUnavailable('the cluster did not take the files; nothing was added');
    }

    // 4. board_state — cold load, history, and the image-ref recompute that
    //    keeps these photos out of the R2 orphan sweep. Never skip this.
    const full = bytesToB64(Y.encodeStateAsUpdate(doc));
    await scoutInsert(env, 'board_state', [{
      board_id: boardId, doc: full, updated_at: new Date().toISOString(),
    }], { onConflict: 'board_id' });

    return { cards: stamped, existing: already, live, cardCount: existing.length + stamped.length };
  } finally {
    try { ws?.close(); } catch (_) { /* already gone */ }
    doc.destroy();
  }
}

// ── Moving cards between boards ──────────────────────────────────────────────
//
// The filing path: cards collected in the Bin move onto a real board and get
// re-arranged as a colour-ordered moodboard. Nothing in the app does this — the
// editor creates and deletes cards but has never moved one between boards — so
// this is the first implementation of the primitive.
//
// WRITE ORDER is the whole design, because there is no transaction spanning two
// Y.Docs and Postgres. We write the DESTINATION first and remove from the SOURCE
// last, which means an interrupted move leaves the card visible on BOTH boards.
// That is the correct failure mode: a duplicate is obvious, harmless and fixable
// by hand, whereas the reverse order can lose a photo outright. It also keeps
// images.referenced_in_board_ids non-empty at every instant, so the R2 orphan
// sweep never sees an unreferenced photo even momentarily.
async function openBoard(env, boardId, accessToken) {
  const doc = new Y.Doc();
  const rows = await scoutSelect(env, 'board_state', `board_id=eq.${boardId}&select=doc`).catch(() => []);
  const baseline = rows?.[0]?.doc;
  // Whether this doc holds the board's real contents. A failed select and a
  // failed sync both leave it empty, which reads exactly like an empty board;
  // a caller that would act on a card's ABSENCE needs to tell them apart.
  let loaded = false;
  if (baseline) {
    try { Y.applyUpdate(doc, b64ToBytes(baseline), 'snapshot'); loaded = true; } catch (_) { /* corrupt → start clean */ }
  }

  let ws = null;
  let live = false;
  if (accessToken) {
    try {
      ws = await connectPeer(env, boardId, accessToken);
      await syncPeer(ws, doc);
      live = true;
      loaded = true;
    } catch (_) {
      try { ws?.close(); } catch (_) { /* already gone */ }
      ws = null;
    }
  }
  return { doc, ws, live, loaded, accessToken };
}

// Commit a doc mutation everywhere: live push then board_state.
//
// `confirm` (the sidebar's routes, which pass requireLive) waits for the room
// to say it holds the change (confirmApplied) and writes board_state only
// then. A room that is up saves its own doc over board_state, so writing a
// change it never took would be erased by its next save, or, if it unloads
// first, brought back later. Unconfirmed, nothing is written, so "nothing
// changed, try again" is the truth.
async function commitDoc(env, boardId, board, mutate, { confirm = false } = {}) {
  const { doc, ws } = board;
  const cards = doc.getMap('cards');
  const pre = confirm ? Y.encodeStateAsUpdate(doc) : null;
  const had = confirm ? [...cards.keys()] : [];
  const before = Y.encodeStateVector(doc);
  doc.transact(mutate, 'scout');
  const delta = Y.encodeStateAsUpdate(doc, before);

  let live = false;
  if (ws) {
    try {
      pushUpdate(ws, delta);
      // drain() says false when the bytes never left the buffer, and a frame
      // that never left was never applied. It can't say more than that; see
      // confirmApplied for what can.
      live = confirm
        ? await confirmApplied(env, boardId, board, { pre, deleted: had.filter((id) => !cards.has(id)) })
        : await drain(ws);
    } catch (_) { live = false; }
  }
  if (confirm && !live) return false;

  await scoutInsert(env, 'board_state', [{
    board_id: boardId, doc: bytesToB64(Y.encodeStateAsUpdate(doc)), updated_at: new Date().toISOString(),
  }], { onConflict: 'board_id' });

  return live;
}

const inList = (ids) => `(${ids.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',')})`;

// Server-side board_versions checkpoint: the PRE-mutation doc, written before
// any destructive API/MCP op. The client writes these 15 different ways;
// agent-driven deletes and moves wrote none — so an agent mistake was
// invisible to the Version-history browser humans recover from. Best-effort:
// a failed checkpoint must never block the operation itself. Service-role
// insert (no RLS concerns); the shared prune keeps 0049's retention.
async function saveVersionRow(env, boardId, doc, { triggerKind = 'api', label = 'api', opSummary = null, userId = null } = {}) {
  try {
    let cardCount = null;
    try { cardCount = doc.getMap('cards').size; } catch (_) {}
    await scoutInsert(env, 'board_versions', [{
      board_id: boardId,
      doc: bytesToB64(Y.encodeStateAsUpdate(doc)),
      card_count: cardCount,
      label,
      trigger_kind: triggerKind,
      op_summary: opSummary,
      made_by: userId || null,
      snapshot_at: new Date().toISOString(),
    }]);
    scoutRpc(env, 'prune_board_versions', { p_board_id: boardId }).catch(() => {});
  } catch (e) {
    console.warn('[scout] saveVersionRow failed', boardId, e?.message || e);
  }
}

// One more try at taking cards off a board, on a fresh connection: the source
// half of a move whose first removal the room didn't confirm.
async function removeFromRoom(env, boardId, accessToken, ids) {
  const board = await openBoard(env, boardId, accessToken);
  try {
    if (!board.live) return false;
    const cards = board.doc.getMap('cards');
    const still = ids.filter((id) => cards.has(id));
    if (!still.length) return true;
    return await commitDoc(env, boardId, board, () => {
      for (const id of still) cards.delete(id);
    }, { confirm: true });
  } finally {
    try { board.ws?.close(); } catch (_) { /* already gone */ }
    board.doc.destroy();
  }
}

// Move `cardIds` from one board to another, re-laid-out by `layout`.
//
//   layout(existingDestCards, movingCards) → positioned cards (same ids)
//   dropIds — cards to DELETE from the source rather than move (an ingest
//             section header whose photos have all just left, for instance)
//
//   requireLive — refuse unless BOTH rooms are live, before the first write,
//             and have each room confirm its half (commitDoc's `confirm`).
//             A board_state write is only safe when no warm room is about to
//             flush over it, and from here that can't be known; the sidebar,
//             which deletes from the source a moment later, would rather be
//             told "try again" than lose the destination copy.
//   keep(card) — true leaves that card where it is (a file still uploading has
//             no bytes to move yet); kept ids come back in `kept`.
//
// Returns { moved, pairs, count, live, droppedHeader, originals, kept }, plus
// `partial: true` (with requireLive) when the cards reached the destination
// but something after that failed: they are then on both boards, and calling
// again with the same ids finishes the move without a second copy.
// `originals` is where each moved card sat on the source, for an undo that
// puts it back exactly.
export async function moveCardsBetweenBoards(env, {
  fromBoardId, toBoardId, workspaceId, userId, accessToken,
  cardIds = [], dropIds = [], layout, requireLive = false, keep = null,
}) {
  if (!cardIds.length || fromBoardId === toBoardId) {
    return { moved: [], count: 0, live: false };
  }

  // Both workspaces, read from the BOARDS rather than taken from the caller.
  //
  // card_index rows carry workspace_id and every consumer joins on it:
  // get_board_capacity sums weights per workspace owner, and the client caches
  // board→workspace as immutable (boardsApi.js:1001). A row left pointing at the
  // source workspace after the move is counted against the wrong person's cap
  // and searched under the wrong workspace.
  //
  // The caller's `workspaceId` was right when source and destination shared a
  // workspace, which was every caller until now. It cannot describe both ends
  // of an adoption (shell account → real account) or of filing into a board
  // found in another workspace, and both are now reachable — so it is used only
  // as a fallback. Deriving these makes the invariant hold whoever calls.
  const wsRows = await scoutSelect(
    env, 'boards', `id=in.${encodeURIComponent(inList([fromBoardId, toBoardId]))}&select=id,workspace_id`,
  ).catch(() => []);
  const wsOf = (id) => wsRows.find((r) => r.id === id)?.workspace_id;
  const fromWorkspaceId = wsOf(fromBoardId) || workspaceId;
  const toWorkspaceId = wsOf(toBoardId) || workspaceId;
  const crossWorkspace = !!fromWorkspaceId && !!toWorkspaceId && fromWorkspaceId !== toWorkspaceId;

  const src = await openBoard(env, fromBoardId, accessToken);
  const dst = await openBoard(env, toBoardId, accessToken);

  try {
    if (requireLive && !(src.live && dst.live)) {
      const e = new Error('a cluster could not be reached, so nothing was moved');
      e.code = 'room_unavailable';
      throw e;
    }

    const srcCards = src.doc.getMap('cards');
    const dstCards = dst.doc.getMap('cards');

    // Only move what's actually there. A card can vanish between the read that
    // built the confirmation and the YES that acts on it.
    const wanted = new Set(cardIds.map(String));
    const present = readCards(src.doc).filter((c) => wanted.has(String(c.id)));
    const kept = keep ? present.filter((c) => keep(c)).map((c) => String(c.id)) : [];
    const keptSet = new Set(kept);
    const moving = present.filter((c) => !keptSet.has(String(c.id)));
    if (!moving.length) return { moved: [], count: 0, live: false, kept };

    // A card THIS move already landed carries movedFrom = this source: a retry
    // after a failure part-way, or after an answer the client never got. It is
    // not landed again (that would rename it and leave two); it only still has
    // to come off the source. Matching the id alone is not enough — a
    // duplicated cluster holds cards with the same ids that are nobody's move.
    const landed = moving.filter((c) => {
      const there = dstCards.get(String(c.id));
      return there instanceof Y.Map && there.get('movedFrom') === String(fromBoardId);
    });
    const landedIds = new Set(landed.map((c) => String(c.id)));
    const toLand = moving.filter((c) => !landedIds.has(String(c.id)));

    const existing = readCards(dst.doc);
    const maxZ = existing.reduce((m, c) => Math.max(m, Number(c.z) || 0), 0);
    const nowIso = new Date().toISOString();
    // A linked grid's layout lives in its cluster's shared templates, and its
    // group in that cluster's groups: neither exists on the destination, so the
    // grid takes its layout along and the card leaves the group (the undo puts
    // both back; `originals` below).
    let srcTemplates = {};
    try { srcTemplates = src.doc.getMap('gridTemplates').toJSON(); } catch (_) { /* none */ }
    const here = {
      hasTemplate: (t) => dst.doc.getMap('gridTemplates').has(t),
      hasSequence: (q) => dst.doc.getMap('gridSequences').has(q),
    };

    // Pre-move checkpoints for BOTH boards (the client's cross-board drag
    // writes pre-drop rows for both sides; the API path wrote neither).
    await saveVersionRow(env, fromBoardId, src.doc, {
      label: 'api',
      opSummary: { action: 'api-move-cards-out', to_board: toBoardId, card_count: moving.length },
    });
    await saveVersionRow(env, toBoardId, dst.doc, {
      label: 'api',
      opSummary: { action: 'api-move-cards-in', from_board: fromBoardId, card_count: moving.length },
    });

    // Re-id anything that would collide on the destination. map.set() on an
    // existing id REPLACES that card, and this is someone else's board.
    const renames = new Map();
    const originalOf = new Map();   // destination id → the id it had here
    const prepared = toLand.map((c, i) => {
      let id = String(c.id);
      let guard = 0;
      while (dstCards.has(id) && guard++ < 10) {
        id = `${c.id}-${Math.random().toString(36).slice(2, 8)}`;
      }
      if (id !== String(c.id)) renames.set(String(c.id), id);
      originalOf.set(id, String(c.id));
      const { groupId: _group, ...rest } = c.kind === 'grid' ? unlinkGridForCopy(c, srcTemplates) : c;
      return {
        ...rest, id, z: maxZ + i + 1, updatedAt: nowIso, updatedBy: userId || null,
        movedFrom: String(fromBoardId),
      };
    }).filter((c) => !dstCards.has(c.id));

    if (!prepared.length && !landed.length) return { moved: [], count: 0, live: false };

    // 1. DESTINATION doc + board_state (nothing to land when a retry finds
    //    every card already there).
    let liveTo = true;
    let droppedHeader = false;
    if (prepared.length) {
      const placed = await layout(existing, prepared, here);
      // A section header the layout invented is a NEW card, so it needs its own
      // card_index row — and that row goes through the cap trigger. At exactly
      // 100 cards the insert fails; the move itself must not fail with it, so we
      // drop the label and keep the photos.
      const movedIds = new Set(prepared.map((c) => c.id));
      const fresh = placed.filter((c) => !movedIds.has(c.id));
      if (fresh.length) {
        try {
          await scoutInsert(env, 'card_index',
            buildCardIndexRows({ workspaceId: toWorkspaceId, boardId: toBoardId, cards: fresh }),
            { onConflict: 'board_id,card_id' });
        } catch (e) {
          if (!e?.isCapHit) throw e;
          droppedHeader = true;
        }
      }
      const finalCards = droppedHeader
        ? placed.filter((c) => !fresh.some((f) => f.id === c.id))
        : placed;

      liveTo = await commitDoc(env, toBoardId, dst, () => {
        for (const c of finalCards) dstCards.set(c.id, cardToYMap(c));
      }, { confirm: requireLive });
      // The destination didn't take them. Confirmed commits write nothing
      // then, so all that is left to undo is a header's index row; the source
      // was never touched. Without requireLive the cards are in board_state
      // and the source keeps its copy: on both boards at worst, never none.
      if (requireLive && !liveTo) {
        if (fresh.length && !droppedHeader) {
          await scoutDelete(env, 'card_index',
            `board_id=eq.${toBoardId}&card_id=in.${encodeURIComponent(inList(fresh.map((c) => c.id)))}`).catch(() => {});
        }
        throw roomUnavailable('the destination cluster did not take the files; nothing was moved');
      }
    }

    const pairs = [
      ...prepared.map((c) => ({ from: originalOf.get(c.id) || String(c.id), to: c.id })),
      ...landed.map((c) => ({ from: String(c.id), to: String(c.id) })),
    ];
    const originals = moving.map((c) => ({
      id: String(c.id),
      x: Number.isFinite(c.x) ? c.x : null,
      y: Number.isFinite(c.y) ? c.y : null,
      unplaced: c.unplaced === true,
      ...(typeof c.groupId === 'string' && c.groupId ? { groupId: c.groupId } : {}),
      ...(c.kind === 'grid' && (c.templateId || c.seqId) ? { link: gridLinkOf(c) } : {}),
    }));
    const result = (extra) => ({
      // `moved` is what landed on the destination in THIS call; `count` and
      // `pairs` include what an earlier attempt landed, since this call
      // finished moving it.
      moved: prepared,
      // Which source id became which destination id, explicitly. `moved` is in
      // BOARD order, not the caller's, and skips ids that were not there, so
      // pairing it with the request by position put one card's identifiers and
      // props on another (2026-10-11 audit, API-07).
      pairs,
      count: pairs.length,
      live: liveTo,
      droppedHeader,
      originals,
      kept,
      ...extra,
    });

    // Past this point the cards are on the destination. Whatever fails now
    // leaves them on BOTH clusters, and a caller that asked for live rooms is
    // told exactly that — `partial`, with the pairs — rather than "nothing
    // changed", so its retry (which finds them landed, above) can finish the
    // job instead of landing a second copy.
    try {
      // 2. card_index follows the cards. One bulk UPDATE for the common case;
      //    renamed ids (vanishingly rare) each need their own. A card an
      //    earlier attempt landed may already have its row moved, which makes
      //    its UPDATE a no-op rather than an error.
      //
      // UPDATE, never DELETE+INSERT: the cap, count and first-card triggers all
      // fire on INSERT or DELETE only, so an update moves a card without
      // consuming cap, without double-counting and without emitting a false
      // "first card" signal (0209's header explains why that matters).
      //
      // 0209 said EVERY trigger on this table was INSERT/DELETE-only. That is no
      // longer true — autotag_card_index now fires `AFTER INSERT OR UPDATE OF
      // title, body`. It stays dormant here only because this patch touches
      // neither column, which is load-bearing rather than incidental: adding
      // title to the SET list would re-run tag matching for every moved card.
      const patch = crossWorkspace
        ? { board_id: toBoardId, workspace_id: toWorkspaceId }
        : { board_id: toBoardId };
      const renamedTo = new Set(renames.values());
      const plain = [...prepared.map((c) => c.id), ...landedIds].filter((id) => !renamedTo.has(id));
      if (plain.length) {
        await scoutPatch(env, 'card_index',
          `board_id=eq.${fromBoardId}&card_id=in.${encodeURIComponent(inList(plain))}`,
          patch);
      }
      for (const [oldId, newId] of renames) {
        await scoutPatch(env, 'card_index',
          `board_id=eq.${fromBoardId}&card_id=eq.${encodeURIComponent(oldId)}`,
          { ...patch, card_id: newId }).catch(() => {});
      }
      if (dropIds.length) {
        await scoutDelete(env, 'card_index',
          `board_id=eq.${fromBoardId}&card_id=in.${encodeURIComponent(inList(dropIds))}`).catch(() => {});
      }

      // 2b. Auto-applied tag links are derived from the SOURCE workspace's tags,
      //     and tags are workspace-scoped. Carried across a workspace boundary
      //     they would claim a card is tagged with something that does not exist
      //     where the card now lives. Drop them; the card is genuinely untagged
      //     in its new workspace until autotag_card_index re-runs on the next
      //     content edit. Only `auto` links — a human-applied link is a judgement,
      //     not derived state, so it is re-pointed rather than discarded.
      if (crossWorkspace) {
        // Keyed on the ORIGINAL ids: a card re-named for a destination collision
        // still appears in entity_links under the id it had here. Scoped to the
        // source workspace too — source_id alone is not unique, and a card id
        // collision across two workspaces, however unlikely, would mean editing
        // a stranger's rows.
        const originalIds = encodeURIComponent(inList(moving.map((c) => String(c.id))));
        const scope = `source_kind=eq.card&source_workspace=eq.${fromWorkspaceId}&source_id=in.${originalIds}`;
        await scoutDelete(env, 'entity_links', `${scope}&source=eq.auto`).catch(() => {});
        await scoutPatch(env, 'entity_links', scope,
          { source_workspace: toWorkspaceId, source_board_id: toBoardId },
        ).catch(() => {});
      }

      // 3. SOURCE doc + board_state, last. Until this lands the cards exist on
      //    both boards, which is the intended failure mode. With requireLive
      //    the source room has to confirm it let them go; a room that didn't
      //    gets one more try on a fresh connection.
      const removeIds = [...moving.map((c) => String(c.id)), ...dropIds.map(String)];
      let liveFrom = await commitDoc(env, fromBoardId, src, () => {
        for (const id of removeIds) srcCards.delete(id);
      }, { confirm: requireLive });
      if (requireLive && !liveFrom) liveFrom = await removeFromRoom(env, fromBoardId, accessToken, removeIds);
      if (requireLive && !liveFrom) {
        return result({ partial: true, reason: 'the source cluster did not let the files go' });
      }
    } catch (e) {
      if (!requireLive) throw e;
      return result({ partial: true, reason: e?.message || String(e) });
    }
    return result({});
  } finally {
    try { src.ws?.close(); } catch (_) { /* already gone */ }
    try { dst.ws?.close(); } catch (_) { /* already gone */ }
    src.doc.destroy();
    dst.doc.destroy();
  }
}

// ── Editing and removing single cards ────────────────────────────────────────
//
// Added for /api/v1, which offers full CRUD. Everything below is the SAME
// triple write as above and must stay that way: a card edited in only the Y.Doc
// reverts on the next cold load, and one deleted from only the Y.Doc leaves a
// card_index row that still counts against the owner's cap and still turns up
// in search.
//
// NOTE ON AUTHORIZATION. These run with the SERVICE ROLE (scoutDb.js bypasses
// RLS), so they do not and cannot check whether the caller may write here. The
// caller must have established that first — /api/v1 does it by calling
// can_write_board as the user before reaching any of this.

// Apply one card's patch in place. A card whose value is not a Y.Map (a legacy
// plain object) cannot be written key by key, so that one is rebuilt whole.
function writeCard(cards, card, fields) {
  const ym = cards.get(String(card.id));
  if (ym && typeof ym.set === 'function' && typeof ym.get === 'function') writeCardFields(ym, fields);
  else cards.set(String(card.id), cardToYMap(card));
}

// Patch one card's fields. Returns the updated card, or null if it is gone.
// Patch MANY cards with one board open.
//
// updateCardOnBoard opens the board, syncs it, commits and closes — perfectly
// reasonable for one card and ruinous for five hundred, which is what a
// re-runnable import does on its second pass. This does the same work once:
// one open, one transaction, one card_index write.
//
// Returns the cards as they now are, in the order the patches were given,
// with a null wherever the card did not exist.
// requireLive (the sidebar's routes): refuse before writing unless the room is
// live, and write board_state and card_index only once it confirms the change.
export async function updateCardsOnBoard(env, {
  boardId, workspaceId, userId, accessToken, patches, requireLive = false,
}) {
  if (!patches?.length) return [];
  const board = await openBoard(env, boardId, accessToken);
  try {
    if (requireLive && !board.live) throw roomUnavailable('the cluster could not be reached; nothing was changed');
    const cards = board.doc.getMap('cards');
    const byId = new Map(readCards(board.doc).map((c) => [String(c.id), c]));
    const stamp = new Date().toISOString();

    const fieldsById = new Map();
    const resolved = patches.map(({ cardId, patch }) => {
      const before = byId.get(String(cardId));
      if (!before) return null;
      const p = typeof patch === 'function' ? (patch(before) || {}) : (patch || {});
      // id can never be patched: it is the key in the Y.Map and in card_index,
      // so changing it here would orphan the index row rather than rename it.
      const { id: _ignored, ...safe } = p;
      const fields = { ...safe, updatedAt: stamp, updatedBy: userId || null };
      fieldsById.set(String(before.id), fields);
      return { ...before, ...fields, id: before.id };
    });

    const changed = resolved.filter(Boolean);
    if (!changed.length) return resolved;

    // One transaction, so collaborators see the batch land as a batch rather
    // than as five hundred separate edits arriving over a second. Fields are
    // written onto each card's existing Y.Map (writeCardFields), never a
    // rebuilt one, so a doc or grid card keeps its live nested content.
    const live = await commitDoc(env, boardId, board, () => {
      for (const c of changed) writeCard(cards, c, fieldsById.get(String(c.id)));
    }, { confirm: requireLive });
    if (requireLive && !live) throw roomUnavailable('the cluster did not take the change; nothing was changed');

    const rows = buildCardIndexRows({ workspaceId, boardId, cards: changed });
    if (rows.length) {
      await scoutInsert(env, 'card_index', rows, { onConflict: 'board_id,card_id' });
    }
    return resolved;
  } finally {
    try { board.ws?.close(); } catch (_) { /* already gone */ }
    board.doc.destroy();
  }
}

// Change what one card holds, where it lives (a doc's pages: lib/docWrite.js),
// through the live room only — a doc open in the app, or its DocParty mirror,
// hears only what the room hears, and a warm room saves its own doc over
// board_state. Refused before anything is written when the room can't be
// reached, and nothing counts as written until the room confirms it.
//
//   prepare(doc, cardYMap) — on the synced board, before any write: checks,
//     and works out the change; a throw leaves everything as it was, and
//     `unchanged: true` in what it returns means there is nothing to write.
//   write(doc, cardYMap, prepared) — the change, inside the one transaction
//     that is pushed; its return value comes back as `result`. The room keeps
//     talking while the checkpoint is saved, so a check that must hold at the
//     moment of writing is made again here, before anything changes.
//   checkpoint — an op_summary: the board goes into Version history first
//     (a rewrite takes words away).
//
// Returns { result, card } (card = the card's plain fields now, for its index
// row), { unchanged: true, card } with nothing written, or { missing: true }
// when the board holds no such card.
export async function editCardLive(env, {
  boardId, userId, accessToken, cardId, prepare = null, write, checkpoint = null,
}) {
  const board = await openBoard(env, boardId, accessToken);
  const plain = (ym) => {
    const card = {};
    ym.forEach((v, k) => {
      if (v === null || typeof v !== 'object' || typeof v.toJSON !== 'function') card[k] = v;
    });
    card.id = String(cardId);
    return card;
  };
  try {
    if (!board.live) throw roomUnavailable('the cluster could not be reached; nothing was written');
    const cards = board.doc.getMap('cards');
    const ym = cards.get(String(cardId));
    if (!ym || typeof ym.get !== 'function') return { missing: true };
    const prepared = prepare ? prepare(board.doc, ym) : null;
    if (prepared?.unchanged) return { unchanged: true, card: plain(ym) };
    if (checkpoint) {
      await saveVersionRow(env, boardId, board.doc, { label: 'api', opSummary: checkpoint, userId });
    }
    let result;
    const live = await commitDoc(env, boardId, board, () => {
      result = write(board.doc, ym, prepared);
      writeCardFields(ym, { updatedAt: new Date().toISOString(), updatedBy: userId || null });
    }, { confirm: true });
    if (!live) throw roomUnavailable('the cluster did not take the change; nothing was written');
    return { result, card: plain(ym) };
  } finally {
    try { board.ws?.close(); } catch (_) { /* already gone */ }
    board.doc.destroy();
  }
}

export async function updateCardOnBoard(env, {
  boardId, workspaceId, userId, accessToken, cardId, patch,
}) {
  const board = await openBoard(env, boardId, accessToken);
  try {
    const cards = board.doc.getMap('cards');
    const before = readCards(board.doc).find((c) => String(c.id) === String(cardId));
    if (!before) return null;

    // `patch` may be a function of the card as it stands. Some fields cannot be
    // resolved without knowing what is already there — an image card keeps its
    // text in `caption` and every other kind in `body`, so a caller handing over
    // "the text" has to be told the kind before that can be turned into a field.
    // Computing it here means one board open rather than a read followed by a
    // write, and no window in between for the card to change kind.
    const resolved = typeof patch === 'function' ? (patch(before) || {}) : (patch || {});

    // id can never be patched: it is the key in the Y.Map and in card_index, so
    // changing it here would orphan the index row rather than rename anything.
    const { id: _ignored, ...safe } = resolved;
    const fields = { ...safe, updatedAt: new Date().toISOString(), updatedBy: userId || null };
    const updated = { ...before, ...fields, id: before.id };

    await commitDoc(env, boardId, board, () => { writeCard(cards, updated, fields); });

    // card_index is a projection of the card, so rebuild the row from the
    // updated card rather than patching columns by hand — that way a new field
    // in buildCardIndexRows is picked up here without anyone remembering to.
    const rows = buildCardIndexRows({ workspaceId, boardId, cards: [updated] });
    if (rows.length) {
      await scoutInsert(env, 'card_index', rows, { onConflict: 'board_id,card_id' });
    }
    return updated;
  } finally {
    try { board.ws?.close(); } catch (_) { /* already gone */ }
    board.doc.destroy();
  }
}

// Remove cards. Returns the cards as they were — the API hands them back as the
// response body, because an HTTP client has no undo toast and the removed card
// is the only thing that can serve as one.
//
// requireLive (the sidebar's routes): refuse unless the room is live, and
// remove the card_index rows only once the room confirms the cards are gone.
// Deleting from a stale board_state while a warm room still holds the cards
// brings them back on its next save, with no index row — unlisted, uncounted.
export async function deleteCardsFromBoard(env, {
  boardId, accessToken, cardIds = [], requireLive = false,
}) {
  if (!cardIds.length) return [];
  const board = await openBoard(env, boardId, accessToken);
  try {
    if (requireLive && !board.live) throw roomUnavailable('the cluster could not be reached; nothing was removed');
    const cards = board.doc.getMap('cards');
    const wanted = new Set(cardIds.map(String));
    const removed = readCards(board.doc).filter((c) => wanted.has(String(c.id)));
    if (!removed.length) return [];

    // Checkpoint the pre-delete state so this shows up (and restores) in the
    // Version-history browser — "the response body IS the undo" now has a
    // server-side safety net behind it too.
    await saveVersionRow(env, boardId, board.doc, {
      label: 'api',
      opSummary: { action: 'api-delete-cards', card_count: removed.length, card_ids: removed.map((c) => String(c.id)).slice(0, 50) },
    });

    const live = await commitDoc(env, boardId, board, () => {
      for (const c of removed) cards.delete(String(c.id));
    }, { confirm: requireLive });
    if (requireLive && !live) throw roomUnavailable('the cluster did not let the files go; nothing was removed');

    // card_index last: while the row survives the card is merely invisible,
    // which is recoverable. Deleting the index first would free cap for a card
    // still sitting on the canvas.
    await scoutDelete(env, 'card_index',
      `board_id=eq.${boardId}&card_id=in.${encodeURIComponent(inList(removed.map((c) => c.id)))}`,
    ).catch(() => {});

    return removed;
  } finally {
    try { board.ws?.close(); } catch (_) { /* already gone */ }
    board.doc.destroy();
  }
}

// Read a board's cards without mutating anything — the confirmation step needs
// to know what's in the Bin before it can ask about it.
export async function readBoardCards(env, boardId, accessToken = null) {
  return (await readBoardCardsChecked(env, boardId, accessToken)).cards;
}

// The same read, saying whether anything was actually loaded. `loaded: false`
// means neither board_state nor the live room answered, so a card missing from
// `cards` proves nothing about whether it exists.
export async function readBoardCardsChecked(env, boardId, accessToken = null) {
  const { doc, ws, loaded } = await openBoard(env, boardId, accessToken);
  try {
    return { cards: readCards(doc), loaded };
  } finally {
    try { ws?.close(); } catch (_) { /* already gone */ }
    doc.destroy();
  }
}

// A board's cards for copying elsewhere. Live content (a doc's pages, a note's
// text, a grid's cells) can only be cloned while its doc is open, so the caller
// does its work inside `use`, and the doc closes after. `templates` are the
// board's shared Grid layouts, for a linked grid leaving it.
export async function withBoardCards(env, boardId, accessToken, use) {
  const { doc, ws, loaded } = await openBoard(env, boardId, accessToken);
  try {
    let templates = {};
    try { templates = doc.getMap('gridTemplates').toJSON(); } catch (_) { /* none */ }
    // `doc` for readers that need more than the cards — a doc card's links
    // live in the board's own links map. Read it; never write through it.
    return await use({ cards: readCards(doc), templates, loaded, doc });
  } finally {
    try { ws?.close(); } catch (_) { /* already gone */ }
    doc.destroy();
  }
}

// ── Groups ───────────────────────────────────────────────────────────────────
//
// A group is the app's way of saying "these cards belong together": it draws a
// labelled outline round them and makes them drag as one. It lives in its own
// top-level Y.Map, and cards point at it by `groupId` — so a group is metadata
// about a set, not a container that owns its members.
//
// The API had no access to any of this, which meant an integration could place
// forty cards and not express that they were one thing.

export async function readBoardGroups(env, boardId, accessToken = null) {
  const board = await openBoard(env, boardId, accessToken);
  try {
    const out = [];
    board.doc.getMap('groups').forEach((v, id) => {
      const g = v && typeof v.toJSON === 'function' ? v.toJSON() : v;
      if (g && typeof g === 'object') out.push({ ...g, id: g.id || id });
    });
    return out.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  } finally {
    try { board.ws?.close(); } catch (_) { /* already gone */ }
    board.doc.destroy();
  }
}

/**
 * Create, patch or remove groups in one board open.
 *
 * `upserts` are whole group records; `removeIds` are ungrouped rather than
 * deleted — the cards pointing at a removed group have their `groupId` cleared
 * in the same transaction, because a card left pointing at a group that no
 * longer exists renders as an untitled outline nobody can select or name.
 */
export async function writeBoardGroups(env, {
  boardId, accessToken, workspaceId, userId, upserts = [], removeIds = [],
}) {
  const board = await openBoard(env, boardId, accessToken);
  try {
    const groups = board.doc.getMap('groups');
    const cards = board.doc.getMap('cards');
    const gone = new Set(removeIds.map(String));
    const orphaned = [];

    if (gone.size) {
      for (const c of readCards(board.doc)) {
        if (c.groupId && gone.has(String(c.groupId))) orphaned.push(c);
      }
    }

    await commitDoc(env, boardId, board, () => {
      for (const g of upserts) {
        const existing = groups.get(String(g.id));
        const before = existing && typeof existing.toJSON === 'function' ? existing.toJSON() : (existing || {});
        groups.set(String(g.id), { ...before, ...g, id: String(g.id) });
      }
      for (const id of gone) groups.delete(String(id));
      for (const c of orphaned) cards.set(String(c.id), cardToYMap({ ...c, groupId: null }));
    });

    // card_index carries groupId/groupName in meta, so ungrouping has to be
    // reprojected or search and the public page keep showing the old grouping.
    if (orphaned.length && workspaceId) {
      const rows = buildCardIndexRows({
        workspaceId,
        boardId,
        cards: orphaned.map((c) => ({ ...c, groupId: null })),
      });
      if (rows.length) await scoutInsert(env, 'card_index', rows, { onConflict: 'board_id,card_id' });
    }

    const out = [];
    board.doc.getMap('groups').forEach((v, id) => {
      const g = v && typeof v.toJSON === 'function' ? v.toJSON() : v;
      if (g && typeof g === 'object') out.push({ ...g, id: g.id || id });
    });
    return { groups: out, ungrouped: orphaned.map((c) => String(c.id)), userId };
  } finally {
    try { board.ws?.close(); } catch (_) { /* already gone */ }
    board.doc.destroy();
  }
}

// Capacity pre-flight. Returns { used, cap, capped, remaining }. Called BEFORE
// any R2 upload so we never spend bytes on a card that will be rejected.
// Takes the user EXPLICITLY. get_board_capacity gates on can_read_board, which
// resolves the caller through auth.uid() — null for a service-role caller, so it
// raised 42501 on every single ingest and the pre-flight never ran. 0216 adds
// the explicit-user mirror; same numbers, same owner-keying, different access
// check. See 0213 §1 for the first instance of this trap.
//
// `is_capped` IS THE GATE — not the number. A paid owner comes back as
// (is_capped=false, used=0, cap=0), which 0216's own header warns about in so
// many words: "reports (false, 0, 0) rather than a number so no caller can
// accidentally treat 'no cap' as 'zero room'". This function did exactly that.
// It special-cased a NULL cap and nothing else, so a paid account resolved to
// cap 0 / remaining 0, and pipeline.js's `if (cap.remaining <= 0)` answered
// every single ingest with "That's the wall — 0/0 cards on your free plan".
//
// Paying for the product therefore turned Scout off completely, and it would
// have looked like a billing bug rather than an ingest one. The app's own
// consumers have always read it correctly (App.jsx:942 gates on `isCapped`);
// only this mirror did not.
export async function boardCapacity(env, boardId, userId) {
  const res = await scoutRpc(env, 'scout_board_capacity', {
    p_board_id: boardId, p_user_id: userId,
  });
  const row = Array.isArray(res) ? res[0] : res;
  const capped = !!row?.is_capped;
  const used = capped ? Number(row?.used ?? 0) : 0;
  const cap = !capped || row?.cap == null ? Infinity : Number(row.cap);
  return {
    used,
    cap,
    capped,
    remaining: cap === Infinity ? Infinity : Math.max(0, cap - used),
  };
}
