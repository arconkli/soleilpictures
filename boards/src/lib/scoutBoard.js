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
import { scoutSelect, scoutInsert, scoutRpc, scoutPatch, scoutDelete } from './scoutDb.js';

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

export async function addCardsToBoard(env, {
  boardId, workspaceId, userId, accessToken, buildCards, appendCards,
}) {
  // The O(batch) path, when the caller has already decided where the cards go.
  if (appendCards?.length) {
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
        await drain(ws);               // let the frame leave before we hang up
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
  if (baseline) {
    try { Y.applyUpdate(doc, b64ToBytes(baseline), 'snapshot'); } catch (_) { /* corrupt → start clean */ }
  }

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
  return { doc, ws, live };
}

// Commit a doc mutation everywhere: live push then board_state.
async function commitDoc(env, boardId, { doc, ws }, mutate) {
  const before = Y.encodeStateVector(doc);
  doc.transact(mutate, 'scout');
  const delta = Y.encodeStateAsUpdate(doc, before);

  let live = false;
  if (ws) {
    try {
      pushUpdate(ws, delta);
      await drain(ws);
      live = true;
    } catch (_) { /* durable write below still happens */ }
  }

  await scoutInsert(env, 'board_state', [{
    board_id: boardId, doc: bytesToB64(Y.encodeStateAsUpdate(doc)), updated_at: new Date().toISOString(),
  }], { onConflict: 'board_id' });

  return live;
}

const inList = (ids) => `(${ids.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',')})`;

// Move `cardIds` from one board to another, re-laid-out by `layout`.
//
//   layout(existingDestCards, movingCards) → positioned cards (same ids)
//   dropIds — cards to DELETE from the source rather than move (an ingest
//             section header whose photos have all just left, for instance)
//
// Returns { moved, count, live, droppedHeader }.
export async function moveCardsBetweenBoards(env, {
  fromBoardId, toBoardId, workspaceId, userId, accessToken,
  cardIds = [], dropIds = [], layout,
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
    const srcCards = src.doc.getMap('cards');
    const dstCards = dst.doc.getMap('cards');

    // Only move what's actually there. A card can vanish between the read that
    // built the confirmation and the YES that acts on it.
    const wanted = new Set(cardIds.map(String));
    const moving = readCards(src.doc).filter((c) => wanted.has(String(c.id)));
    if (!moving.length) return { moved: [], count: 0, live: false };

    const existing = readCards(dst.doc);
    const maxZ = existing.reduce((m, c) => Math.max(m, Number(c.z) || 0), 0);
    const nowIso = new Date().toISOString();

    // Re-id anything that would collide on the destination. map.set() on an
    // existing id REPLACES that card, and this is someone else's board.
    const renames = new Map();
    const prepared = moving.map((c, i) => {
      let id = String(c.id);
      let guard = 0;
      while (dstCards.has(id) && guard++ < 10) {
        id = `${c.id}-${Math.random().toString(36).slice(2, 8)}`;
      }
      if (id !== String(c.id)) renames.set(String(c.id), id);
      return { ...c, id, z: maxZ + i + 1, updatedAt: nowIso, updatedBy: userId || null };
    }).filter((c) => !dstCards.has(c.id));

    if (!prepared.length) return { moved: [], count: 0, live: false };

    const placed = await layout(existing, prepared);
    // A section header the layout invented is a NEW card, so it needs its own
    // card_index row — and that row goes through the cap trigger. At exactly
    // 100 cards the insert fails; the move itself must not fail with it, so we
    // drop the label and keep the photos.
    const movedIds = new Set(prepared.map((c) => c.id));
    const fresh = placed.filter((c) => !movedIds.has(c.id));
    let droppedHeader = false;
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

    // 1. DESTINATION doc + board_state.
    const liveTo = await commitDoc(env, toBoardId, dst, () => {
      for (const c of finalCards) dstCards.set(c.id, cardToYMap(c));
    });

    // 2. card_index follows the cards. One bulk UPDATE for the common case;
    //    renamed ids (vanishingly rare) each need their own.
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
    const plain = prepared.map((c) => c.id).filter((id) => !renamedTo.has(id));
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
    //    both boards, which is the intended failure mode.
    const removeIds = [...moving.map((c) => String(c.id)), ...dropIds.map(String)];
    await commitDoc(env, fromBoardId, src, () => {
      for (const id of removeIds) srcCards.delete(id);
    });

    return {
      moved: prepared,
      count: prepared.length,
      live: liveTo,
      droppedHeader,
    };
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
export async function updateCardsOnBoard(env, {
  boardId, workspaceId, userId, accessToken, patches,
}) {
  if (!patches?.length) return [];
  const board = await openBoard(env, boardId, accessToken);
  try {
    const cards = board.doc.getMap('cards');
    const byId = new Map(readCards(board.doc).map((c) => [String(c.id), c]));
    const stamp = new Date().toISOString();

    const resolved = patches.map(({ cardId, patch }) => {
      const before = byId.get(String(cardId));
      if (!before) return null;
      const p = typeof patch === 'function' ? (patch(before) || {}) : (patch || {});
      // id can never be patched: it is the key in the Y.Map and in card_index,
      // so changing it here would orphan the index row rather than rename it.
      const { id: _ignored, ...safe } = p;
      return { ...before, ...safe, id: before.id, updatedAt: stamp, updatedBy: userId || null };
    });

    const changed = resolved.filter(Boolean);
    if (!changed.length) return resolved;

    // One transaction, so collaborators see the batch land as a batch rather
    // than as five hundred separate edits arriving over a second.
    await commitDoc(env, boardId, board, () => {
      for (const c of changed) cards.set(String(c.id), cardToYMap(c));
    });

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
    const updated = {
      ...before, ...safe, id: before.id,
      updatedAt: new Date().toISOString(),
      updatedBy: userId || null,
    };

    await commitDoc(env, boardId, board, () => { cards.set(String(cardId), cardToYMap(updated)); });

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
export async function deleteCardsFromBoard(env, {
  boardId, accessToken, cardIds = [],
}) {
  if (!cardIds.length) return [];
  const board = await openBoard(env, boardId, accessToken);
  try {
    const cards = board.doc.getMap('cards');
    const wanted = new Set(cardIds.map(String));
    const removed = readCards(board.doc).filter((c) => wanted.has(String(c.id)));
    if (!removed.length) return [];

    await commitDoc(env, boardId, board, () => {
      for (const c of removed) cards.delete(String(c.id));
    });

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
  const { doc, ws } = await openBoard(env, boardId, accessToken);
  try {
    return readCards(doc);
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
