// /api/v1 — the public API.
//
// One person, one token, everything they can already do in the app. Built so a
// script, an integration or an AI assistant can read and write boards without
// pretending to be a browser.
//
// AUTHORIZATION IS NOT DONE HERE. A token resolves to a user (apiAuth.js), and
// every metadata read and write goes to PostgREST as THAT USER under ordinary
// RLS. There is no allowlist of what a token may touch, because there does not
// need to be: the policies that protect the app protect this. See the header of
// lib/apiAuth.js.
//
// The ONE exception is card mutation. Cards live in a Yjs document, not in a
// table, so writing them means the triple write in lib/scoutBoard.js — which
// runs with the service role and therefore bypasses RLS. Every route that
// touches cards calls requireBoardWrite() first, which asks can_write_board AS
// THE USER. That is the product's own predicate, so it cannot drift from what
// the app enforces, and it is one function rather than a check per endpoint.
//
// THE TRIPLE WRITE IS NOT OPTIONAL. Cards go to the live Y.Doc, board_state and
// card_index. Skipping card_index loses search and the cap; skipping
// board_state means the R2 orphan sweep eventually deletes the user's images.
// An endpoint that writes fewer than three places is data loss, not a degraded
// response.

import * as Y from 'yjs';
import {
  resolveApiToken, hasScope, apiUserSession,
  userSelect, userRpc, userInsert, userPatch,
} from './lib/apiAuth.js';
import { scoutRpc, scoutDelete } from './lib/scoutDb.js';
import {
  addCardsToBoard, moveCardsBetweenBoards, readBoardCards,
  updateCardOnBoard, deleteCardsFromBoard,
} from './lib/scoutBoard.js';
import { arrangeExisting } from './lib/scoutCards.js';
import { bytesToB64 } from './lib/yhelpers.js';

const MAX_CARDS_PER_CALL = 100;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,idempotency-key',
  'access-control-max-age': '86400',
};

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...extra },
});

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

// What a card looks like over the wire. The Y.Doc holds plenty of interior
// state (per-kind geometry, editor scratch) that no API consumer should learn
// to depend on, so this names the fields instead of spreading the card.
//
// Exported, with normalizeIncomingCard below, because together they are the
// entire boundary between a stranger's JSON and everyone's Y.Doc. That is worth
// testing directly rather than through a route.
export function publicCard(c) {
  return {
    id: c.id,
    kind: c.kind || 'note',
    x: c.x, y: c.y, w: c.w, h: c.h, z: c.z,
    title: c.title ?? null,
    body: c.body ?? c.caption ?? null,
    html: c.html ?? null,
    url: c.url ?? null,
    image_key: c.key ?? null,
    color: c.color ?? null,
    created_at: c.createdAt ?? null,
    updated_at: c.updatedAt ?? null,
  };
}

function publicBoard(b) {
  return {
    id: b.id,
    name: b.name,
    workspace_id: b.workspace_id,
    parent_board_id: b.parent_board_id,
    view: b.view,
    created_at: b.created_at,
    updated_at: b.updated_at ?? null,
  };
}

// ── Authorization for card writes ────────────────────────────────────────────
//
// can_write_board is the app's own predicate, evaluated as the user. It walks
// the parent chain and honours workspace membership, editor shares and the
// waitlist gate — none of which this file should be re-deriving.
async function requireBoardWrite(env, token, boardId) {
  const ok = await userRpc(env, token, 'can_write_board', { p_board_id: boardId })
    .catch(() => false);
  if (ok !== true) {
    const err = new Error('you cannot write to that board');
    err.status = 403;
    throw err;
  }
}

// The workspace a board belongs to, read AS THE USER — so a board they cannot
// see comes back as "not found" rather than leaking its existence.
async function boardForUser(env, token, boardId) {
  const rows = await userSelect(
    env, token, 'boards',
    `id=eq.${boardId}&deleted_at=is.null&select=id,name,workspace_id,parent_board_id,view,created_at`,
  );
  return rows?.[0] || null;
}

// ── Routes ───────────────────────────────────────────────────────────────────

export async function handleApiRoute(url, request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const auth = await resolveApiToken(request, env);
  if (!auth.ok) {
    return json({ error: auth.error }, auth.status, auth.status === 401
      ? { 'www-authenticate': 'Bearer realm="soleil", error="invalid_token"' }
      : {});
  }

  const writing = request.method !== 'GET';
  if (writing && !hasScope(auth, 'write')) {
    return json({ error: 'this token is read-only' }, 403);
  }
  if (!writing && !hasScope(auth, 'read') && !hasScope(auth, 'write')) {
    return json({ error: 'this token cannot read' }, 403);
  }

  // Replay protection. Claimed BEFORE the work so two deliveries of the same
  // retry cannot both proceed; the response is stored after, and replayed
  // verbatim thereafter. Only for POST — PATCH and DELETE here are already
  // idempotent by construction, and GET has nothing to replay.
  const idemKey = request.method === 'POST'
    ? (request.headers.get('idempotency-key') || '').slice(0, 200)
    : '';
  if (idemKey) {
    const rows = await scoutRpc(env, 'api_idempotency_claim', {
      p_token_id: auth.tokenId, p_key: idemKey,
    }).catch(() => null);
    const claim = (Array.isArray(rows) ? rows : [rows])?.[0];
    if (claim && claim.claimed === false) {
      if (claim.response) {
        return json(claim.response, claim.status || 200, { 'idempotent-replay': 'true' });
      }
      // Claimed but never completed: the first attempt is still running or died
      // mid-flight. Saying "in progress" is honest; replaying an empty success
      // would tell the caller work happened that may not have.
      return json({ error: 'a request with this Idempotency-Key is still in progress' }, 409);
    }
  }

  let token;
  try {
    token = await apiUserSession(env, auth.userId);
  } catch (e) {
    return json({ error: 'could not open a session for that account' }, 502);
  }

  let res;
  try {
    res = await dispatch(url, request, env, { auth, token });
  } catch (e) {
    const status = e?.status || 500;
    if (status >= 500) console.error('[api]', request.method, url.pathname, e?.message);
    res = json({ error: status >= 500 ? 'something went wrong on our end' : e.message }, status);
  }

  if (idemKey) {
    if (res.status < 500) {
      // 2xx and 4xx are both settled answers: the same request would produce
      // the same result, so replaying is right and saves the caller from
      // creating something twice.
      const body = await res.clone().json().catch(() => null);
      await scoutRpc(env, 'api_idempotency_store', {
        p_token_id: auth.tokenId, p_key: idemKey, p_response: body, p_status: res.status,
      }).catch(() => {});
    } else {
      // A 5xx is exactly the case a retry is FOR. Leaving the key claimed would
      // pin it as "in progress" forever and make that key permanently unusable,
      // so release it and let the client try again.
      await scoutDelete(env, 'api_idempotency',
        `token_id=eq.${auth.tokenId}&key=eq.${encodeURIComponent(idemKey)}`).catch(() => {});
    }
  }
  return res;
}

async function dispatch(url, request, env, ctx) {
  const { auth, token } = ctx;
  const parts = url.pathname.replace(/^\/api\/v1\/?/, '').replace(/\/$/, '').split('/').filter(Boolean);
  const [head, id, sub, subId] = parts;
  const method = request.method;

  const body = method === 'GET' || method === 'DELETE'
    ? {}
    : await request.json().catch(() => ({}));

  // GET /  — the first thing anyone curls. Answering with the route list beats
  // answering with "unknown endpoint" for the one URL a person types by hand.
  if (!head && method === 'GET') {
    return json({
      version: 'v1',
      docs: 'https://github.com/arconkli/soleilpictures/blob/main/docs/API.md',
      endpoints: [
        'GET    /me',
        'GET    /workspaces',
        'GET    /boards?workspace=&parent=',
        'POST   /boards',
        'GET    /boards/:id',
        'PATCH  /boards/:id',
        'DELETE /boards/:id',
        'GET    /boards/:id/cards',
        'POST   /boards/:id/cards',
        'PATCH  /boards/:id/cards/:cardId',
        'DELETE /boards/:id/cards/:cardId',
        'POST   /boards/:id/cards/move',
      ],
    });
  }

  // GET /me
  if (head === 'me' && method === 'GET') {
    const rows = await userSelect(env, token, 'profiles',
      `user_id=eq.${auth.userId}&select=user_id,display_name,tier`);
    const p = rows?.[0] || {};
    return json({
      user_id: auth.userId,
      display_name: p.display_name ?? null,
      tier: p.tier ?? 'demo',
      scopes: auth.scopes,
    });
  }

  // GET /workspaces
  if (head === 'workspaces' && method === 'GET') {
    const rows = await userSelect(env, token, 'workspaces', 'select=id,name,created_at&order=created_at.asc');
    return json({ workspaces: rows.map((w) => ({ id: w.id, name: w.name, created_at: w.created_at })) });
  }

  if (head !== 'boards') return json({ error: 'unknown endpoint' }, 404);

  // ── /boards ────────────────────────────────────────────────────────────────
  if (!id) {
    if (method === 'GET') {
      const ws = url.searchParams.get('workspace');
      const parent = url.searchParams.get('parent');
      let q = 'deleted_at=is.null&select=id,name,workspace_id,parent_board_id,view,created_at'
            + '&order=created_at.asc&limit=500';
      if (ws) {
        if (!isUuid(ws)) return json({ error: 'workspace must be a uuid' }, 400);
        q += `&workspace_id=eq.${ws}`;
      }
      if (parent === 'root') q += '&parent_board_id=is.null';
      else if (parent) {
        if (!isUuid(parent)) return json({ error: 'parent must be a uuid or "root"' }, 400);
        q += `&parent_board_id=eq.${parent}`;
      }
      const rows = await userSelect(env, token, 'boards', q);
      return json({ boards: rows.map(publicBoard) });
    }

    if (method === 'POST') {
      const name = String(body.name || '').trim();
      if (!name) return json({ error: 'name is required' }, 400);
      let workspaceId = body.workspace_id;
      if (workspaceId && !isUuid(workspaceId)) return json({ error: 'workspace_id must be a uuid' }, 400);
      if (!workspaceId) {
        const ws = await userRpc(env, token, 'get_or_create_personal_workspace',
          { p_user_id: auth.userId, p_name: 'Personal' });
        workspaceId = (Array.isArray(ws) ? ws[0] : ws)?.id;
      }
      if (!workspaceId) return json({ error: 'could not resolve a workspace' }, 400);
      if (body.parent_board_id && !isUuid(body.parent_board_id)) {
        return json({ error: 'parent_board_id must be a uuid' }, 400);
      }

      // The id is generated HERE rather than by the database, for the reason
      // boardsApi.js:684 documents: INSERT…RETURNING re-runs the boards SELECT
      // policy, which cannot see the row it is inserting, so Postgres reports a
      // misleading RLS violation for an insert it actually allowed.
      const boardId = crypto.randomUUID();
      await userInsert(env, token, 'boards', [{
        id: boardId,
        workspace_id: workspaceId,
        parent_board_id: body.parent_board_id || null,
        name: name.slice(0, 200),
        view: body.view === 'list' ? 'list' : 'canvas',
        created_by: auth.userId,
      }], { returning: 'minimal' });

      // Seed the empty snapshot, exactly as createBoard does — a board with no
      // board_state row loads as broken rather than as empty.
      const doc = new Y.Doc();
      const b64 = bytesToB64(Y.encodeStateAsUpdate(doc));
      doc.destroy();
      await userInsert(env, token, 'board_state',
        [{ board_id: boardId, doc: b64, updated_at: new Date().toISOString() }],
        { returning: 'minimal' });

      const created = await boardForUser(env, token, boardId);
      return json({ board: publicBoard(created || { id: boardId, name, workspace_id: workspaceId }) }, 201);
    }

    return json({ error: 'method not allowed' }, 405);
  }

  if (!isUuid(id)) return json({ error: 'board id must be a uuid' }, 400);

  // ── /boards/:id ────────────────────────────────────────────────────────────
  if (!sub) {
    if (method === 'GET') {
      const b = await boardForUser(env, token, id);
      if (!b) return json({ error: 'board not found' }, 404);
      return json({ board: publicBoard(b) });
    }

    if (method === 'PATCH') {
      const b = await boardForUser(env, token, id);
      if (!b) return json({ error: 'board not found' }, 404);

      // Reparenting goes through move_boards_under and NOWHERE else. It is the
      // single authoritative write path for parent_board_id (0118) and the only
      // thing that checks for cycles — a board made its own ancestor detaches
      // that whole subtree from every view in the app.
      if ('parent_board_id' in body) {
        const target = body.parent_board_id;
        if (target && !isUuid(target)) return json({ error: 'parent_board_id must be a uuid or null' }, 400);
        const out = await userRpc(env, token, 'move_boards_under',
          { p_child_ids: [id], p_target_id: target || null });
        const skipped = out?.skipped?.[0];
        if (skipped) return json({ error: `could not reparent: ${skipped.reason}` }, 409);
      }

      const patch = {};
      if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 200);
      if (body.view === 'list' || body.view === 'canvas') patch.view = body.view;
      if (Object.keys(patch).length) {
        await userPatch(env, token, 'boards', `id=eq.${id}`, patch);
      }

      const after = await boardForUser(env, token, id);
      return json({ board: publicBoard(after) });
    }

    if (method === 'DELETE') {
      const b = await boardForUser(env, token, id);
      if (!b) return json({ error: 'board not found' }, 404);
      // SOFT delete, through the app's own soft_delete_board — not a hand-written
      // UPDATE. An API that destroys someone's board harder, or differently,
      // than their own UI does is a trap; going through the same RPC means the
      // Trash and restore paths keep working on whatever this leaves behind.
      //
      // Descendants are deliberately NOT touched, matching the app: this marks
      // one board, and children remain reachable by id.
      await userRpc(env, token, 'soft_delete_board', { p_board_id: id });
      return json({ deleted: true, board: publicBoard(b), restorable: true });
    }

    return json({ error: 'method not allowed' }, 405);
  }

  if (sub !== 'cards') return json({ error: 'unknown endpoint' }, 404);

  // ── /boards/:id/cards ──────────────────────────────────────────────────────
  const board = await boardForUser(env, token, id);
  if (!board) return json({ error: 'board not found' }, 404);

  if (!subId && method === 'GET') {
    const cards = await readBoardCards(env, id, null);
    return json({ board_id: id, cards: cards.map(publicCard) });
  }

  // Everything below mutates cards, so it takes the explicit route: the Y.Doc
  // path runs as service role and RLS will not save us here.
  if (method !== 'GET') await requireBoardWrite(env, token, id);

  // POST /boards/:id/cards — append
  if (!subId && method === 'POST') {
    const incoming = Array.isArray(body.cards) ? body.cards : [body];
    if (!incoming.length) return json({ error: 'cards is required' }, 400);
    if (incoming.length > MAX_CARDS_PER_CALL) {
      return json({ error: `at most ${MAX_CARDS_PER_CALL} cards per call` }, 400);
    }

    const result = await addCardsToBoard(env, {
      boardId: id,
      workspaceId: board.workspace_id,
      userId: auth.userId,
      accessToken: token,
      buildCards: async (existing) => {
        const built = incoming.map((c) => normalizeIncomingCard(c));
        // Positioned by the same helper Scout uses, so cards arriving from an
        // API call cannot land on top of what is already there. A caller that
        // supplied explicit x/y keeps them.
        const needsLayout = built.filter((c) => !Number.isFinite(c.x) || !Number.isFinite(c.y));
        const placed = needsLayout.length
          ? arrangeExisting({ existingCards: existing, cards: needsLayout })
          : [];
        const byId = new Map(placed.map((c) => [c.id, c]));
        // Every card must leave here with real coordinates. stampCard sets z and
        // timestamps but NOT x/y, so an unpositioned card would reach the Y.Doc
        // with undefined geometry — and one NaN card poisons boundsOfCards() for
        // the whole board, scattering everything the user already had. Dropping
        // it is the only safe answer; the response reports what actually landed.
        return built
          .map((c) => byId.get(c.id) || c)
          .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y));
      },
    });

    return json({
      board_id: id,
      cards: result.cards.map(publicCard),
      // Honest about what happened: false means the cards are durable but an
      // already-open canvas will not show them until it reloads.
      live: result.live,
    }, 201);
  }

  // /boards/:id/cards/move
  if (subId === 'move' && method === 'POST') {
    const to = body.to_board_id;
    if (!isUuid(to)) return json({ error: 'to_board_id must be a uuid' }, 400);
    const cardIds = (Array.isArray(body.card_ids) ? body.card_ids : []).map(String).filter(Boolean);
    if (!cardIds.length) return json({ error: 'card_ids is required' }, 400);

    const dest = await boardForUser(env, token, to);
    if (!dest) return json({ error: 'destination board not found' }, 404);
    await requireBoardWrite(env, token, to);

    const out = await moveCardsBetweenBoards(env, {
      fromBoardId: id,
      toBoardId: to,
      workspaceId: board.workspace_id,
      userId: auth.userId,
      accessToken: token,
      cardIds,
      layout: async (existing, moving) => arrangeExisting({ existingCards: existing, cards: moving }),
    });
    return json({ moved: out.count, cards: out.moved.map(publicCard), live: out.live });
  }

  if (!subId) return json({ error: 'method not allowed' }, 405);

  // PATCH /boards/:id/cards/:cardId
  if (method === 'PATCH') {
    const updated = await updateCardOnBoard(env, {
      boardId: id,
      workspaceId: board.workspace_id,
      userId: auth.userId,
      accessToken: token,
      cardId: subId,
      patch: normalizeIncomingCard(body, { partial: true }),
    });
    if (!updated) return json({ error: 'card not found' }, 404);
    return json({ card: publicCard(updated) });
  }

  // DELETE /boards/:id/cards/:cardId
  if (method === 'DELETE') {
    const removed = await deleteCardsFromBoard(env, {
      boardId: id, accessToken: token, cardIds: [subId],
    });
    if (!removed.length) return json({ error: 'card not found' }, 404);
    // The removed card comes back in full. There is no undo toast on an HTTP
    // call, so the response body IS the undo: POST it back to restore it.
    return json({ deleted: true, card: publicCard(removed[0]), restore_with: 'POST /api/v1/boards/:id/cards' });
  }

  return json({ error: 'method not allowed' }, 405);
}

// Map the wire shape onto a card. Deliberately narrow: an API caller should not
// be able to set arbitrary interior fields on a card and have them persisted
// into everyone's Y.Doc.
export function normalizeIncomingCard(input, { partial = false } = {}) {
  const c = input || {};
  const kind = ['note', 'image', 'link', 'doc'].includes(c.kind) ? c.kind : 'note';
  const out = partial ? {} : {
    id: `api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    w: Number.isFinite(c.w) ? clampSize(c.w) : 280,
    h: Number.isFinite(c.h) ? clampSize(c.h) : 180,
  };
  if (!partial || 'kind' in c) out.kind = kind;
  if ('title' in c) out.title = str(c.title, 300);
  if ('body' in c) out.body = str(c.body, 20000);
  if ('html' in c) out.html = str(c.html, 40000);
  if ('url' in c) out.url = str(c.url, 2000);
  if ('image_key' in c) out.key = str(c.image_key, 500);
  if ('color' in c) out.color = str(c.color, 40);
  if (Number.isFinite(c.x)) out.x = Math.round(c.x);
  if (Number.isFinite(c.y)) out.y = Math.round(c.y);
  if (Number.isFinite(c.w)) out.w = clampSize(c.w);
  if (Number.isFinite(c.h)) out.h = clampSize(c.h);
  return out;
}

const str = (v, max) => (v == null ? null : String(v).slice(0, max));
// A card 200,000px wide is not a card, it is a way to make someone's board
// unusable from the outside.
const clampSize = (n) => Math.max(40, Math.min(Math.round(n), 4000));
