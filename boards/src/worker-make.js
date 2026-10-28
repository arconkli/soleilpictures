// worker-make.js — keeping a board made from a /make link.
//
//   POST /api/make/keep
//   authorization: Bearer <the person's own session>
//   { source, kind: 'link' | 'text', pictures: [{ width, height } | null],
//     workspace_id?, fit? }
//
// An AI without the Clusters app writes a board into a /make link
// (lib/makeLink.js), and the page shows it from the link alone, before anyone
// signs in (pages/MakePage.jsx). Keeping it is this: the link read again with
// the same reader, the same board worked out from it at the sizes the page
// drew its pictures (lib/makeBoard.js), its pictures fetched and stored as an
// import stores them, and its cards written through the API's own card route
// as the person (callApiAs), so the card cap, sections and webhooks are the
// ones every caller meets. A picture the page showed that can't be fetched now
// is left out, and the board laid out again without it.
//
// It goes into the workspace asked for (where the person may add clusters),
// else their own, as a cluster under the workspace's root. Over the card cap
// nothing is made: the answer says how much room there is, and `fit` keeps the
// first cards that fit. The link's text is read here and kept as the board;
// it is never logged, and events carry counts alone.
import { parseMakeSource, MAKE } from './lib/makeLink.js';
import { composeMakeBoard } from './lib/makeBoard.js';
import { verifyUserToken } from './lib/workerAuth.js';
import { userRpc, userSelect } from './lib/apiAuth.js';
import { makeEdgeLimiter } from './lib/edgeLimits.js';
import { mapWithConcurrency, IMPORT_CONCURRENCY } from './lib/importManifest.js';
import { reportWorkerError } from './lib/workerErrors.js';
import { callApiAs, storePictureFrom } from './worker-api.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The source, its pictures' sizes and a little room.
const MAX_BODY = MAKE.maxSource * 4 + 8192;
// Roles that may add a cluster to a workspace.
const ADDS_CLUSTERS = new Set(['owner', 'co_owner', 'editor']);

const keepAllow = makeEdgeLimiter('MAKE_KEEP');

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}
const clientIp = (request) => request.headers.get('cf-connecting-ip') || 'unknown';
const bearer = (request) => (request.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/i)?.[1] || null;
const first = (rows) => (Array.isArray(rows) ? rows[0] : rows) || null;

// The page's sizes for the link's pictures, in order: { width, height } for
// one it drew, null for one it couldn't.
export function readPictureSizes(list, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = Array.isArray(list) ? list[i] : null;
    const width = Number(d?.width);
    const height = Number(d?.height);
    const ok = width > 0 && height > 0 && width <= 100_000 && height <= 100_000;
    out.push(ok ? { width: Math.round(width), height: Math.round(height) } : null);
  }
  return out;
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// The workspace the board goes in, and its root: the one asked for when the
// person may add clusters there, else their own (made now for an account
// that has never opened the app, as its first open would).
async function workspaceFor(env, who, asked) {
  let workspaceId = null;
  if (asked) {
    const rows = await userSelect(env, who.token, 'workspace_members',
      `workspace_id=eq.${asked}&user_id=eq.${who.userId}&select=role`);
    if (!ADDS_CLUSTERS.has(first(rows)?.role)) return null;
    workspaceId = asked;
  } else {
    const ws = first(await userRpc(env, who.token, 'get_or_create_personal_workspace',
      { p_user_id: who.userId, p_name: 'Personal Workspace' }));
    workspaceId = ws?.id || null;
  }
  if (!workspaceId) return null;
  const roots = await userSelect(env, who.token, 'boards',
    `workspace_id=eq.${workspaceId}&parent_board_id=is.null&deleted_at=is.null&select=id&order=created_at.asc&limit=1`);
  const rootId = first(roots)?.id || null;
  return rootId ? { workspaceId, rootId } : null;
}

// Cards the workspace's owner has room for: Infinity when uncapped.
async function roomIn(env, who, boardId) {
  const cap = first(await userRpc(env, who.token, 'get_board_capacity', { p_board_id: boardId }));
  if (!cap?.is_capped || cap.cap == null) return Infinity;
  return Math.max(0, Number(cap.cap) - Number(cap.used || 0));
}

export async function handleMakeKeep(url, request, env, ctx) {
  if (request.method !== 'POST') {
    return json({ error: 'POST the board to keep', code: 'method_not_allowed' }, 405, { allow: 'POST' });
  }
  const gate = await keepAllow(env, clientIp(request));
  if (!gate.ok) {
    return json({ error: 'too many boards kept just now', code: 'rate_limited' }, 429, { 'retry-after': String(gate.retryAfter) });
  }
  const token = bearer(request);
  const me = token ? await verifyUserToken(env, token).catch(() => null) : null;
  if (!me?.ok) return json({ error: 'sign in to keep this board', code: 'unauthorized' }, 401);
  const who = { userId: me.userId, token };

  const body = await readBody(request);
  if (!body || typeof body.source !== 'string') {
    return json({ error: 'send the link or text the board was made from', code: 'bad_request' }, 400);
  }
  const board = parseMakeSource(body.source, { kind: body.kind === 'text' ? 'text' : 'link' });
  if (!board.count) return json({ error: 'there is nothing in it to keep', code: 'empty' }, 400);
  const asked = typeof body.workspace_id === 'string' && UUID_RE.test(body.workspace_id) ? body.workspace_id : null;
  let sizes = readPictureSizes(body.pictures, board.pictures);

  let place;
  try {
    place = await workspaceFor(env, who, asked);
  } catch (error) {
    reportWorkerError(env, ctx, { kind: 'api', error, status: 503, code: 'make_keep_failed', op: 'make_workspace' });
    return json({ error: 'it couldn’t be kept just now', code: 'temporarily_unavailable' }, 503, { 'retry-after': '5' });
  }
  if (!place) return json({ error: 'you can’t add clusters to that workspace', code: 'forbidden' }, 403);

  // What the page showed, and whether it fits.
  let made = composeMakeBoard(board, { pictures: sizes });
  const room = await roomIn(env, who, place.rootId).catch(() => Infinity);
  let max = Infinity;
  if (made.cards.length > room) {
    if (body.fit !== true || room <= 0) {
      return json({ error: 'that is more cards than this account has room for', code: 'limit_reached', room, needed: made.cards.length }, 402);
    }
    max = room;
    made = composeMakeBoard(board, { pictures: sizes, max });
  }

  const call = (path, opts) => callApiAs(url.origin, env, ctx, who, path, opts);
  let created;
  try {
    created = await call('/boards', {
      method: 'POST', body: { name: made.name, workspace_id: place.workspaceId, parent_board_id: place.rootId },
    });
  } catch (error) {
    return refused(env, ctx, error, 'make_board');
  }
  const boardId = created?.board?.id || created?.id;
  if (!boardId) return refused(env, ctx, new Error('no board came back'), 'make_board');

  try {
    // The pictures, stored as the person; one that fails is left out, and the
    // board is laid out again without it. Under a card limit a card further on
    // takes its place, a picture perhaps: that one is fetched in the next round.
    const target = { id: boardId, workspace_id: place.workspaceId };
    const pics = flatPictures(board);
    const tried = new Map();
    for (let round = 0; round < 3; round++) {
      const want = made.wire.filter((c) => c.pic != null && !tried.has(c.pic)).map((c) => c.pic);
      if (!want.length) break;
      await mapWithConcurrency(want, IMPORT_CONCURRENCY, async (i) => {
        tried.set(i, await storePictureFrom(env, who, target, pics[i].url));
      });
      const failed = want.filter((i) => !tried.get(i)?.ok);
      if (!failed.length) break;
      for (const i of failed) sizes[i] = null;
      made = composeMakeBoard(board, { pictures: sizes, max });
    }
    // A picture not stored by now stays out.
    if (sizes.some((d, i) => d && !tried.get(i)?.ok && made.wire.some((c) => c.pic === i))) {
      sizes = sizes.map((d, i) => (d && tried.get(i)?.ok ? d : null));
      made = composeMakeBoard(board, { pictures: sizes, max });
    }
    const failedHere = [...tried.values()].filter((r) => !r?.ok).length;
    const cards = made.wire.map(({ pic, ...c }) => (pic == null ? c : { ...c, image_key: tried.get(pic).imageKey }));
    if (cards.length) {
      await call(`/boards/${boardId}/cards`, { method: 'POST', body: { cards, groups: made.wireGroups } });
    }
    return json({
      board: { id: boardId, name: made.name, url: `${url.origin}/?to=b:${boardId}` },
      workspace_id: place.workspaceId,
      cards: cards.length,
      // Pictures the page showed that couldn't be copied in, and cards past
      // the account's room.
      pictures_failed: failedHere,
      over: made.over,
      room_left: Number.isFinite(room) ? Math.max(0, room - cards.length) : null,
    }, 201);
  } catch (error) {
    // Half a board is worse than none: what was made goes to the trash.
    await call(`/boards/${boardId}`, { method: 'DELETE' }).catch(() => {});
    return refused(env, ctx, error, 'make_cards');
  }
}

function flatPictures(board) {
  return board.sections.flatMap((s) => s.items).filter((i) => i.kind === 'picture');
}

function refused(env, ctx, error, op) {
  const status = Number(error?.status) || 500;
  if (status === 402 || error?.code === 'limit_reached') {
    return json({ error: 'that is more than this account has room for', code: 'limit_reached' }, 402);
  }
  if (status === 403 || status === 404) {
    return json({ error: 'you can’t add clusters there', code: 'forbidden' }, 403);
  }
  reportWorkerError(env, ctx, { kind: 'api', error, status: 503, code: 'make_keep_failed', op });
  return json({ error: 'it couldn’t be kept just now', code: 'temporarily_unavailable' }, 503, { 'retry-after': '5' });
}
