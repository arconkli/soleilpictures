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
//
// SCOPES (0220). read · write · delete. The split exists because the primary
// consumer is an MCP server handing tools to a language model, and "may add
// cards" and "may destroy a board" are not the same trust decision. The rule is
// mechanical — GET needs read, DELETE needs delete, everything else needs write
// — so a new route cannot accidentally land in a weaker bucket.

import * as Y from 'yjs';
import {
  resolveApiToken, hasScope, apiUserSession, rateHeaders, normalizeApiError,
  userSelect, userRpc, userInsert, userPatch,
} from './lib/apiAuth.js';
import { scoutRpc, scoutDelete } from './lib/scoutDb.js';
import {
  addCardsToBoard, moveCardsBetweenBoards, readBoardCards,
  updateCardOnBoard, deleteCardsFromBoard,
} from './lib/scoutBoard.js';
import { arrangeExisting } from './lib/scoutCards.js';
import { bytesToB64 } from './lib/yhelpers.js';
import { imageDimensions, extensionFor } from './lib/imageDims.js';
import { openapiDocument } from './lib/apiOpenapi.js';

const MAX_CARDS_PER_CALL = 100;
// Workers cap a request body well above this; the limit that matters is that a
// single call should not be able to spend someone's whole storage allowance in
// one go, and that we hold the whole thing in memory to hash its header.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;

// The kinds the API models. The app has more (palette, schedule, grid, video,
// audio, pdf, board) and every one of them carries structured interior state
// that the wire format does not describe — so they are readable but not
// creatable, rather than creatable and broken.
const CARD_KINDS = ['note', 'image', 'link', 'doc'];

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,idempotency-key',
  'access-control-expose-headers':
    'x-ratelimit-limit,x-ratelimit-remaining,x-ratelimit-reset,retry-after,'
    + 'idempotent-replay,x-image-variant',
  'access-control-max-age': '86400',
};

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...extra },
});

// Every refusal carries a stable `code` alongside its human `error`, so a client
// can branch without string-matching prose that may be reworded.
function fail(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

function withHeaders(res, extra) {
  if (!extra || !Object.keys(extra).length) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// ── The wire format ──────────────────────────────────────────────────────────
//
// publicCard and normalizeIncomingCard together are the entire boundary between
// a stranger's JSON and everyone's Y.Doc. They are exported and tested directly
// rather than through a route, because a route test would exercise them
// incidentally and prove less.

// An image card's bytes are referenced by `src: "r2:<key>"` — NOT by `key`.
// That is what lib/scoutCards.js writes, what buildCardMeta projects and what
// cards.jsx resolves to a signed URL. The first version of this file read and
// wrote `card.key`, a field nothing in the app looks at, so an image card
// created through the API rendered blank and an existing one read back with a
// null image_key. Both directions go through these two helpers now.
const keyFromSrc = (src) =>
  (typeof src === 'string' && src.startsWith('r2:') ? src.slice(3) : null);

// One text field per kind. Image cards keep their text in `caption`
// (cards.jsx's ImageCard, onUpdate({ caption })); everything else uses `body`.
// Reading mapped caption→body already, but writing always went to `body`, so a
// read-modify-write on an image card returned 200 and changed nothing the app
// would ever display. The wire has ONE name for the text of a card; this is
// where it is translated, in both directions.
const textFieldFor = (kind) => (kind === 'image' ? 'caption' : 'body');
const textOf = (c) => (c.kind === 'image'
  ? (c.caption ?? c.body ?? null)
  : (c.body ?? c.caption ?? null));

export function publicCard(c) {
  return {
    id: c.id,
    kind: c.kind || 'note',
    x: c.x, y: c.y, w: c.w, h: c.h, z: c.z,
    title: c.title ?? null,
    body: textOf(c),
    html: c.html ?? null,
    url: c.url ?? c.link ?? null,
    image_key: keyFromSrc(c.src),
    alt: c.alt ?? null,
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
    deleted: !!b.deleted_at,
    created_at: b.created_at,
    updated_at: b.updated_at ?? null,
  };
}

// Map the wire shape onto a card. Deliberately narrow: an API caller should not
// be able to set arbitrary interior fields on a card and have them persisted
// into everyone's Y.Doc.
//
// `existingKind` matters on a patch: the text field a value lands in depends on
// what kind of card it is, and a patch that does not mention `kind` is still a
// patch to a card that has one.
export function normalizeIncomingCard(input, { partial = false, existingKind = null } = {}) {
  const c = input || {};

  // An unrecognised kind is REFUSED, not coerced. Coercion is right for an
  // absent value (a default) and wrong for a present one: silently turning
  // {"kind":"schedule"} into a note tells the caller they made a schedule card
  // when they did not, and on a PATCH it turns an image card into a note and
  // drops the picture.
  let kind;
  if (c.kind != null) {
    if (!CARD_KINDS.includes(c.kind)) {
      throw fail(400, 'bad_request',
        `kind must be one of ${CARD_KINDS.join(', ')} — got ${JSON.stringify(String(c.kind).slice(0, 40))}`);
    }
    kind = c.kind;
  } else {
    kind = partial ? (existingKind || 'note') : 'note';
  }

  const out = partial ? {} : {
    id: `api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    w: Number.isFinite(c.w) ? clampSize(c.w) : 280,
    h: Number.isFinite(c.h) ? clampSize(c.h) : 180,
  };
  if (!partial || c.kind != null) out.kind = kind;

  if ('title' in c) out.title = str(c.title, 300);
  if ('body' in c) out[textFieldFor(kind)] = str(c.body, 20000);
  if ('html' in c) out.html = str(c.html, 40000);
  if ('url' in c) out.url = str(c.url, 2000);
  if ('alt' in c) out.alt = str(c.alt, 300);
  // Stored as the app stores it. A bare key here would be a card that renders
  // nothing at all.
  if ('image_key' in c) {
    const k = str(c.image_key, 500);
    out.src = k ? `r2:${k}` : null;
  }
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

// ── PostgREST filter escaping ────────────────────────────────────────────────
//
// `or=(title.ilike.…,body.ilike.…)` is parsed from the DECODED query string, so
// percent-encoding a comma does NOT protect it — the transport decodes %2C back
// to a comma before PostgREST ever sees it, and the filter silently means
// something else. (Same class as the `+`-decodes-to-a-space trap found while
// testing handles.) Double-quoting is the mechanism that does work: inside
// quotes, commas and parens are literal and only \" and \\ are special.
//
// Two escaping layers, in this order, and the order is the whole trick:
//   1. LIKE metacharacters (% _ \) so a search for "100%" is not a wildcard;
//   2. PostgREST's own quoting, which doubles the backslashes layer 1 added.
// Unquoting then hands Postgres exactly one backslash, which is its LIKE escape.
export function pgLikeValue(q) {
  const escaped = String(q).replace(/[\\%_]/g, (m) => `\\${m}`);
  const pattern = `%${escaped}%`;
  return `"${pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// ── Authorization for card writes ────────────────────────────────────────────
//
// can_write_board is the app's own predicate, evaluated as the user. It walks
// the parent chain and honours workspace membership, editor shares and the
// waitlist gate — none of which this file should be re-deriving.
async function requireBoardWrite(env, token, boardId) {
  const ok = await userRpc(env, token, 'can_write_board', { p_board_id: boardId })
    .catch(() => false);
  if (ok !== true) throw fail(403, 'forbidden', 'you cannot write to that board');
}

// The workspace a board belongs to, read AS THE USER — so a board they cannot
// see comes back as "not found" rather than leaking its existence.
async function boardForUser(env, token, boardId, { includeDeleted = false } = {}) {
  const q = `id=eq.${boardId}${includeDeleted ? '' : '&deleted_at=is.null'}`
    + '&select=id,name,workspace_id,parent_board_id,view,created_at,deleted_at';
  const rows = await userSelect(env, token, 'boards', q);
  return rows?.[0] || null;
}

function pageParams(url) {
  const rawLimit = Number(url.searchParams.get('limit'));
  const rawOffset = Number(url.searchParams.get('offset'));
  return {
    limit: Math.max(1, Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_PAGE, MAX_PAGE)),
    offset: Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0),
  };
}

// Fetch one more row than asked for and drop it. One round trip tells us both
// the page and whether there is another — a count query would cost a second
// scan to answer a question the first one already knows.
function paginate(rows, limit, offset) {
  const has_more = rows.length > limit;
  return { items: has_more ? rows.slice(0, limit) : rows, limit, offset, has_more };
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function handleApiRoute(url, request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  // The spec answers before authentication on purpose: a machine-readable
  // description of a public API that you need a credential to read is not
  // discoverable, and it describes only the shape, never anyone's data.
  if (url.pathname === '/api/v1/openapi.json') {
    return json(openapiDocument(url.origin), 200, { 'cache-control': 'public, max-age=3600' });
  }

  const t0 = Date.now();
  const auth = await resolveApiToken(request, env);
  if (!auth.ok) {
    return json({ error: auth.error, code: auth.code }, auth.status, {
      ...rateHeaders(auth.rate, { retryAfter: auth.status === 429 }),
      ...(auth.status === 401
        ? { 'www-authenticate': 'Bearer realm="soleil", error="invalid_token"' }
        : {}),
    });
  }

  // Sent on every response, not only refusals. A client that can only learn its
  // budget by being rejected has to hit the wall to find it.
  const rl = rateHeaders(auth.rate);

  const need = request.method === 'GET' ? 'read'
    : request.method === 'DELETE' ? 'delete'
      : 'write';
  if (!hasScope(auth, need)) {
    return json({
      error: need === 'delete'
        ? 'this token cannot delete — mint one with the delete scope if that was the intent'
        : `this token cannot ${need}`,
      code: 'insufficient_scope',
      required_scope: need,
      scopes: auth.scopes,
    }, 403, rl);
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
        return json(claim.response, claim.status || 200, { ...rl, 'idempotent-replay': 'true' });
      }
      // Claimed but never completed: the first attempt is still running or died
      // mid-flight. Saying "in progress" is honest; replaying an empty success
      // would tell the caller work happened that may not have.
      return json({
        error: 'a request with this Idempotency-Key is still in progress',
        code: 'idempotency_in_progress',
      }, 409, rl);
    }
  }

  // Everything from here on must fall through to the idempotency bookkeeping
  // below, so failures set `res` rather than returning. An early return past a
  // CLAIMED key leaves it pinned as "in progress" forever, and every retry of
  // that key then gets a 409 — which is exactly backwards, since a failure here
  // is the case a retry exists for. Found by a session failure doing precisely
  // that during end-to-end testing.
  const trace = { route: url.pathname.replace(/^\/api\/v1/, '') || '/', target: null };
  let res;
  try {
    const token = await apiUserSession(env, auth.userId).catch((e) => {
      // Distinguished from a route failure so the caller is told the account
      // could not be opened, rather than a generic 500 they cannot act on.
      const err = fail(502, 'session_unavailable', 'could not open a session for that account');
      err.cause = e;
      throw err;
    });
    res = await dispatch(url, request, env, { auth, token, trace });
  } catch (e) {
    // EVERY error leaves through normalizeApiError. Returning `e.message`
    // directly is what put the raw PostgREST envelope — table name, SQLSTATE
    // and all — into the response for the most common failure in the product
    // (the card cap), because card mutations throw from lib/scoutDb.js and
    // never touched the curation in restError.
    const { status, code, message } = normalizeApiError(e);
    if (status >= 500) {
      console.error('[api]', request.method, url.pathname, e?.message, e?.detail || e?.cause?.message || '');
    }
    res = json({ error: message, code }, status);
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

  // Writes only (0220). Reads are the bulk of API traffic and logging them
  // would be noise; the rows worth keeping are the ones that changed something.
  // Off the response path via waitUntil — an audit write must never be what
  // makes someone's request slow, or what fails it.
  if (request.method !== 'GET' && auth.tokenId) {
    const write = scoutRpc(env, 'api_log_request', {
      p_token_id: auth.tokenId,
      p_user_id: auth.userId,
      p_method: request.method,
      p_route: trace.route,
      p_status: res.status,
      p_ms: Date.now() - t0,
      p_target: trace.target,
    }).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(write);
  }

  return withHeaders(res, rl);
}

async function dispatch(url, request, env, ctx) {
  const { auth, token, trace } = ctx;
  const parts = url.pathname.replace(/^\/api\/v1\/?/, '').replace(/\/$/, '').split('/').filter(Boolean);
  const [head, id, sub, subId] = parts;
  const method = request.method;

  // Uploads carry raw bytes, so the body must not be parsed as JSON.
  const isUpload = head === 'uploads';
  const body = (method === 'GET' || method === 'DELETE' || isUpload)
    ? {}
    : await request.json().catch(() => ({}));

  // GET /  — the first thing anyone curls. Answering with the route list beats
  // answering with "unknown endpoint" for the one URL a person types by hand.
  if (!head && method === 'GET') {
    return json({
      version: 'v1',
      // The published docs, not a GitHub blob: an agent that curls this should
      // get somewhere it can keep reading, including the .md twin of every page.
      docs: `${url.origin}/docs/api`,
      llms: `${url.origin}/llms.txt`,
      openapi: `${url.origin}/api/v1/openapi.json`,
      scopes: auth.scopes,
      endpoints: [
        'GET    /me',
        'GET    /workspaces',
        'GET    /search?q=&kind=&workspace=&limit=&offset=',
        'GET    /boards?workspace=&parent=&deleted=&limit=&offset=',
        'POST   /boards',
        'GET    /boards/:id',
        'PATCH  /boards/:id',
        'DELETE /boards/:id',
        'POST   /boards/:id/restore',
        'GET    /boards/:id/cards?limit=&offset=',
        'POST   /boards/:id/cards',
        'PATCH  /boards/:id/cards/:cardId',
        'DELETE /boards/:id/cards/:cardId',
        'POST   /boards/:id/cards/move',
        'POST   /uploads?board=:id',
        'GET    /images/:key',
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
      rate_limit: {
        limit: auth.rate?.limit ?? null,
        remaining: auth.rate ? Math.max(0, auth.rate.limit - auth.rate.used) : null,
        reset: auth.rate?.reset ?? null,
      },
    });
  }

  // GET /workspaces
  if (head === 'workspaces' && method === 'GET') {
    const rows = await userSelect(env, token, 'workspaces', 'select=id,name,created_at&order=created_at.asc');
    return json({ workspaces: rows.map((w) => ({ id: w.id, name: w.name, created_at: w.created_at })) });
  }

  // GET /search — the endpoint an assistant needs most: find the board about X
  // without reading every board.
  //
  // Built on `boards` and `card_index` directly, NOT on the entity_search view.
  // That view also unions workspace_user_directory(), which carries member
  // EMAIL ADDRESSES in its body column — searching it with a read-only token
  // would make this an email-harvesting endpoint. (It also types a board's body
  // as jsonb, so ilike on it is wrong anyway.)
  if (head === 'search' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) throw fail(400, 'bad_request', 'q must be at least 2 characters');
    const { limit, offset } = pageParams(url);
    const ws = url.searchParams.get('workspace');
    if (ws && !isUuid(ws)) throw fail(400, 'bad_request', 'workspace must be a uuid');
    const kind = url.searchParams.get('kind');           // 'board' | 'card' | null
    const wsFilter = ws ? `&workspace_id=eq.${ws}` : '';
    const value = pgLikeValue(q);

    const wantBoards = kind !== 'card';
    const wantCards = kind !== 'board';

    const [boardRows, cardRows] = await Promise.all([
      wantBoards
        ? userSelect(env, token, 'boards',
          `name=ilike.${encodeURIComponent(value)}&deleted_at=is.null${wsFilter}`
          + `&select=id,name,workspace_id,parent_board_id,view,created_at,deleted_at`
          + `&order=created_at.desc&limit=${limit + 1}&offset=${offset}`)
        : Promise.resolve([]),
      wantCards
        ? userSelect(env, token, 'card_index',
          `or=${encodeURIComponent(`(title.ilike.${value},body.ilike.${value})`)}${wsFilter}`
          + `&select=board_id,card_id,kind,title,body,workspace_id,updated_at`
          + `&order=updated_at.desc&limit=${limit + 1}&offset=${offset}`)
        : Promise.resolve([]),
    ]);

    const boards = paginate(boardRows, limit, offset);
    const cards = paginate(cardRows, limit, offset);
    return json({
      query: q,
      boards: { ...boards, items: boards.items.map(publicBoard) },
      cards: {
        ...cards,
        items: cards.items.map((r) => ({
          board_id: r.board_id,
          card_id: r.card_id,
          kind: r.kind,
          title: r.title ?? null,
          // Enough to recognise a hit, not the whole card. Fetch the board for
          // the rest — a search that returns full bodies is a search that
          // cannot be run against a large workspace.
          excerpt: r.body ? String(r.body).slice(0, 300) : null,
          workspace_id: r.workspace_id,
          updated_at: r.updated_at,
        })),
      },
    });
  }

  // POST /uploads?board=<uuid> — raw bytes in, an image key out.
  //
  // Straight to R2 through the Worker's own binding: no presign, no PartyKit
  // round trip and no new credential, because wrangler.toml already binds this
  // Worker to the same bucket the app uploads into. One call, which is what
  // makes it usable from a tool call rather than a three-step S3 dance.
  if (head === 'uploads' && method === 'POST') {
    const boardId = url.searchParams.get('board');
    if (!isUuid(boardId)) throw fail(400, 'bad_request', 'pass ?board=<uuid> — an upload is charged to a board');
    trace.route = '/uploads';
    trace.target = boardId;

    const board = await boardForUser(env, token, boardId);
    if (!board) throw fail(404, 'not_found', 'board not found');
    await requireBoardWrite(env, token, boardId);

    const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = extensionFor(contentType);
    if (!ext) {
      throw fail(415, 'unsupported_media_type',
        'send an image with its Content-Type set (jpeg, png, gif, webp, heic, avif)');
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) throw fail(400, 'bad_request', 'the request body was empty');
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw fail(413, 'payload_too_large',
        `images are limited to ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB through the API`);
    }
    if (!env.IMAGES) throw fail(503, 'storage_unavailable', 'image storage is not available right now');

    // The owner-pays byte ceiling, asked AS THE USER — the same gate the
    // browser upload path runs (party/upload.ts). A null verdict is an RPC
    // failure, and fails open exactly as it does there.
    const verdictRows = await userRpc(env, token, 'authorize_image_upload',
      { p_board_id: boardId, p_bytes: bytes.length }).catch(() => null);
    const verdict = Array.isArray(verdictRows) ? verdictRows[0] : verdictRows;
    if (verdict && verdict.allow !== true && verdict.reason === 'over_quota') {
      throw fail(402, 'limit_reached', 'that would go past the storage included with this account');
    }

    // Same key shape the rest of the system mints: workspace-prefixed, random,
    // extension from the declared type. The prefix is what scopes storage to a
    // workspace (0218), so it is derived from the board and never from input.
    const key = `${board.workspace_id}/${crypto.randomUUID()}.${ext}`;
    await env.IMAGES.put(key, bytes, { httpMetadata: { contentType } });

    const dims = imageDimensions(bytes);
    try {
      // The images row is LOAD-BEARING, not bookkeeping: it is what authorizes
      // reads, and what keeps the R2 orphan sweep from reclaiming the object.
      // An upload that skips it is an image that quietly dies in 30 days.
      await userInsert(env, token, 'images', [{
        workspace_id: board.workspace_id,
        board_id: boardId,
        storage_path: key,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        size_bytes: bytes.length,
        uploaded_by: auth.userId,
      }], { returning: 'minimal' });
    } catch (e) {
      // Without the row the object can never be read and nothing tracks it, so
      // leaving it would be litter that only the sweep clears. Fail the upload
      // rather than hand back a key that will never resolve.
      await env.IMAGES.delete(key).catch(() => {});
      throw e;
    }

    return json({
      image_key: key,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      bytes: bytes.length,
      content_type: contentType,
      // Spelled out because the next step is not guessable from the key alone.
      next: `POST /api/v1/boards/${boardId}/cards with {"kind":"image","image_key":"${key}"}`,
    }, 201);
  }

  // GET /images/<key> — the bytes back.
  //
  // The key contains slashes, so it is taken from the raw path rather than from
  // the split segments. Authorization is a read of the `images` row AS THE USER
  // — the same check /sign-reads makes — so a key they cannot see is "not
  // found" and the route never confirms whether it exists.
  if (head === 'images' && method === 'GET') {
    const prefix = '/api/v1/images/';
    const key = decodeURIComponent(url.pathname.slice(prefix.length));
    if (!key) throw fail(400, 'bad_request', 'no image key');
    if (!env.IMAGES) throw fail(503, 'storage_unavailable', 'image storage is not available right now');

    // preview_path comes back on the SAME row, so asking for a smaller
    // rendition costs no extra query and needs no extra authorization: whoever
    // may read the original may read its own downscaled copy.
    const rows = await userSelect(env, token, 'images',
      `storage_path=eq.${encodeURIComponent(key)}&deleted_at=is.null`
      + '&select=storage_path,preview_path&limit=1');
    if (!rows?.length) throw fail(404, 'not_found', 'image not found');
    const row = rows[0];

    // ?variant=preview asks for the smaller rendition the app generates on
    // upload (~48kB at roughly 900px, against ~470kB for a typical original).
    // It FALLS BACK to the original rather than 404ing, because only about a
    // fifth of the corpus has one and a caller should not have to ask twice —
    // the x-image-variant header says what actually came back.
    //
    // The variants are ordinary images rows of their own (0105 set_image_variant
    // inserts them, retention-locked so the sweep leaves them alone), so this is
    // not reaching around anything: it is serving a key the same person could
    // already fetch directly, having read it off a row they can already see.
    const wantPreview = url.searchParams.get('variant') === 'preview';
    const served = (wantPreview && row.preview_path) ? row.preview_path : row.storage_path;
    const variant = served === row.storage_path ? 'original' : 'preview';

    const obj = await env.IMAGES.get(served);
    if (!obj) throw fail(404, 'not_found', 'image not found');
    return new Response(obj.body, {
      headers: {
        ...CORS,
        'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
        'content-length': String(obj.size),
        // Which rendition this actually is, so a caller that asked for a
        // preview and got the original knows why it is large.
        'x-image-variant': variant,
        // private: this is someone's own picture behind their own credential,
        // and it must not land in a shared cache.
        'cache-control': 'private, max-age=300',
      },
    });
  }

  if (head !== 'boards') throw fail(404, 'not_found', 'unknown endpoint');

  // ── /boards ────────────────────────────────────────────────────────────────
  if (!id) {
    trace.route = '/boards';
    if (method === 'GET') {
      const { limit, offset } = pageParams(url);
      const ws = url.searchParams.get('workspace');
      const parent = url.searchParams.get('parent');
      const deleted = url.searchParams.get('deleted') === '1';
      // The boards SELECT policy is can_read_board(id) with no deleted_at
      // clause, so a soft-deleted board stays readable to whoever could read
      // it. Listing the trash is just dropping the filter.
      let q = (deleted ? 'deleted_at=not.is.null' : 'deleted_at=is.null')
            + '&select=id,name,workspace_id,parent_board_id,view,created_at,deleted_at'
            + `&order=created_at.asc&limit=${limit + 1}&offset=${offset}`;
      if (ws) {
        if (!isUuid(ws)) throw fail(400, 'bad_request', 'workspace must be a uuid');
        q += `&workspace_id=eq.${ws}`;
      }
      if (parent === 'root') q += '&parent_board_id=is.null';
      else if (parent) {
        if (!isUuid(parent)) throw fail(400, 'bad_request', 'parent must be a uuid or "root"');
        q += `&parent_board_id=eq.${parent}`;
      }
      const rows = await userSelect(env, token, 'boards', q);
      const page = paginate(rows, limit, offset);
      return json({ boards: page.items.map(publicBoard), ...pageMeta(page) });
    }

    if (method === 'POST') {
      const name = String(body.name || '').trim();
      if (!name) throw fail(400, 'bad_request', 'name is required');
      let workspaceId = body.workspace_id;
      if (workspaceId && !isUuid(workspaceId)) throw fail(400, 'bad_request', 'workspace_id must be a uuid');
      if (!workspaceId) {
        const ws = await userRpc(env, token, 'get_or_create_personal_workspace',
          { p_user_id: auth.userId, p_name: 'Personal' });
        workspaceId = (Array.isArray(ws) ? ws[0] : ws)?.id;
      }
      if (!workspaceId) throw fail(400, 'bad_request', 'could not resolve a workspace');
      if (body.parent_board_id && !isUuid(body.parent_board_id)) {
        throw fail(400, 'bad_request', 'parent_board_id must be a uuid');
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
      trace.target = boardId;

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

    throw fail(405, 'method_not_allowed', 'method not allowed');
  }

  if (!isUuid(id)) throw fail(400, 'bad_request', 'board id must be a uuid');
  trace.target = id;

  // ── /boards/:id ────────────────────────────────────────────────────────────
  if (!sub) {
    trace.route = '/boards/:id';
    if (method === 'GET') {
      const b = await boardForUser(env, token, id, { includeDeleted: true });
      if (!b) throw fail(404, 'not_found', 'board not found');
      // Capacity comes back with the board so a caller learns it is near the
      // cap BEFORE a write fails with a 402 it has to interpret.
      const capRows = await userRpc(env, token, 'get_board_capacity', { p_board_id: id }).catch(() => null);
      const cap = Array.isArray(capRows) ? capRows[0] : capRows;
      return json({
        board: publicBoard(b),
        capacity: cap ? {
          used: Number(cap.used ?? 0),
          cap: cap.cap == null ? null : Number(cap.cap),
          remaining: cap.cap == null ? null : Math.max(0, Number(cap.cap) - Number(cap.used ?? 0)),
          capped: !!cap.is_capped,
        } : null,
      });
    }

    if (method === 'PATCH') {
      const b = await boardForUser(env, token, id);
      if (!b) throw fail(404, 'not_found', 'board not found');

      // Reparenting goes through move_boards_under and NOWHERE else. It is the
      // single authoritative write path for parent_board_id (0118) and the only
      // thing that checks for cycles — a board made its own ancestor detaches
      // that whole subtree from every view in the app.
      if ('parent_board_id' in body) {
        const target = body.parent_board_id;
        if (target && !isUuid(target)) throw fail(400, 'bad_request', 'parent_board_id must be a uuid or null');
        const out = await userRpc(env, token, 'move_boards_under',
          { p_child_ids: [id], p_target_id: target || null });
        const skipped = out?.skipped?.[0];
        if (skipped) throw fail(409, 'conflict', `could not reparent: ${skipped.reason}`);
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
      if (!b) throw fail(404, 'not_found', 'board not found');
      // SOFT delete, through the app's own soft_delete_board — not a hand-written
      // UPDATE. An API that destroys someone's board harder, or differently,
      // than their own UI does is a trap; going through the same RPC means the
      // Trash and restore paths keep working on whatever this leaves behind.
      //
      // Descendants are deliberately NOT touched, matching the app: this marks
      // one board, and children remain reachable by id.
      await userRpc(env, token, 'soft_delete_board', { p_board_id: id });
      return json({
        deleted: true,
        board: publicBoard(b),
        restorable: true,
        restore_with: `POST /api/v1/boards/${id}/restore`,
      });
    }

    throw fail(405, 'method_not_allowed', 'method not allowed');
  }

  // POST /boards/:id/restore — the other half of DELETE. Promising "restorable"
  // and then offering no way to do it from here made the claim true only if you
  // also had a browser open.
  if (sub === 'restore' && method === 'POST') {
    trace.route = '/boards/:id/restore';
    const b = await boardForUser(env, token, id, { includeDeleted: true });
    if (!b) throw fail(404, 'not_found', 'board not found');
    await userRpc(env, token, 'restore_board', { p_board_id: id });
    const after = await boardForUser(env, token, id, { includeDeleted: true });
    return json({ restored: true, board: publicBoard(after || b) });
  }

  if (sub !== 'cards') throw fail(404, 'not_found', 'unknown endpoint');

  // ── /boards/:id/cards ──────────────────────────────────────────────────────
  const board = await boardForUser(env, token, id);
  if (!board) throw fail(404, 'not_found', 'board not found');

  if (!subId && method === 'GET') {
    trace.route = '/boards/:id/cards';
    const { limit, offset } = pageParams(url);
    // Read through the live room when we can, so a card added seconds ago by a
    // collaborator is visible rather than missing until the next snapshot.
    const all = await readBoardCards(env, id, token);
    const slice = all.slice(offset, offset + limit + 1);
    const page = paginate(slice, limit, offset);
    return json({
      board_id: id,
      cards: page.items.map(publicCard),
      total: all.length,
      ...pageMeta(page),
    });
  }

  // Everything below mutates cards, so it takes the explicit route: the Y.Doc
  // path runs as service role and RLS will not save us here.
  if (method !== 'GET') await requireBoardWrite(env, token, id);

  // POST /boards/:id/cards — append
  if (!subId && method === 'POST') {
    trace.route = '/boards/:id/cards';
    const incoming = Array.isArray(body.cards) ? body.cards : [body];
    if (!incoming.length) throw fail(400, 'bad_request', 'cards is required');
    if (incoming.length > MAX_CARDS_PER_CALL) {
      throw fail(400, 'bad_request', `at most ${MAX_CARDS_PER_CALL} cards per call`);
    }
    // Normalized BEFORE the board is opened so a bad `kind` is a clean 400
    // rather than a rejection halfway through a Y.Doc transaction.
    const built = incoming.map((c) => normalizeIncomingCard(c));

    const result = await addCardsToBoard(env, {
      boardId: id,
      workspaceId: board.workspace_id,
      userId: auth.userId,
      accessToken: token,
      buildCards: async (existing) => {
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

    // An image uploaded through /uploads has no card_id on its images row: the
    // row is written before the card exists. That is FINE, and deliberately not
    // patched afterwards.
    //
    // What keeps the R2 object alive is recompute_image_refs, which derives
    // referenced_in_board_ids by scanning board_state.doc for r2: keys
    // (_r2_keys_in_doc) — not from card_id and not from card_index. So the
    // card's own `src` is the reference, and the triple write has already
    // persisted it. Verified end to end: after an upload + card create, the
    // image's ref_count is 1 and its board is in referenced_in_board_ids.
    //
    // A first version of this file did patch card_id here, and it silently did
    // nothing every time — `images` has no UPDATE policy, so RLS denies it, and
    // the .catch() swallowed the refusal. It bought nothing and hid a failure.
    // Adding an UPDATE policy to make it work would widen the client-writable
    // surface of that table for a field nothing reads.
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
    trace.route = '/boards/:id/cards/move';
    const to = body.to_board_id;
    if (!isUuid(to)) throw fail(400, 'bad_request', 'to_board_id must be a uuid');
    const cardIds = (Array.isArray(body.card_ids) ? body.card_ids : []).map(String).filter(Boolean);
    if (!cardIds.length) throw fail(400, 'bad_request', 'card_ids is required');

    const dest = await boardForUser(env, token, to);
    if (!dest) throw fail(404, 'not_found', 'destination board not found');
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

  if (!subId) throw fail(405, 'method_not_allowed', 'method not allowed');

  // PATCH /boards/:id/cards/:cardId
  if (method === 'PATCH') {
    trace.route = '/boards/:id/cards/:cardId';
    const updated = await updateCardOnBoard(env, {
      boardId: id,
      workspaceId: board.workspace_id,
      userId: auth.userId,
      accessToken: token,
      cardId: subId,
      // A function, not an object: which text field a value lands in depends on
      // the kind of card being patched, and that is only known once the card has
      // been read. Passing an object here is what sent an image caption to
      // `body`, where nothing displays it.
      patch: (before) => normalizeIncomingCard(body, { partial: true, existingKind: before?.kind }),
    });
    if (!updated) throw fail(404, 'not_found', 'card not found');
    return json({ card: publicCard(updated) });
  }

  // DELETE /boards/:id/cards/:cardId
  if (method === 'DELETE') {
    trace.route = '/boards/:id/cards/:cardId';
    const removed = await deleteCardsFromBoard(env, {
      boardId: id, accessToken: token, cardIds: [subId],
    });
    if (!removed.length) throw fail(404, 'not_found', 'card not found');
    // The removed card comes back in full. There is no undo toast on an HTTP
    // call, so the response body IS the undo: POST it back to restore it.
    return json({
      deleted: true,
      card: publicCard(removed[0]),
      restore_with: `POST /api/v1/boards/${id}/cards`,
    });
  }

  throw fail(405, 'method_not_allowed', 'method not allowed');
}

// `next` is a ready-made offset rather than a cursor: these listings are
// stable-ordered and small, and an opaque cursor would be ceremony for a caller
// who mostly wants "give me the rest".
function pageMeta(page) {
  return {
    limit: page.limit,
    offset: page.offset,
    has_more: page.has_more,
    next_offset: page.has_more ? page.offset + page.limit : null,
  };
}
