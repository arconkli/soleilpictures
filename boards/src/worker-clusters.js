// /api/clusters/* — what the sidebar does to clusters that aren't open.
//
// The sidebar lists every file in every cluster, and lets you move them,
// copy them, upload into a cluster and delete from one, all WITHOUT opening it.
// A browser can only write a cluster whose live doc it holds, so these writes
// happen here instead, through the same triple write the API and Scout use
// (lib/scoutBoard.js: the live room, board_state, card_index). That path joins
// each room as a short-lived peer, so nobody with the cluster open is
// disconnected, card ids survive a move (stars, comments and links with them),
// and card_index is updated rather than reinserted, so a move costs no cap.
//
// AUTH. A signed-in session JWT, exactly as /api/tags/* takes one. scoutBoard
// writes with the service role and so bypasses RLS: every route here asks
// can_write_board AS THE USER first, the app's own predicate (the twin of
// worker-api.js requireBoardWrite), and reads boards as the user so a cluster
// they can't see is a 404, not a write.
//
// v1 keeps every route inside one workspace. Moving a file to another owner's
// workspace changes whose meter it counts against, which the sidebar has no
// way to explain yet.
//
// Dependencies arrive as a parameter so clustersRoute.test.mjs can drive the
// refusals and the bookkeeping without a network.

import { verifyUser } from './lib/workerAuth.js';
import { userRpc, userSelect } from './lib/apiAuth.js';
import {
  moveCardsBetweenBoards, addCardsToBoard, updateCardsOnBoard, deleteCardsFromBoard,
  withBoardCards,
} from './lib/scoutBoard.js';
import { scoutPatch } from './lib/scoutDb.js';
import { repointCardMeta } from './lib/objectMeta.js';
import { isStillUploading } from './lib/abandonedUploads.js';
import { canCopyCard, liveCardForCopy } from './lib/filesDrag.js';
import { canStore, positionUnplaced } from './lib/placement.js';
import { unlinkGridForCopy, relinkGrid } from './lib/gridState.js';
import { layoutDrop } from './lib/layoutEngine.js';
import { answeredWith } from './lib/workerErrors.js';

export const LIMITS = Object.freeze({
  BODY_BYTES: 2_000_000,
  CARD_IDS: 500,
  CARDS: 200,
  CARD_BYTES: 64_000,
});

// What a finished upload may write onto its pending card. Everything a writer
// sends could equally be written through the room, so this is not a privilege
// line; it keeps a confused client from rewriting a card's identity or place.
export const PATCHABLE = new Set([
  'src', 'pdfSrc', 'fileSrc', 'poster', 'w', 'h', 'duration', 'sizeBytes', 'mime', 'ext',
  'fileName', 'name', 'pageCount', 'pending', 'bpm', 'musicalKey', 'alt',
]);

const DEFAULT_DEPS = {
  verifyUser, userRpc, userSelect,
  moveCardsBetweenBoards, addCardsToBoard, updateCardsOnBoard, deleteCardsFromBoard,
  withBoardCards, scoutPatch, repointCardMeta,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

function fail(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function cardIdsOf(raw) {
  if (!Array.isArray(raw)) throw fail(400, 'bad_request', 'cardIds must be an array');
  const ids = [...new Set(raw.map((v) => String(v ?? '').trim()).filter(Boolean))];
  if (!ids.length) throw fail(400, 'bad_request', 'cardIds is empty');
  if (ids.length > LIMITS.CARD_IDS) throw fail(413, 'too_many', `at most ${LIMITS.CARD_IDS} at a time`);
  if (ids.some((id) => id.length > 200)) throw fail(400, 'bad_request', 'a card id is too long');
  return ids;
}

function pointOf(raw) {
  if (raw == null) return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw fail(400, 'bad_request', 'at needs a finite x and y');
  return { x, y };
}

async function boardFor(deps, env, token, boardId) {
  const rows = await deps.userSelect(env, token, 'boards',
    `id=eq.${boardId}&deleted_at=is.null&select=id,workspace_id,name`).catch(() => []);
  return rows?.[0] || null;
}

async function canWrite(deps, env, token, boardId) {
  const ok = await deps.userRpc(env, token, 'can_write_board', { p_board_id: boardId }).catch(() => false);
  return ok === true;
}

// Where moved or copied cards land, decided against what the destination
// already holds:
//   restore  — an undo: each card goes back exactly where it was, in the
//              group it was in, and a grid rejoins the shared layout it
//              left (when that cluster still has it: `hasTemplate`,
//              `hasSequence`, from the destination's doc)
//   at       — dropped on a canvas: laid out at the drop point, on the board
//   neither  — dropped on a cluster in the sidebar: stored off the board, in
//              the free space below its content, like any sidebar upload.
//              A kind that can't be stored off the board (a doc, a grid) is
//              put in that same free space ON the board instead.
// Whether a card is stored is a question about its kind (canStore), never its
// current state: a file already in Files stays there.
export function landCards(existing, cards, { at = null, restore = null, hasTemplate, hasSequence } = {}) {
  const back = new Map((restore || []).map((r) => [String(r.id), r]));
  const rest = cards.filter((c) => !back.has(String(c.id)));
  const restored = cards.filter((c) => back.has(String(c.id))).map((c) => {
    const r = back.get(String(c.id));
    const card = r.link ? relinkGrid(c, r.link, { hasTemplate, hasSequence }) : c;
    return {
      ...card,
      x: Number.isFinite(r.x) ? r.x : c.x,
      y: Number.isFinite(r.y) ? r.y : c.y,
      ...(typeof r.groupId === 'string' && r.groupId ? { groupId: r.groupId } : {}),
      unplaced: r.unplaced === true && canStore(c),
    };
  });
  if (!rest.length) return restored;
  if (at) {
    const allImages = rest.length > 1 && rest.every((c) => c.kind === 'image');
    const laid = layoutDrop(rest, { at, layout: allImages ? 'justified' : 'grid' });
    return [...restored, ...laid.map((c) => ({ ...c, unplaced: false }))];
  }
  const spots = positionUnplaced([...existing, ...restored], rest);
  return [...restored, ...spots.map((c) => ({ ...c, unplaced: canStore(c) }))];
}

// A move takes what hangs off a card with it: comments anchored to it (the
// client's cross-board drop does the same, App.jsx) and every user's star on it.
async function repointExtras(deps, env, { fromBoardId, toBoardId, pairs }) {
  for (const { from, to } of pairs || []) {
    const cardQ = `board_id=eq.${fromBoardId}&anchor_kind=eq.card&anchor_id=eq.${encodeURIComponent(from)}`;
    const starQ = `board_id=eq.${fromBoardId}&card_id=eq.${encodeURIComponent(from)}`;
    await Promise.all([
      deps.scoutPatch(env, 'comments', cardQ, { board_id: toBoardId, anchor_id: String(to) }).catch(() => {}),
      deps.scoutPatch(env, 'starred_items', starQ, { board_id: toBoardId, card_id: String(to) }).catch(() => {}),
    ]);
  }
}

// ...and its file share. Since 0422 a share follows its card only through an
// explicit repoint: duplicated clusters keep card ids, so finding a share's
// card again by id could hand a deleted card's link to its copy. As the user
// (repoint_card_refs checks can_write_board on both ends), every pair, kept ids
// included ({from: X, to: X}): the card changed clusters even where its id
// didn't. The RPC takes at most 500 pairs a call (0420).
const REPOINT_PAIRS = 500;
async function repointRefs(deps, env, token, { fromBoardId, toBoardId, pairs }) {
  const all = pairs || [];
  for (let i = 0; i < all.length; i += REPOINT_PAIRS) {
    await deps.userRpc(env, token, 'repoint_card_refs', {
      p_from: fromBoardId, p_to: toBoardId, p_pairs: all.slice(i, i + REPOINT_PAIRS),
    }).catch(() => {});
  }
}

async function routeMove(deps, env, token, userId, body) {
  if (!isUuid(body.from) || !isUuid(body.to)) throw fail(400, 'bad_request', 'from and to must be cluster ids');
  if (body.from === body.to) throw fail(400, 'bad_request', 'from and to are the same cluster');
  const mode = body.mode === 'copy' ? 'copy' : 'move';
  const cardIds = cardIdsOf(body.cardIds);
  const at = pointOf(body.at);
  const restore = Array.isArray(body.restore) ? body.restore.slice(0, LIMITS.CARD_IDS) : null;

  const [src, dst] = await Promise.all([boardFor(deps, env, token, body.from), boardFor(deps, env, token, body.to)]);
  if (!src || !dst) throw fail(404, 'not_found', 'cluster not found');
  if (src.workspace_id !== dst.workspace_id) {
    throw fail(400, 'cross_workspace', 'files move between clusters in the same workspace');
  }
  const [writeTo, writeFrom] = await Promise.all([
    canWrite(deps, env, token, dst.id),
    mode === 'move' ? canWrite(deps, env, token, src.id) : Promise.resolve(true),
  ]);
  if (!writeTo || !writeFrom) throw fail(403, 'forbidden', 'you cannot edit that cluster');

  if (mode === 'copy') return await routeCopy(deps, env, token, userId, { src, dst, cardIds, at });

  const out = await deps.moveCardsBetweenBoards(env, {
    fromBoardId: src.id,
    toBoardId: dst.id,
    workspaceId: src.workspace_id,
    userId,
    accessToken: token,
    cardIds,
    requireLive: true,
    keep: isStillUploading,
    layout: async (existing, moving, here) => landCards(existing, moving, { at, restore, ...here }),
  });
  // The cards reached the destination but didn't all come off the source.
  // Nothing hanging off them is repointed yet: the same request again finds
  // them landed and finishes the move, repoints included.
  if (out.partial) {
    return json({
      ok: false,
      error: 'partial',
      partial: true,
      retry: true,
      message: 'the files reached the other cluster but are still in this one too; try again to finish',
      pairs: out.pairs || [],
    }, 503);
  }
  if (out.count) {
    await deps.repointCardMeta(env, token, {
      fromBoardId: src.id, toBoardId: dst.id, workspaceId: dst.workspace_id, idPairs: out.pairs || [],
    }).catch(() => {});
    await repointExtras(deps, env, { fromBoardId: src.id, toBoardId: dst.id, pairs: out.pairs });
    await repointRefs(deps, env, token, { fromBoardId: src.id, toBoardId: dst.id, pairs: out.pairs });
  }
  return json({
    ok: true,
    mode,
    moved: out.count || 0,
    pairs: out.pairs || [],
    originals: out.originals || [],
    kept: out.kept || [],
    live: !!out.live,
  });
}

// A copy is a new card on the SAME stored file, pointing back at the original,
// so it uploads nothing and adds no bytes. It does add a card, which is why it
// goes through card_index's cap trigger like any new card (all or nothing: a
// cap hit adds none). Every kind copies but a cluster: the source stays open
// while the copies are written, so content that lives in live Yjs structures
// (a doc's pages and the comments written in them, a note's text, a grid's
// cells) is cloned into the destination (cardToYMap). Comments ON the card,
// its star and its share link stay with the original. A linked grid can't keep
// its shared layout in another cluster, so it takes the layout along.
async function routeCopy(deps, env, token, userId, { src, dst, cardIds, at }) {
  return deps.withBoardCards(env, src.id, token, async ({ cards, templates, loaded }) => {
    if (!loaded) throw fail(503, 'room_unavailable', 'the cluster could not be read; nothing was copied');
    const wanted = new Set(cardIds);
    const picked = cards.filter((c) => wanted.has(String(c.id)));
    const copyable = picked.filter((c) => canCopyCard(c));
    const skipped = picked.filter((c) => !copyable.includes(c)).map((c) => String(c.id));
    if (!copyable.length) return json({ ok: true, mode: 'copy', copied: 0, cards: [], skipped, live: false });

    const out = await deps.addCardsToBoard(env, {
      boardId: dst.id,
      workspaceId: dst.workspace_id,
      userId,
      accessToken: token,
      requireLive: true,
      buildCards: (existing) => landCards(existing, copyable.map((c) => ({
        ...unlinkGridForCopy(liveCardForCopy(c), templates),
        // The slow append path keeps whatever id it is handed (only the room
        // fast path mints one), so a copy brings its own.
        id: globalThis.crypto.randomUUID(),
        w: Number.isFinite(c.w) ? c.w : 240,
        h: Number.isFinite(c.h) ? c.h : 200,
        sourceRef: { boardId: src.id, cardId: String(c.id) },
      })), { at }),
    });
    return json({
      ok: true,
      mode: 'copy',
      copied: out.cards.length,
      cards: out.cards.map((c) => ({ id: String(c.id), sourceCardId: c.sourceRef?.cardId || null })),
      skipped,
      live: !!out.live,
    });
  });
}

// Append cards to a cluster: the pending cards of a sidebar upload (they get
// their bytes through /patch as each file finishes), or the cards an Undo puts
// back after /remove. Cards that arrive with a position keep it; the rest are
// stored off the board in the free space below the content.
async function routeAppend(deps, env, token, userId, body) {
  if (!isUuid(body.boardId)) throw fail(400, 'bad_request', 'boardId must be a cluster id');
  if (!Array.isArray(body.cards) || !body.cards.length) throw fail(400, 'bad_request', 'cards is empty');
  if (body.cards.length > LIMITS.CARDS) throw fail(413, 'too_many', `at most ${LIMITS.CARDS} at a time`);
  for (const c of body.cards) {
    if (!c || typeof c !== 'object' || Array.isArray(c) || typeof c.kind !== 'string') {
      throw fail(400, 'bad_request', 'every card needs a kind');
    }
    if (c.kind === 'board' || c.kind === 'boardlink') throw fail(400, 'bad_request', 'clusters are not cards here');
    if (c.id != null && (typeof c.id !== 'string' || !c.id || c.id.length > 200)) {
      throw fail(400, 'bad_request', 'a card id must be a short string');
    }
    if (JSON.stringify(c).length > LIMITS.CARD_BYTES) throw fail(413, 'too_large', 'a card is too large');
  }
  const board = await boardFor(deps, env, token, body.boardId);
  if (!board) throw fail(404, 'not_found', 'cluster not found');
  if (!await canWrite(deps, env, token, board.id)) throw fail(403, 'forbidden', 'you cannot edit that cluster');

  // skipExisting: an id the cluster already holds was put there by an earlier
  // try of this same request (or the Undo already happened), so it is left
  // alone rather than landed a second time under a new id.
  const out = await deps.addCardsToBoard(env, {
    boardId: board.id,
    workspaceId: board.workspace_id,
    userId,
    accessToken: token,
    requireLive: true,
    skipExisting: true,
    buildCards: (existing) => {
      // An upload names its cards up front (the bytes are filed under that
      // card id); anything that arrives without one gets one here.
      const cards = body.cards.map((c) => ({ ...c, id: c.id ? String(c.id) : globalThis.crypto.randomUUID() }));
      const placed = cards.filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y));
      const loose = cards.filter((c) => !(Number.isFinite(c.x) && Number.isFinite(c.y)));
      return [...placed, ...landCards([...existing, ...placed], loose)];
    },
  });
  return json({
    ok: true,
    cards: out.cards.map((c) => ({ id: String(c.id) })),
    existing: out.existing || [],
    live: !!out.live,
  });
}

async function routePatch(deps, env, token, userId, body) {
  if (!isUuid(body.boardId)) throw fail(400, 'bad_request', 'boardId must be a cluster id');
  if (!Array.isArray(body.patches) || !body.patches.length) throw fail(400, 'bad_request', 'patches is empty');
  if (body.patches.length > LIMITS.CARDS) throw fail(413, 'too_many', `at most ${LIMITS.CARDS} at a time`);
  const patches = body.patches.map((p) => {
    const fields = {};
    for (const [k, v] of Object.entries(p?.fields || {})) if (PATCHABLE.has(k)) fields[k] = v;
    return { cardId: String(p?.id ?? ''), patch: fields };
  }).filter((p) => p.cardId && Object.keys(p.patch).length);
  if (!patches.length) throw fail(400, 'bad_request', 'nothing to change');

  const board = await boardFor(deps, env, token, body.boardId);
  if (!board) throw fail(404, 'not_found', 'cluster not found');
  if (!await canWrite(deps, env, token, board.id)) throw fail(403, 'forbidden', 'you cannot edit that cluster');

  const out = await deps.updateCardsOnBoard(env, {
    boardId: board.id, workspaceId: board.workspace_id, userId, accessToken: token, patches, requireLive: true,
  });
  return json({ ok: true, updated: out.filter(Boolean).length });
}

// The removed cards come back whole: the sidebar's Undo hands them to /append.
async function routeRemove(deps, env, token, userId, body) {
  if (!isUuid(body.boardId)) throw fail(400, 'bad_request', 'boardId must be a cluster id');
  const cardIds = cardIdsOf(body.cardIds);
  const board = await boardFor(deps, env, token, body.boardId);
  if (!board) throw fail(404, 'not_found', 'cluster not found');
  if (!await canWrite(deps, env, token, board.id)) throw fail(403, 'forbidden', 'you cannot edit that cluster');
  const removed = await deps.deleteCardsFromBoard(env, {
    boardId: board.id, accessToken: token, cardIds, requireLive: true,
  });
  return json({ ok: true, removed });
}

const ROUTES = {
  '/api/clusters/move': routeMove,
  '/api/clusters/append': routeAppend,
  '/api/clusters/patch': routePatch,
  '/api/clusters/remove': routeRemove,
};

export async function handleClustersRoute(url, request, env, deps = DEFAULT_DEPS) {
  try {
    const route = ROUTES[url.pathname];
    if (!route) throw fail(404, 'not_found', 'no such route');
    if (request.method !== 'POST') throw fail(405, 'method_not_allowed', 'POST only');
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > LIMITS.BODY_BYTES) throw fail(413, 'too_large', 'request too large');

    const auth = await deps.verifyUser(request, env);
    if (!auth?.ok) throw fail(auth?.status || 401, 'unauthorized', auth?.error || 'sign in first');
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

    const text = await request.text();
    if (text.length > LIMITS.BODY_BYTES) throw fail(413, 'too_large', 'request too large');
    let body;
    try { body = JSON.parse(text || '{}'); } catch (_) { throw fail(400, 'bad_request', 'body must be JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'bad_request', 'body must be an object');

    return await route(deps, env, token, auth.userId, body);
  } catch (e) {
    if (e?.isCapHit) {
      return json({ ok: false, error: 'limit_reached', message: 'that would go past the card limit' }, 402);
    }
    if (e?.code === 'room_unavailable') {
      return json({ ok: false, error: 'room_unavailable', message: e.message, retry: true }, 503);
    }
    if (e?.status) return json({ ok: false, error: e.code, message: e.message }, e.status);
    console.warn('[clusters] route failed', url.pathname, e?.message || e);
    answeredWith(request, e);
    // Not "nothing was changed": an unexpected failure can come after a write.
    return json({ ok: false, error: 'server_error', message: 'something went wrong' }, 500);
  }
}
