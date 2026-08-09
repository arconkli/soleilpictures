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
  createServiceAuthUser, deleteAuthUser,
} from './lib/apiAuth.js';
import {
  normalizeProps, normalizeIdentifiers, matchIdentifiers, loadMeta, loadBoardsMeta,
  saveMeta, saveMetaBulk, withMeta, parseInclude, purgeCardMeta, repointCardMeta,
  resolveUpsert, OBJECT_TYPES,
} from './lib/objectMeta.js';
import { scoutRpc, scoutDelete, scoutInsert } from './lib/scoutDb.js';
import {
  addCardsToBoard, moveCardsBetweenBoards, readBoardCards,
  updateCardOnBoard, updateCardsOnBoard, deleteCardsFromBoard,
} from './lib/scoutBoard.js';
import { arrangeExisting } from './lib/scoutCards.js';
import { bytesToB64 } from './lib/yhelpers.js';
import { imageDimensions, extensionFor } from './lib/imageDims.js';
import { openapiDocument } from './lib/apiOpenapi.js';
import { boardToOmc } from './lib/omcExport.js';
import {
  webhookUrlProblem, runWebhooks, hasPendingWork, WEBHOOK_EVENTS,
} from './lib/webhooks.js';
import { handleMcpRequest } from './lib/mcpServer.js';

// Raised from 100 once a positioned batch stopped costing O(the whole board):
// the write is now one card_index insert and one small Yjs update, so the batch
// size bounds the request body rather than the work.
const MAX_CARDS_PER_CALL = 1000;
// The ceiling on the SINGLE-SHOT upload, which buffers the whole body in the
// isolate to read its header. Anything larger goes through /uploads/multipart,
// where the bytes never touch this Worker at all.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;
// R2/S3 allows 10,000 parts; the party targets 9,000 and sizes parts to suit,
// so this is only a sanity bound on what one sign-parts call may ask for.
const MAX_PARTS_PER_CALL = 1000;
// Bulk board creation is two INSERTs whatever the count, so this bounds the
// request body rather than the work.
const MAX_BOARDS_PER_CALL = 500;

// Extensions for the kinds of file a studio actually migrates. The multipart
// path accepts anything (that is the product's "upload any file type" feature),
// so an unknown type becomes .bin rather than a refusal — but a KNOWN type
// keeps its real extension, because the extension is what the app uses to
// decide how to render a card.
const EXTRA_TYPES = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv',
  'video/webm': 'webm', 'video/mpeg': 'mpg',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/aiff': 'aiff', 'audio/x-aiff': 'aiff', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
  'application/pdf': 'pdf', 'application/zip': 'zip',
  'image/tiff': 'tif', 'image/x-adobe-dng': 'dng', 'image/x-exr': 'exr',
  'application/mxf': 'mxf', 'application/x-dpx': 'dpx',
};

// The kinds the API models.
//
// `video` and `file` were added because their absence was a hole with no
// workaround: multipart accepts ProRes, MXF, DPX and DNG (see EXTRA_TYPES
// above), so you could upload a 2TB camera master through this API and then
// have no way to put a card for it on a board. An upload you cannot place is
// not an upload.
//
// The app has more kinds still (palette, schedule, grid, board) and each of
// those carries structured interior state the wire format does not describe —
// they stay readable but not creatable, rather than creatable and broken.
// `?include=raw` is how you get at their interiors.
const CARD_KINDS = ['note', 'image', 'link', 'doc', 'video', 'file'];

// Which Y.Doc field holds the bytes, per kind. Images and video both use `src`;
// files use `fileSrc`. Getting this wrong produces a card that renders nothing,
// which is exactly what happened when this file wrote `key` instead of `src`.
const BYTES_FIELD = { image: 'src', video: 'src', file: 'fileSrc', pdf: 'fileSrc' };

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
  const kind = c.kind || 'note';
  const out = {
    id: c.id,
    kind,
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
  // Only on the kinds that have them. Adding six always-null fields to every
  // note card is paid for on every list response, forever.
  const bytes = keyFromSrc(c[BYTES_FIELD[kind]]);
  if (bytes) out.file_key = bytes;
  if (c.poster) out.poster_key = keyFromSrc(c.poster);
  if (c.fileName) out.file_name = c.fileName;
  if (c.mime) out.mime = c.mime;
  if (c.ext) out.ext = c.ext;
  if (Number.isFinite(c.sizeBytes)) out.size_bytes = c.sizeBytes;
  return out;
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
  // The same key, under the field the app reads for that kind. `image_key` is
  // kept as the name for images because it is what callers already send.
  if ('file_key' in c) {
    const k = str(c.file_key, 500);
    out[BYTES_FIELD[kind] || 'src'] = k ? `r2:${k}` : null;
  }
  if ('poster_key' in c) {
    const k = str(c.poster_key, 500);
    out.poster = k ? `r2:${k}` : null;
  }
  if ('file_name' in c) out.fileName = str(c.file_name, 300);
  if ('mime' in c) out.mime = str(c.mime, 200);
  if ('ext' in c) out.ext = str(c.ext, 20);
  if (Number.isFinite(c.size_bytes)) out.sizeBytes = Math.max(0, Math.round(c.size_bytes));
  if ('color' in c) out.color = str(c.color, 40);
  if (Number.isFinite(c.x)) out.x = Math.round(c.x);
  if (Number.isFinite(c.y)) out.y = Math.round(c.y);
  if (Number.isFinite(c.w)) out.w = clampSize(c.w);
  if (Number.isFinite(c.h)) out.h = clampSize(c.h);
  return out;
}

// Place whatever is missing coordinates, around what is already on the board.
//
// Every card must leave here with real coordinates. stampCard sets z and
// timestamps but NOT x/y, so an unpositioned card would reach the Y.Doc with
// undefined geometry — and one NaN card poisons boundsOfCards() for the whole
// board, scattering everything the user already had. Dropping it is the only
// safe answer; the response reports what actually landed.
function layoutCards(built, existing) {
  const needsLayout = built.filter((c) => !Number.isFinite(c.x) || !Number.isFinite(c.y));
  const placed = needsLayout.length
    ? arrangeExisting({ existingCards: existing, cards: needsLayout })
    : [];
  const byId = new Map(placed.map((c) => [c.id, c]));
  return built
    .map((c) => byId.get(c.id) || c)
    .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y));
}

// ── Identifiers and props on the wire ────────────────────────────────────────

// One extra pair of queries for a whole page, not a pair per board.
async function decorateBoards(env, token, rows, include) {
  const out = rows.map(publicBoard);
  if (!include.size || !rows.length) return out;
  const meta = await loadBoardsMeta(env, token, rows.map((b) => b.id));
  return out.map((b) => filterMeta(withMeta(b, meta.get(b.id) || {}), include));
}

// `?include=props` should not also hand back identifiers. Asking for one thing
// and receiving two is how a response grows without anyone deciding to.
function filterMeta(obj, include) {
  const out = { ...obj };
  if (!include.has('props')) delete out.props;
  if (!include.has('identifiers')) delete out.identifiers;
  return out;
}

// The same for cards, plus `raw`.
//
// WHY `raw` EXISTS. publicCard is a 12-field projection, and the app has kinds
// it does not describe — a grid card carries cells, a template and a sequence;
// a palette carries swatches; a schedule carries rows. Those kinds are readable
// but not creatable, and they were reading back with their interior silently
// missing, which for anyone taking a backup or migrating out is data loss that
// looks like success. `raw` hands over the card exactly as it is stored.
//
// It is opt-in because it is the card's INTERNAL shape: field names there are
// not part of the API's contract and may change with the app.
async function decorateCards(env, token, boardId, cards, include) {
  let out = cards.map((c) => (include.has('raw')
    ? { ...publicCard(c), raw: c }
    : publicCard(c)));
  if (include.has('props') || include.has('identifiers')) {
    const meta = await loadMeta(env, token, {
      boardId, objectType: 'card', objectIds: cards.map((c) => c.id),
    });
    out = out.map((c) => filterMeta(withMeta(c, meta.get(String(c.id)) || {}), include));
  }
  return out;
}

// Pull `props` and `identifiers` off an incoming body and validate them, so a
// route never has to remember to. Returns nulls for "not mentioned", which is
// distinct from an empty object or an empty array.
function metaFromBody(body) {
  return {
    props: normalizeProps(body?.props),
    identifiers: normalizeIdentifiers(body?.identifiers),
  };
}

// An unknown event name is refused rather than accepted and never fired —
// "subscribed and silent" is the hardest webhook failure to diagnose.
function normalizeEvents(input) {
  const asked = Array.isArray(input) ? input : [];
  if (!asked.length) throw fail(400, 'bad_request', 'events is required');
  const clean = [...new Set(asked.map((e) => String(e).trim()))];
  const bad = clean.filter((e) => e !== '*' && !WEBHOOK_EVENTS.includes(e));
  if (bad.length) {
    throw fail(400, 'bad_request',
      `unknown event ${JSON.stringify(bad[0])} — valid: ${WEBHOOK_EVENTS.join(', ')}, or "*"`);
  }
  return clean;
}

// ── Service accounts ─────────────────────────────────────────────────────────

function publicServiceAccount(s) {
  return {
    id: s.user_id,
    name: s.name,
    workspace_id: s.workspace_id,
    created_at: s.created_at,
    disabled: !!s.disabled_at,
    token_count: s.token_count ?? null,
    last_used_at: s.last_used_at ?? null,
  };
}

// A minted credential may never exceed the credential that minted it.
//
// Without this, a `write` token could mint a service token carrying `delete`
// and then destroy everything — an escalation, done entirely through documented
// endpoints. Downscoping is the standard answer and it costs one comparison.
function requestedScopes(input, auth) {
  const asked = Array.isArray(input) && input.length ? input : ['read', 'write'];
  const clean = [...new Set(asked.map((s) => String(s).toLowerCase()))];
  const bad = clean.filter((s) => !['read', 'write', 'delete'].includes(s));
  if (bad.length) {
    throw fail(400, 'bad_request',
      `scopes must be a subset of read, write, delete — got ${JSON.stringify(bad.join(', '))}`);
  }
  const over = clean.filter((s) => !auth.scopes.includes(s));
  if (over.length) {
    throw fail(403, 'insufficient_scope',
      `this token cannot grant ${over.join(', ')} — a service token may not exceed the token that minted it`);
  }
  return clean;
}

async function mintServiceToken(env, token, { userId, name, scopes, ttlDays, rateLimit }) {
  const rows = await userRpc(env, token, 'api_token_mint_for', {
    p_user_id: userId,
    p_name: name,
    p_scopes: scopes,
    p_ttl_days: Number.isFinite(ttlDays) ? Math.round(ttlDays) : null,
    p_req_limit: Number.isFinite(rateLimit) ? Math.round(rateLimit) : null,
  });
  const t = (rows || [])[0];
  if (!t?.token) throw fail(502, 'upstream_error', 'the token was not minted');
  return {
    id: t.id,
    token: t.token,          // the only time this value ever exists outside the caller
    prefix: t.prefix,
    scopes,
    rate_limit: t.req_limit,
  };
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

// ── Multipart uploads ────────────────────────────────────────────────────────
//
// Proxied to the upload party's /mpu/* routes rather than reimplemented here,
// and that is a deliberate reuse rather than laziness:
//
//   · It is the SAME code path the browser has used in production for the
//     "upload any file type" feature, including the quota gate and the
//     workspace-prefixed key shape that scopes storage (0218).
//   · It authenticates on a plain Supabase user JWT (upload.ts checks the
//     Authorization header and re-runs can_write_board per call) — and
//     apiUserSession already mints exactly that. So this needs NO new secret
//     and, in particular, no R2 credentials inside this Worker.
//   · The bytes go from the caller STRAIGHT TO R2 via presigned part URLs.
//     A studio moving 25TB never sends a byte through here, which is the only
//     way the number works: buffering it would be both slow and, at 128MB of
//     isolate memory, impossible.
//
// A single-shot POST /uploads stays for small files, because one call is what
// makes it usable from a tool call.
async function partyMpu(env, token, workspaceId, action, body) {
  const host = env.PARTYKIT_HOST || 'soleil-boards-party.arconkli.partykit.dev';
  let res;
  try {
    res = await fetch(`https://${host}/parties/upload/${encodeURIComponent(workspaceId)}/mpu/${action}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw fail(503, 'storage_unavailable', 'the upload service is unreachable right now');
  }

  const text = await res.text().catch(() => '');
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (_) { /* plain-text refusal */ }

  if (!res.ok) {
    // The party answers over-quota with 402 and a machine-readable reason; keep
    // both, because "you are out of space" and "you may not write here" need
    // different things from the caller.
    const reason = parsed?.reason || '';
    if (res.status === 402 || reason === 'over_quota') {
      throw fail(402, 'limit_reached',
        'that would go past the storage included with this account');
    }
    if (res.status === 403) {
      throw fail(403, 'forbidden', reason === 'owner_not_paid'
        ? 'large uploads need a paid account on the workspace that owns this board'
        : 'you cannot upload to that board');
    }
    if (res.status === 400) throw fail(400, 'bad_request', 'the upload service rejected that request');
    throw fail(502, 'upstream_error', 'the upload service could not complete that step');
  }
  return parsed || {};
}

// The workspace a board belongs to, read AS THE USER — so a board they cannot
// see comes back as "not found" rather than leaking its existence.
async function boardForUser(env, token, boardId, { includeDeleted = false } = {}) {
  const q = `id=eq.${boardId}${includeDeleted ? '' : '&deleted_at=is.null'}`
    + '&select=id,name,workspace_id,parent_board_id,view,created_at,updated_at,deleted_at';
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

  // Writes, plus any read a route asked to have recorded.
  //
  // 0220 logged writes only, on the grounds that reads are the bulk of traffic
  // and mostly noise. That is still true of listing boards — and false of
  // fetching image BYTES, which for a studio is the event that matters: who
  // took a copy of unreleased material, and when. Routes opt in with
  // `trace.log`, so the volume stays bounded by an explicit decision rather
  // than by a method check.
  //
  // Off the response path via waitUntil — an audit write must never be what
  // makes someone's request slow, or what fails it.
  if ((request.method !== 'GET' || trace.log) && auth.tokenId) {
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

  // A write may have queued webhook events. Draining here means an API-driven
  // event leaves in milliseconds instead of waiting up to a minute for the
  // cron; the cron still exists, and is what covers changes made in the app.
  // Guarded by a single indexed probe so the overwhelming majority of
  // workspaces — which have no webhooks — pay almost nothing.
  if (request.method !== 'GET' && ctx?.waitUntil) {
    ctx.waitUntil(hasPendingWork(env)
      .then((pending) => (pending ? runWebhooks(env, { limit: 50 }) : null))
      .catch(() => {}));
  }

  return withHeaders(res, rl);
}

// Call this API's own routes, from inside it.
//
// The MCP tools are defined once and used by two transports, so they are
// written against an HTTP client. On the hosted side that client is THIS — a
// direct call into dispatch with the caller's own auth, rather than a fetch
// back out to ourselves. Two reasons: a Worker calling its own public hostname
// is a second TLS round trip and a second rate-limit charge for one logical
// operation, and going out through the front door would re-run authentication
// against a token we have already resolved.
//
// Because it goes through the same dispatcher, an MCP tool cannot do anything a
// REST caller could not. That is the property worth having, and it is
// structural rather than remembered.
async function internalCall(baseUrl, env, ctx, { auth, token }, path, opts = {}) {
  const target = new URL(`/api/v1${path}`, baseUrl.origin);
  const method = opts.method || 'GET';
  const headers = { ...(opts.headers || {}) };
  let body;
  if (opts.rawBody !== undefined) {
    // A base64 payload from upload_image: the upload route reads raw bytes.
    const bin = atob(opts.rawBody);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    body = bytes;
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
  }

  const req = new Request(target, { method, headers, body });
  const trace = { route: target.pathname.replace(/^\/api\/v1/, '') || '/', target: null };
  const res = await dispatch(target, req, env, { auth, token, trace });

  if (opts.raw) {
    if (!res.ok) throw new Error(await describeInternalFailure(res));
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      variant: res.headers.get('x-image-variant') || 'original',
    };
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `request failed (${res.status})`);
  return data;
}

async function describeInternalFailure(res) {
  const text = await res.text().catch(() => '');
  try {
    return JSON.parse(text)?.error || `request failed (${res.status})`;
  } catch {
    return `request failed (${res.status})`;
  }
}

async function dispatch(url, request, env, ctx) {
  const { auth, token, trace } = ctx;
  const parts = url.pathname.replace(/^\/api\/v1\/?/, '').replace(/\/$/, '').split('/').filter(Boolean);
  const [head, id, sub, subId] = parts;
  const method = request.method;

  // The single-shot upload carries RAW BYTES, so its body must not be parsed as
  // JSON. Its multipart siblings underneath /uploads/* are ordinary JSON, and
  // treating them as raw too is what made every field arrive undefined.
  const isRawUpload = head === 'uploads' && !id;
  // DELETE carries a body here, which is unusual but deliberate: a bulk delete
  // of a thousand card ids does not fit in a query string, and the alternative
  // — POST /cards/delete — makes a destructive call look like a create to every
  // proxy, log and scope check between the caller and this line. A body is only
  // read when one was actually sent with a JSON content type, so an ordinary
  // single DELETE is unaffected.
  const hasJsonBody = (request.headers.get('content-type') || '').includes('json');
  const body = (method === 'GET' || isRawUpload || (method === 'DELETE' && !hasJsonBody))
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
        'GET    /service-accounts?workspace=',
        'POST   /service-accounts',
        'DELETE /service-accounts/:id',
        'GET    /service-accounts/:id/tokens',
        'POST   /service-accounts/:id/tokens',
        'DELETE /service-accounts/:id/tokens/:tokenId',
        'GET    /search?q=&kind=&workspace=&limit=&offset=',
        'GET    /resolve?scope=&value=&type=&workspace=',
        'GET    /boards?workspace=&parent=&deleted=&since=&cursor=&include=&limit=&offset=',
        'GET    /boards/tree?root=&workspace=&depth=',
        'POST   /boards/move',
        'DELETE /boards            {"board_ids":[…]}  — bulk soft-delete',
        'GET    /audit?since=&cursor=&limit=',
        'POST   /mcp                        — Model Context Protocol, for AI agents',
        'GET    /webhooks?workspace=',
        'POST   /webhooks',
        'PATCH  /webhooks/:id',
        'DELETE /webhooks/:id',
        'POST   /webhooks/:id/test',
        'GET    /webhooks/:id/deliveries?limit=&cursor=',
        'POST   /webhooks/:id/deliveries/:deliveryId/redeliver',
        'POST   /boards',
        'POST   /boards            {"boards":[…]}  — bulk, up to 500',
        'GET    /boards/:id',
        'GET    /boards/:id/export?format=json|omc',
        'PATCH  /boards/:id',
        'DELETE /boards/:id',
        'POST   /boards/:id/restore',
        'GET    /boards/:id/cards?source=live|index&since=&cursor=&include=&limit=&offset=',
        'POST   /boards/:id/cards',
        'PATCH  /boards/:id/cards            {"cards":[…]}  — bulk',
        'DELETE /boards/:id/cards            {"card_ids":[…]}  — bulk',
        'PATCH  /boards/:id/cards/:cardId',
        'DELETE /boards/:id/cards/:cardId',
        'POST   /boards/:id/cards/move',
        'POST   /uploads?board=:id',
        'POST   /uploads/multipart?board=:id',
        'POST   /uploads/multipart/parts',
        'POST   /uploads/multipart/complete',
        'POST   /uploads/multipart/abort',
        'GET    /images?workspace=&board=&since=&cursor=&limit=',
        'GET    /images/:key?variant=preview',
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
      // A machine identity should be able to say so. An integration that has
      // been handed the wrong credential otherwise finds out by being refused
      // somewhere far from the cause.
      service_account: auth.serviceAccount,
      workspace_id: auth.workspaceId,
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

  // ── Service accounts ──────────────────────────────────────────────────────
  //
  // A credential that belongs to the WORKSPACE rather than to a person. The
  // integration a studio builds cannot be Bob's token: Bob leaves, or his tier
  // moves, and every pipeline that depended on it stops with a 403 nobody can
  // explain. A service account is a real auth.users row holding a
  // workspace_members row, so it is subject to exactly the same RLS as a human
  // and confined to the one workspace it was made for.
  //
  // Only the workspace OWNER may create one — enforced in the RPC, not here,
  // because an editor who can write to a workspace should not be able to mint a
  // credential that outlives their own access to it.
  if (head === 'service-accounts') {
    // A service account creating another service account would let one leaked
    // credential clone itself indefinitely. The RPC already refuses (it demands
    // workspaces.created_by = auth.uid(), and a service account never is), but
    // saying so plainly beats a permission error about workspace ownership.
    if (auth.serviceAccount) {
      throw fail(403, 'forbidden',
        'a service account cannot manage service accounts — use the owner’s token');
    }

    // GET /service-accounts?workspace=<uuid>
    if (!id && method === 'GET') {
      const ws = url.searchParams.get('workspace');
      if (!isUuid(ws)) throw fail(400, 'bad_request', 'workspace must be a uuid');
      const rows = await userRpc(env, token, 'service_account_list', { p_workspace_id: ws });
      return json({ service_accounts: (rows || []).map(publicServiceAccount) });
    }

    // POST /service-accounts  {workspace_id, name, scopes?, ttl_days?, rate_limit?}
    // Creates the identity AND its first token, because a service account with
    // no credential is not usable and a second round trip to get one is a step
    // every caller would have to take anyway.
    if (!id && method === 'POST') {
      const ws = body.workspace_id;
      if (!isUuid(ws)) throw fail(400, 'bad_request', 'workspace_id must be a uuid');
      const name = str(body.name, 80);
      if (!name) throw fail(400, 'bad_request', 'name is required');
      const scopes = requestedScopes(body.scopes, auth);

      const { userId: saId } = await createServiceAuthUser(env, { label: name });
      let account;
      try {
        const rows = await userRpc(env, token, 'service_account_register', {
          p_user_id: saId, p_workspace_id: ws, p_name: name,
        });
        account = (rows || [])[0];
        if (!account) throw fail(502, 'upstream_error', 'the service account was not registered');
      } catch (e) {
        // The identity exists and belongs to nothing. Take it back rather than
        // leave an orphan that counts as a signup and can never be reached.
        await deleteAuthUser(env, saId);
        throw e;
      }

      const minted = await mintServiceToken(env, token, {
        userId: saId, name: `${name} token`, scopes,
        ttlDays: body.ttl_days, rateLimit: body.rate_limit,
      });
      trace.target = null;
      return json({
        service_account: publicServiceAccount(account),
        token: minted,
        next: 'Use this token as the Bearer credential. It is shown once.',
      }, 201);
    }

    if (id && !isUuid(id)) throw fail(400, 'bad_request', 'service account id must be a uuid');

    // DELETE /service-accounts/:id — revokes every token and drops the
    // membership, so the credential is dead when this returns. The auth row
    // stays, so the audit log keeps resolving to a name.
    if (id && !sub && method === 'DELETE') {
      const rows = await userRpc(env, token, 'service_account_disable', { p_user_id: id });
      const r = (rows || [])[0];
      if (!r) throw fail(404, 'not_found', 'no such service account');
      return json({ disabled: true, user_id: r.user_id, tokens_revoked: r.tokens_revoked ?? 0 });
    }

    if (id && sub === 'tokens') {
      // GET /service-accounts/:id/tokens
      if (!subId && method === 'GET') {
        const rows = await userRpc(env, token, 'api_token_list_for', { p_user_id: id });
        return json({ tokens: rows || [] });
      }
      // POST /service-accounts/:id/tokens — rotation is mint-then-revoke, so
      // an integration can be moved onto a new credential with no downtime.
      if (!subId && method === 'POST') {
        const minted = await mintServiceToken(env, token, {
          userId: id, name: str(body.name, 80) || 'Service token',
          scopes: requestedScopes(body.scopes, auth),
          ttlDays: body.ttl_days, rateLimit: body.rate_limit,
        });
        return json({ token: minted }, 201);
      }
      // DELETE /service-accounts/:id/tokens/:tokenId
      if (subId && method === 'DELETE') {
        if (!isUuid(subId)) throw fail(400, 'bad_request', 'token id must be a uuid');
        const ok = await userRpc(env, token, 'api_token_revoke_for', { p_token_id: subId });
        if (!ok) throw fail(404, 'not_found', 'no such token');
        return json({ revoked: true, token_id: subId });
      }
    }

    throw fail(405, 'method_not_allowed', `${method} is not supported here`);
  }

  // ── /webhooks ─────────────────────────────────────────────────────────────
  //
  // Management copies ShotGrid's surface — create, list, update, delete, test,
  // list deliveries, redeliver — because that is the one facilities already
  // rely on, and a delivery log you can inspect and replay is what makes
  // "it didn't arrive" a question with an answer.
  if (head === 'webhooks') {
    if (!id && method === 'GET') {
      const ws = url.searchParams.get('workspace');
      if (ws && !isUuid(ws)) throw fail(400, 'bad_request', 'workspace must be a uuid');
      const rows = await userRpc(env, token, 'webhook_list', { p_workspace_id: ws || null });
      return json({ webhooks: rows || [] });
    }

    if (!id && method === 'POST') {
      const ws = body.workspace_id;
      if (!isUuid(ws)) throw fail(400, 'bad_request', 'workspace_id must be a uuid');
      const problem = webhookUrlProblem(body.url);
      if (problem) throw fail(400, 'bad_request', problem);
      const events = normalizeEvents(body.events);
      const rows = await userRpc(env, token, 'webhook_create', {
        p_workspace_id: ws, p_url: String(body.url), p_events: events,
        p_name: str(body.name, 80),
      });
      const w = (rows || [])[0];
      if (!w) throw fail(502, 'upstream_error', 'the webhook was not created');
      return json({
        webhook: { id: w.id, workspace_id: ws, url: String(body.url), events, active: true,
          created_at: w.created_at },
        // The only time this value exists outside the database. There is no read
        // path for it, here or in SQL.
        secret: w.secret,
        next: 'Verify each delivery: HMAC-SHA256 of "v0:{timestamp}:{body}", compared with the X-Soleil-Signature header.',
      }, 201);
    }

    if (id && !isUuid(id)) throw fail(400, 'bad_request', 'webhook id must be a uuid');

    if (id && !sub && method === 'PATCH') {
      if (body.url != null) {
        const problem = webhookUrlProblem(body.url);
        if (problem) throw fail(400, 'bad_request', problem);
      }
      const ok = await userRpc(env, token, 'webhook_update', {
        p_id: id,
        p_url: body.url != null ? String(body.url) : null,
        p_events: body.events != null ? normalizeEvents(body.events) : null,
        p_name: str(body.name, 80),
        p_active: typeof body.active === 'boolean' ? body.active : null,
      });
      if (!ok) throw fail(404, 'not_found', 'no such webhook');
      const rows = await userRpc(env, token, 'webhook_list', { p_workspace_id: null });
      return json({ webhook: (rows || []).find((w) => w.id === id) || null });
    }

    if (id && !sub && method === 'DELETE') {
      const ok = await userRpc(env, token, 'webhook_delete', { p_id: id });
      if (!ok) throw fail(404, 'not_found', 'no such webhook');
      return json({ deleted: true, webhook_id: id });
    }

    // POST /webhooks/:id/test — a real delivery through the real path, so what
    // it proves is what will happen, not what a separate code path does.
    if (id && sub === 'test' && method === 'POST') {
      const rows = await userRpc(env, token, 'webhook_list', { p_workspace_id: null });
      const w = (rows || []).find((x) => x.id === id);
      if (!w) throw fail(404, 'not_found', 'no such webhook');
      await scoutInsert(env, 'webhook_deliveries', [{
        webhook_id: id,
        event: 'webhook.test',
        payload: {
          type: 'webhook.test',
          resource: { type: 'webhook', id },
          workspace: { id: w.workspace_id },
          board: null,
          data: { message: 'If you are reading this, delivery and signing work.' },
          occurred_at: new Date().toISOString(),
        },
      }]);
      const out = await runWebhooks(env, { limit: 25 });
      return json({ sent: true, result: out, check: `GET /api/v1/webhooks/${id}/deliveries` });
    }

    if (id && sub === 'deliveries' && method === 'GET' && !subId) {
      const { limit } = pageParams(url);
      const cursor = url.searchParams.get('cursor');
      const rows = await userRpc(env, token, 'webhook_deliveries_list', {
        p_webhook_id: id, p_limit: limit, p_cursor: cursor || null,
      });
      const items = rows || [];
      const last = items[items.length - 1];
      return json({
        deliveries: items,
        limit,
        has_more: items.length === limit,
        next_cursor: items.length === limit && last ? last.created_at : null,
      });
    }

    if (id && sub === 'deliveries' && subId && method === 'POST') {
      // .../deliveries/:did/redeliver — requeued rather than re-POSTed inline,
      // so the retry goes through the same path and is recorded the same way.
      const ok = await userRpc(env, token, 'webhook_redeliver', { p_delivery_id: subId });
      if (!ok) throw fail(404, 'not_found', 'no such delivery');
      const out = await runWebhooks(env, { limit: 25 });
      return json({ requeued: true, delivery_id: subId, result: out });
    }

    throw fail(405, 'method_not_allowed', `${method} is not supported here`);
  }

  // POST /mcp — the hosted MCP server.
  //
  // Same credential, same scopes, same rate limit as everything else here. The
  // tools call back into this dispatcher rather than over the network, so there
  // is no second permission model to keep in step: what a token can do over
  // REST is exactly what it can do over MCP, by construction.
  if (head === 'mcp') {
    trace.route = '/mcp';
    const out = await handleMcpRequest(request, {
      api: (path, opts = {}) => internalCall(url, env, ctx, { auth, token }, path, opts),
    }, body);
    if (out.body === null) return new Response(null, { status: out.status, headers: CORS });
    return json(out.body, out.status);
  }

  // GET /audit?since=&cursor=&limit=
  //
  // api_request_log has been written on every write since 0220 and its only
  // read path had ZERO callers anywhere in the repo — an audit trail that
  // exists and is unreachable, which for a studio is the same as not having
  // one. This also covers a workspace owner's service accounts, which the old
  // `user_id = auth.uid()` predicate could not express.
  if (head === 'audit' && method === 'GET') {
    const since = url.searchParams.get('since');
    const cursor = url.searchParams.get('cursor');
    const { limit } = pageParams(url);
    if (since && Number.isNaN(Date.parse(since))) {
      throw fail(400, 'bad_request', 'since must be an ISO timestamp');
    }
    if (cursor && !/^\d+$/.test(String(cursor))) {
      throw fail(400, 'bad_request', 'cursor must be a next_cursor from a previous response');
    }
    const rows = await userRpc(env, token, 'api_audit_read', {
      p_since: since || null,
      p_cursor: cursor ? Number(cursor) : null,
      p_limit: limit,
    });
    const items = rows || [];
    const last = items[items.length - 1];
    return json({
      entries: items.map((r) => ({
        id: String(r.id),
        at: r.created_at,
        actor: r.actor,
        actor_id: r.actor_id,
        token_id: r.token_id,
        token_name: r.token_name,
        method: r.method,
        route: r.route,
        target_id: r.target_id,
        status: r.status,
        ms: r.ms,
      })),
      limit,
      // Keyset on the log's own id, descending: created_at is not unique under
      // a migration doing thousands of writes a second.
      has_more: items.length === limit,
      next_cursor: items.length === limit && last ? String(last.id) : null,
      // Said plainly rather than left to be discovered: this records writes
      // through /api/v1, not edits made in the app.
      covers: 'writes made through /api/v1 and reads of image bytes',
    });
  }

  // GET /resolve?scope=&value=[&type=][&workspace=]
  //
  // The reverse lookup, and the reason identifiers are worth storing at all.
  // A pipeline holding a ShotGrid id needs to get from that to the board
  // without keeping its own map of which board it made for which shot — which
  // is the exact bookkeeping every integration ends up doing when an API cannot
  // answer this question.
  if (head === 'resolve' && method === 'GET') {
    const scope = (url.searchParams.get('scope') || '').trim().toLowerCase();
    const value = (url.searchParams.get('value') || '').trim();
    const type = url.searchParams.get('type');
    const ws = url.searchParams.get('workspace');
    if (!scope || !value) throw fail(400, 'bad_request', 'scope and value are required');
    if (type && !OBJECT_TYPES.includes(type)) {
      throw fail(400, 'bad_request', `type must be one of ${OBJECT_TYPES.join(', ')}`);
    }
    if (ws && !isUuid(ws)) throw fail(400, 'bad_request', 'workspace must be a uuid');

    // RLS does the authorization: object_identifiers is readable exactly where
    // can_read_board is true, so an identifier on someone else's board simply
    // is not here. No filtering afterwards, and no way to probe for what exists
    // by watching which lookups come back empty.
    let q = `scope=eq.${encodeURIComponent(scope)}&value=eq.${encodeURIComponent(value)}`
      + '&select=object_type,object_id,board_id,workspace_id,scope,value,created_at';
    if (type) q += `&object_type=eq.${type}`;
    if (ws) q += `&workspace_id=eq.${ws}`;
    const rows = await userSelect(env, token, 'object_identifiers', q);

    return json({
      scope,
      value,
      // A list, not a single object. The identifier is unique per (workspace,
      // type) — not globally — so a caller who belongs to two workspaces that
      // both track the same upstream record gets both, and gets to choose.
      matches: (rows || []).map((r) => ({
        object_type: r.object_type,
        object_id: r.object_id,
        board_id: r.board_id,
        workspace_id: r.workspace_id,
        url: r.object_type === 'board'
          ? `/api/v1/boards/${r.board_id}`
          : `/api/v1/boards/${r.board_id}/cards`,
        created_at: r.created_at,
      })),
    });
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
          + `&select=id,name,workspace_id,parent_board_id,view,created_at,updated_at,deleted_at`
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

  // ── POST /uploads/multipart[/parts|/complete|/abort] ───────────────────────
  //
  // The path for files too big to send in one request — which for a studio is
  // most of them. Four calls, and only the first and last touch this Worker's
  // request budget at all:
  //
  //   1. POST /uploads/multipart?board=…   { bytes, content_type, filename? }
  //        → { key, upload_id, part_size, part_count }
  //   2. POST /uploads/multipart/parts     { key, upload_id, part_numbers[] }
  //        → { urls: { "1": "https://…" } }   PUT the bytes THERE, not here
  //   3. POST /uploads/multipart/complete  { key, upload_id, parts[] }
  //        → { image_key, bytes, width, height }
  //   4. POST /uploads/multipart/abort     { key, upload_id }
  if (head === 'uploads' && id === 'multipart' && method === 'POST') {
    const action = sub || 'create';
    trace.route = `/uploads/multipart${sub ? `/${sub}` : ''}`;

    // Every step re-states its board, and every step re-checks it. The party
    // does the same on its side (can_write_board per call): a signed part URL
    // is a capability, so nothing here may rely on a check made three calls
    // ago against a permission that could since have been revoked.
    const boardId = url.searchParams.get('board') || body.board_id;
    if (!isUuid(boardId)) throw fail(400, 'bad_request', 'board is required and must be a uuid');
    trace.target = boardId;
    const board = await boardForUser(env, token, boardId);
    if (!board) throw fail(404, 'not_found', 'board not found');
    await requireBoardWrite(env, token, boardId);

    if (action === 'create') {
      const bytes = Number(body.bytes);
      if (!Number.isFinite(bytes) || bytes <= 0) {
        throw fail(400, 'bad_request', 'bytes is required — the quota gate needs the total size up front');
      }
      const contentType = String(body.content_type || 'application/octet-stream')
        .split(';')[0].trim().toLowerCase();
      // Prefer a real extension over .bin: the app decides how to render a card
      // from it. Content type first, then the filename, then give up.
      const ext = extensionFor(contentType)
        || EXTRA_TYPES[contentType]
        || (String(body.filename || '').match(/\.([a-z0-9]{1,8})$/i)?.[1] || '').toLowerCase()
        || 'bin';

      const out = await partyMpu(env, token, board.workspace_id, 'create', {
        boardId, fileExt: ext, contentType, totalBytes: bytes,
      });
      return json({
        key: out.key,
        upload_id: out.uploadId,
        part_size: out.partSize,
        part_count: out.partCount,
        content_type: contentType,
        next: 'POST /api/v1/uploads/multipart/parts for signed URLs, then PUT each part directly to it',
      }, 201);
    }

    const key = String(body.key || '');
    const uploadId = String(body.upload_id || '');
    if (!key || !uploadId) throw fail(400, 'bad_request', 'key and upload_id are required');

    if (action === 'parts') {
      const wanted = Array.isArray(body.part_numbers) ? body.part_numbers : [];
      const partNumbers = wanted
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 10000)
        .slice(0, MAX_PARTS_PER_CALL);
      if (!partNumbers.length) {
        throw fail(400, 'bad_request', 'part_numbers must be integers between 1 and 10000');
      }
      const out = await partyMpu(env, token, board.workspace_id, 'sign-parts', {
        boardId, key, uploadId, partNumbers,
      });
      return json({
        urls: out.urls || {},
        // Said plainly because it is the whole point of this route and the
        // thing a client is most likely to get wrong by proxying through us.
        upload_directly_to: 'PUT the part bytes to these URLs; they go straight to storage',
      });
    }

    if (action === 'abort') {
      await partyMpu(env, token, board.workspace_id, 'abort', { boardId, key, uploadId });
      return json({ aborted: true, key });
    }

    if (action !== 'complete') throw fail(404, 'not_found', 'unknown endpoint');

    const parts = (Array.isArray(body.parts) ? body.parts : [])
      .map((p) => ({ partNumber: Number(p.part_number ?? p.partNumber), etag: String(p.etag || '') }))
      .filter((p) => Number.isInteger(p.partNumber) && p.etag);
    if (!parts.length) {
      throw fail(400, 'bad_request', 'parts is required — [{ part_number, etag }] from each PUT response');
    }
    await partyMpu(env, token, board.workspace_id, 'complete', { boardId, key, uploadId, parts });

    // The object exists now, but nothing points at it. The images row is what
    // authorizes reads and what keeps the R2 orphan sweep from reclaiming it,
    // so an upload that stops here is a file that quietly dies in 30 days.
    // Same reasoning as the single-shot path.
    let size = Number(body.bytes) || 0;
    let dims = null;
    if (env.IMAGES) {
      // A ranged read: enough of the header to measure an image, without
      // pulling a 50GB object into a 128MB isolate to find out it is a video.
      const head64 = await env.IMAGES.get(key, { range: { offset: 0, length: 65536 } })
        .catch(() => null);
      if (head64) {
        size = head64.size || size;
        dims = imageDimensions(new Uint8Array(await head64.arrayBuffer())) || null;
      }
    }

    await userInsert(env, token, 'images', [{
      workspace_id: board.workspace_id,
      board_id: boardId,
      storage_path: key,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      size_bytes: size || null,
      uploaded_by: auth.userId,
    }], { returning: 'minimal' });

    return json({
      image_key: key,
      bytes: size || null,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      next: `POST /api/v1/boards/${boardId}/cards with {"kind":"image","image_key":"${key}"}`,
    }, 201);
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

  // GET /images — what is already stored, so a migration can be resumed.
  //
  // A client that dies at 60% of three million objects has to be able to work
  // out what landed. Without this the only options are re-uploading everything
  // (paying twice, and orphaning the first copy) or trusting a local log that
  // by definition was not written for the requests that failed.
  //
  // KEYSET, not offset. `offset=2900000` makes Postgres walk 2.9M rows to throw
  // them away, so a listing that starts fast ends unusable — exactly the shape
  // of failure that only shows up at the scale this exists for. Pass the last
  // `cursor` back to continue; ordering is (created_at, id) so it is total and
  // stable even when a thousand rows share a timestamp.
  if (head === 'images' && !id && method === 'GET') {
    trace.route = '/images';
    const { limit } = pageParams(url);
    const ws = url.searchParams.get('workspace');
    if (ws && !isUuid(ws)) throw fail(400, 'bad_request', 'workspace must be a uuid');
    const boardFilter = url.searchParams.get('board');
    if (boardFilter && !isUuid(boardFilter)) throw fail(400, 'bad_request', 'board must be a uuid');

    let q = 'deleted_at=is.null'
      + '&select=id,storage_path,size_bytes,width,height,board_id,workspace_id,created_at'
      + `&order=created_at.asc,id.asc&limit=${limit + 1}`;
    if (ws) q += `&workspace_id=eq.${ws}`;
    if (boardFilter) q += `&board_id=eq.${boardFilter}`;

    // `since` is the coarse filter a caller reaches for first; `cursor` is the
    // exact one that survives ties.
    const since = url.searchParams.get('since');
    if (since) {
      if (Number.isNaN(Date.parse(since))) throw fail(400, 'bad_request', 'since must be an ISO timestamp');
      q += `&created_at=gte.${encodeURIComponent(since)}`;
    }
    const cursor = url.searchParams.get('cursor');
    if (cursor) {
      const [cAt, cId] = String(cursor).split('|');
      if (!cAt || !isUuid(cId || '')) throw fail(400, 'bad_request', 'cursor is not one this endpoint issued');
      // (created_at, id) > (cAt, cId), spelled as PostgREST understands it.
      q += `&or=${encodeURIComponent(`(created_at.gt.${cAt},and(created_at.eq.${cAt},id.gt.${cId}))`)}`;
    }

    const rows = await userSelect(env, token, 'images', q);
    const page = paginate(rows, limit, 0);
    const last = page.items[page.items.length - 1];
    return json({
      images: page.items.map((r) => ({
        image_key: r.storage_path,
        bytes: r.size_bytes == null ? null : Number(r.size_bytes),
        width: r.width, height: r.height,
        board_id: r.board_id, workspace_id: r.workspace_id,
        created_at: r.created_at,
      })),
      limit,
      has_more: page.has_more,
      next_cursor: page.has_more && last ? `${last.created_at}|${last.id}` : null,
    });
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

    // The one read worth an audit row: this is bytes leaving, and "who took a
    // copy of unreleased material, and when" is the question a studio's
    // security review actually asks.
    trace.route = '/images/:key';
    trace.log = true;

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
      const include = parseInclude(url, ['props', 'identifiers']);
      const ws = url.searchParams.get('workspace');
      const parent = url.searchParams.get('parent');
      const deleted = url.searchParams.get('deleted') === '1';
      const since = url.searchParams.get('since');
      const cursor = url.searchParams.get('cursor');

      // Two modes, and which one you are in is decided by whether you asked a
      // delta question.
      //
      // Default is unchanged: created_at ascending, offset paged. Pass `since`
      // or `cursor` and it becomes a CHANGE FEED — updated_at ascending, keyset
      // paged — because a synchroniser asking "what moved" wants them in the
      // order they moved, and offset paging over a set that is being written to
      // skips and repeats rows.
      const delta = !!(since || cursor);
      const selectCols = 'id,name,workspace_id,parent_board_id,view,created_at,updated_at,deleted_at';
      let q = (deleted ? 'deleted_at=not.is.null' : 'deleted_at=is.null')
            + `&select=${selectCols}&limit=${limit + 1}`;

      if (delta) {
        q += '&order=updated_at.asc,id.asc';
        if (since) {
          if (Number.isNaN(Date.parse(since))) {
            throw fail(400, 'bad_request', 'since must be an ISO timestamp');
          }
          q += `&updated_at=gte.${encodeURIComponent(since)}`;
        }
        if (cursor) {
          const [ts, cid] = String(cursor).split('|');
          if (!ts || !cid || Number.isNaN(Date.parse(ts))) {
            throw fail(400, 'bad_request', 'cursor must be a next_cursor from a previous response');
          }
          // Strictly after (ts, id): the equal-timestamp tail is why the id is
          // part of the cursor at all. Two boards touched in the same
          // transaction share a timestamp, and `gt` on the timestamp alone
          // would drop whichever came second.
          q += `&or=(updated_at.gt.${encodeURIComponent(ts)},`
             + `and(updated_at.eq.${encodeURIComponent(ts)},id.gt.${encodeURIComponent(cid)}))`;
        }
      } else {
        q += `&order=created_at.asc&offset=${offset}`;
      }

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
      const boards = await decorateBoards(env, token, page.items, include);
      if (!delta) return json({ boards, ...pageMeta(page) });
      const last = page.items[page.items.length - 1];
      return json({
        boards,
        limit,
        has_more: page.has_more,
        next_cursor: page.has_more && last ? `${last.updated_at}|${last.id}` : null,
      });
    }

    if (method === 'POST' && Array.isArray(body.boards)) {
      // Bulk create. A 25TB library is a board TREE — a board per scene, reel
      // or shoot — so a migration's first act is making thousands of them, and
      // one round trip each is the slowest possible way to do it. Two inserts
      // total, whatever the count.
      const incoming = body.boards;
      if (!incoming.length) throw fail(400, 'bad_request', 'boards is empty');
      if (incoming.length > MAX_BOARDS_PER_CALL) {
        throw fail(400, 'bad_request', `at most ${MAX_BOARDS_PER_CALL} boards per call`);
      }

      let defaultWs = body.workspace_id;
      if (defaultWs && !isUuid(defaultWs)) throw fail(400, 'bad_request', 'workspace_id must be a uuid');
      if (!defaultWs) {
        const ws = await userRpc(env, token, 'get_or_create_personal_workspace',
          { p_user_id: auth.userId, p_name: 'Personal' });
        defaultWs = (Array.isArray(ws) ? ws[0] : ws)?.id;
      }
      if (!defaultWs) throw fail(400, 'bad_request', 'could not resolve a workspace');

      // Validated in full BEFORE anything is written, so a bad entry at index
      // 900 is a clean 400 rather than 900 boards and an error.
      const prepared = incoming.map((b, i) => {
        const nm = String(b?.name || '').trim();
        if (!nm) throw fail(400, 'bad_request', `boards[${i}].name is required`);
        const ws = b.workspace_id || defaultWs;
        if (!isUuid(ws)) throw fail(400, 'bad_request', `boards[${i}].workspace_id must be a uuid`);
        if (b.parent_board_id && !isUuid(b.parent_board_id)) {
          throw fail(400, 'bad_request', `boards[${i}].parent_board_id must be a uuid`);
        }
        let meta;
        try {
          meta = metaFromBody(b);
        } catch (e) {
          e.message = `boards[${i}]: ${e.message}`;
          throw e;
        }
        return {
          id: crypto.randomUUID(),
          workspace_id: ws,
          parent_board_id: b.parent_board_id || null,
          name: nm.slice(0, 200),
          view: b.view === 'list' ? 'list' : 'canvas',
          created_by: auth.userId,
          _props: meta.props,
          _identifiers: meta.identifiers,
        };
      });

      // on_conflict: "identifier" — the difference between an import you can run
      // twice and one you can run once. Without it a re-run creates a second
      // copy of everything, which is why every synchroniser that has to work
      // this way ends up maintaining its own id map instead.
      const upsert = body.on_conflict === 'identifier';
      let existingFor = prepared.map(() => null);
      if (upsert) {
        const byWs = new Map();
        for (const b of prepared) {
          if (!b._identifiers?.length) continue;
          if (!byWs.has(b.workspace_id)) byWs.set(b.workspace_id, []);
          byWs.get(b.workspace_id).push(...b._identifiers);
        }
        const matches = new Map();
        for (const [wsId, idents] of byWs) {
          const found = await matchIdentifiers(env, token,
            { workspaceId: wsId, objectType: 'board', identifiers: idents });
          for (const [k, v] of found) matches.set(k, v);
        }
        existingFor = resolveUpsert(
          prepared.map((b) => ({ identifiers: b._identifiers })),
          matches, { objectType: 'board' },
        ).map((r) => r.existing);
      }

      const creates = [];
      const updates = [];
      prepared.forEach((b, i) => {
        const hit = existingFor[i];
        if (hit) {
          // Keep the EXISTING id. That is the point — the caller's downstream
          // references, and its own record of what it created last time, stay
          // valid across runs.
          b.id = hit.board_id;
          updates.push(b);
        } else {
          creates.push(b);
        }
      });

      const now = new Date().toISOString();
      if (creates.length) {
        // RLS still decides: one INSERT as the user, so a workspace they cannot
        // write is refused for the whole batch rather than partly applied.
        await userInsert(env, token, 'boards',
          creates.map(({ _props, _identifiers, ...row }) => row), { returning: 'minimal' });

        // Every board needs its empty snapshot or it cold-loads as broken
        // rather than as empty. Identical bytes for all, so encode once.
        const doc = new Y.Doc();
        const b64 = bytesToB64(Y.encodeStateAsUpdate(doc));
        doc.destroy();
        await userInsert(env, token, 'board_state',
          creates.map((b) => ({ board_id: b.id, doc: b64, updated_at: now })),
          { returning: 'minimal' });
      }
      if (updates.length) {
        // Upsert by id rather than one PATCH each: 500 matched boards would
        // otherwise be 500 round trips. created_by is deliberately absent so a
        // re-run does not rewrite who made the board.
        await userInsert(env, token, 'boards', updates.map((b) => ({
          id: b.id,
          workspace_id: b.workspace_id,
          name: b.name,
          view: b.view,
          parent_board_id: b.parent_board_id,
        })), { returning: 'minimal', onConflict: 'id' });
      }

      // Metadata for every board in the batch, in a fixed handful of queries.
      // Grouped by workspace because that is what the rows are keyed on.
      for (const wsId of new Set(prepared.map((b) => b.workspace_id))) {
        const entries = prepared
          .filter((b) => b.workspace_id === wsId)
          .map((b) => ({ objectId: b.id, boardId: b.id, props: b._props, identifiers: b._identifiers }));
        await saveMetaBulk(env, token, {
          workspaceId: wsId, objectType: 'board', entries, userId: auth.userId,
        });
      }

      const createdIds = new Set(creates.map((b) => b.id));
      return json({
        boards: prepared.map((b) => ({
          ...publicBoard({ ...b, created_at: now }),
          created: createdIds.has(b.id),
        })),
        created: creates.length,
        updated: updates.length,
      }, 201);
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
      const meta = metaFromBody(body);

      // Same create-or-update rule as the bulk form, so a caller does not have
      // to switch shapes to get the behaviour.
      let existing = null;
      if (body.on_conflict === 'identifier' && meta.identifiers?.length) {
        const matches = await matchIdentifiers(env, token, {
          workspaceId, objectType: 'board', identifiers: meta.identifiers,
        });
        existing = resolveUpsert([{ identifiers: meta.identifiers }], matches,
          { objectType: 'board' })[0].existing;
      }

      // The id is generated HERE rather than by the database, for the reason
      // boardsApi.js:684 documents: INSERT…RETURNING re-runs the boards SELECT
      // policy, which cannot see the row it is inserting, so Postgres reports a
      // misleading RLS violation for an insert it actually allowed.
      const boardId = existing ? existing.board_id : crypto.randomUUID();
      trace.target = boardId;

      if (existing) {
        await userPatch(env, token, 'boards', `id=eq.${boardId}`, {
          name: name.slice(0, 200),
          view: body.view === 'list' ? 'list' : 'canvas',
        });
      } else {
        await userInsert(env, token, 'boards', [{
          id: boardId,
          workspace_id: workspaceId,
          parent_board_id: body.parent_board_id || null,
          name: name.slice(0, 200),
          view: body.view === 'list' ? 'list' : 'canvas',
          created_by: auth.userId,
        }], { returning: 'minimal' });

        // Seed the empty snapshot, exactly as createBoard does — a board with
        // no board_state row loads as broken rather than as empty.
        const doc = new Y.Doc();
        const b64 = bytesToB64(Y.encodeStateAsUpdate(doc));
        doc.destroy();
        await userInsert(env, token, 'board_state',
          [{ board_id: boardId, doc: b64, updated_at: new Date().toISOString() }],
          { returning: 'minimal' });
      }

      await saveMeta(env, token, {
        workspaceId, boardId, objectType: 'board', objectId: boardId,
        props: meta.props, identifiers: meta.identifiers, userId: auth.userId,
      });

      const created = await boardForUser(env, token, boardId);
      return json({
        board: publicBoard(created || { id: boardId, name, workspace_id: workspaceId }),
        created: !existing,
      }, existing ? 200 : 201);
    }

    // DELETE /boards — bulk soft-delete
    if (method === 'DELETE') {
      const ids = (Array.isArray(body.board_ids) ? body.board_ids : []).map(String).filter(Boolean);
      if (!ids.length) throw fail(400, 'bad_request', 'board_ids is required');
      if (ids.length > MAX_BOARDS_PER_CALL) {
        throw fail(400, 'bad_request', `at most ${MAX_BOARDS_PER_CALL} boards per call`);
      }
      const bad = ids.filter((b) => !isUuid(b));
      if (bad.length) throw fail(400, 'bad_request', `board_ids must be uuids — got ${bad[0]}`);

      // One RPC per board, as the single delete does. soft_delete_board is the
      // app's own path and going around it would leave the Trash and restore
      // working on something this had already changed differently.
      const deleted = [];
      const failed = [];
      for (const bid of ids) {
        try {
          await userRpc(env, token, 'soft_delete_board', { p_board_id: bid });
          deleted.push(bid);
        } catch (_) {
          failed.push(bid);
        }
      }
      return json({
        deleted: deleted.length,
        board_ids: deleted,
        failed,
        restorable: true,
        restore_with: 'POST /api/v1/boards/:id/restore',
      });
    }

    throw fail(405, 'method_not_allowed', 'method not allowed');
  }

  // POST /boards/move — bulk reparent
  //
  // move_boards_under has always taken a uuid[]; this API had only ever passed
  // it a single-element array. It is the ONLY write path for parent_board_id
  // (0118) and the only thing that checks for cycles, so restructuring a show
  // tree goes through it, in one call, with per-board reasons for anything it
  // refused rather than one opaque failure for the batch.
  if (id === 'move' && method === 'POST') {
    trace.route = '/boards/move';
    const ids = (Array.isArray(body.board_ids) ? body.board_ids : []).map(String).filter(Boolean);
    if (!ids.length) throw fail(400, 'bad_request', 'board_ids is required');
    if (ids.length > MAX_BOARDS_PER_CALL) {
      throw fail(400, 'bad_request', `at most ${MAX_BOARDS_PER_CALL} boards per call`);
    }
    const bad = ids.filter((b) => !isUuid(b));
    if (bad.length) throw fail(400, 'bad_request', `board_ids must be uuids — got ${bad[0]}`);
    const target = body.parent_board_id ?? null;
    if (target && !isUuid(target)) {
      throw fail(400, 'bad_request', 'parent_board_id must be a uuid or null');
    }

    const out = await userRpc(env, token, 'move_boards_under',
      { p_child_ids: ids, p_target_id: target });
    return json({
      moved: (out?.moved || []).length,
      board_ids: out?.moved || [],
      // Named reasons — missing, self, no-write, cross-workspace, same-parent,
      // cycle — because "it did not work" is not something a caller can act on.
      skipped: out?.skipped || [],
      parent_board_id: target,
    });
  }

  // GET /boards/tree?root=&workspace=&depth=
  //
  // The hierarchy in ONE call. GET /boards?parent= returns a single level, so
  // walking a show's structure — title → department → sequence → shot — costs a
  // request per node, and the first thing any integration does is walk the
  // structure. Backed by a recursive CTE that checks authorization once at the
  // root, because can_read_board grants on any readable ancestor: everything
  // beneath a board you can read is a board you can read, and asking per row
  // would make it quadratic for no added safety.
  if (id === 'tree' && method === 'GET') {
    trace.route = '/boards/tree';
    const root = url.searchParams.get('root');
    const ws = url.searchParams.get('workspace');
    const depth = Number(url.searchParams.get('depth'));
    if (!root && !ws) throw fail(400, 'bad_request', 'pass root (a board id) or workspace');
    if (root && !isUuid(root)) throw fail(400, 'bad_request', 'root must be a uuid');
    if (ws && !isUuid(ws)) throw fail(400, 'bad_request', 'workspace must be a uuid');

    const rows = await userRpc(env, token, 'board_tree', {
      p_root: root || null,
      p_workspace: ws || null,
      p_depth: Number.isFinite(depth) ? Math.round(depth) : 10,
    });
    return json({
      root: root || null,
      workspace_id: ws || null,
      boards: (rows || []).map((b) => ({
        id: b.id,
        parent_board_id: b.parent_board_id,
        name: b.name,
        view: b.view,
        workspace_id: b.workspace_id,
        depth: b.depth,
        card_count: b.card_count,
        created_at: b.created_at,
        updated_at: b.updated_at,
        deleted: !!b.deleted,
      })),
      count: (rows || []).length,
    });
  }

  if (!isUuid(id)) throw fail(400, 'bad_request', 'board id must be a uuid');
  trace.target = id;

  // ── /boards/:id ────────────────────────────────────────────────────────────
  if (!sub) {
    trace.route = '/boards/:id';
    if (method === 'GET') {
      const include = parseInclude(url, ['props', 'identifiers']);
      const b = await boardForUser(env, token, id, { includeDeleted: true });
      if (!b) throw fail(404, 'not_found', 'board not found');
      // Capacity comes back with the board so a caller learns it is near the
      // cap BEFORE a write fails with a 402 it has to interpret.
      const capRows = await userRpc(env, token, 'get_board_capacity', { p_board_id: id }).catch(() => null);
      const cap = Array.isArray(capRows) ? capRows[0] : capRows;
      return json({
        board: (await decorateBoards(env, token, [b], include))[0],
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

      const meta = metaFromBody(body);
      await saveMeta(env, token, {
        workspaceId: b.workspace_id, boardId: id, objectType: 'board', objectId: id,
        props: meta.props, identifiers: meta.identifiers, userId: auth.userId,
      });

      const after = await boardForUser(env, token, id);
      const include = parseInclude(url, ['props', 'identifiers']);
      return json({ board: (await decorateBoards(env, token, [after], include))[0] });
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

  // GET /boards/:id/export?format=json|omc
  //
  // There was no way to get a board out. The card read is a 12-field projection
  // and every kind the API cannot create — grid, palette, schedule — read back
  // with its interior missing, so "export" meant "lose the parts we do not
  // model". That is a bad answer for a backup and a worse one for an archive.
  //
  // `json` is everything, verbatim. `omc` is MovieLabs OMC-JSON: the format a
  // studio's own standards body defined for exactly this, and the one thing in
  // this API that will still mean something to somebody in ten years.
  if (sub === 'export' && method === 'GET') {
    trace.route = '/boards/:id/export';
    const format = (url.searchParams.get('format') || 'json').toLowerCase();
    if (!['json', 'omc'].includes(format)) {
      throw fail(400, 'bad_request', 'format must be json or omc');
    }
    const b = await boardForUser(env, token, id, { includeDeleted: true });
    if (!b) throw fail(404, 'not_found', 'board not found');

    const cards = await readBoardCards(env, id, token);
    const [boardMetaMap, cardMeta] = await Promise.all([
      loadBoardsMeta(env, token, [id]),
      loadMeta(env, token, { boardId: id, objectType: 'card', objectIds: cards.map((c) => c.id) }),
    ]);
    const boardMeta = boardMetaMap.get(id) || {};

    if (format === 'omc') {
      return json(boardToOmc({
        board: b, cards: cards.map(publicCard), boardMeta, cardMeta, origin: url.origin,
      }));
    }

    return json({
      format: 'soleil.board.v1',
      exported_at: new Date().toISOString(),
      board: { ...publicBoard(b), props: boardMeta.props ?? {}, identifiers: boardMeta.identifiers ?? [] },
      // The card exactly as stored, alongside the projection. A caller
      // reconstructing this board elsewhere needs the former; one reading it
      // wants the latter.
      cards: cards.map((c) => ({
        ...publicCard(c),
        raw: c,
        props: cardMeta.get(String(c.id))?.props ?? {},
        identifiers: cardMeta.get(String(c.id))?.identifiers ?? [],
      })),
      count: cards.length,
    });
  }

  if (sub !== 'cards') throw fail(404, 'not_found', 'unknown endpoint');

  // ── /boards/:id/cards ──────────────────────────────────────────────────────
  const board = await boardForUser(env, token, id);
  if (!board) throw fail(404, 'not_found', 'board not found');

  if (!subId && method === 'GET') {
    trace.route = '/boards/:id/cards';
    const { limit, offset } = pageParams(url);
    const include = parseInclude(url, ['props', 'identifiers', 'raw']);

    // ?source=index — the projection in card_index instead of the Y.Doc.
    //
    // The default below is the truth and stays the default, but it costs a
    // whole-document load per call: `limit`/`offset` there are applied AFTER
    // the board is in memory, so paging a large board re-downloads it once per
    // page and `total` is only knowable by reading all of it. That is fine for
    // a hundred cards and quadratic for a migration verifying a million.
    //
    // card_index is already the row-per-card mirror the triple write maintains,
    // it is indexed on (board_id, card_id), and RLS covers it. It carries a
    // PROJECTION, not the card — enough to reconcile what exists, not enough to
    // rebuild one — so it is opt-in and says so.
    if (url.searchParams.get('source') === 'index') {
      const after = url.searchParams.get('cursor');
      const since = url.searchParams.get('since');
      // Same two modes as GET /boards: ordered by id for a full walk, by
      // updated_at for a change feed. The (board_id, updated_at) index added in
      // 0222 is what makes the second one cheap.
      const delta = !!since;
      let q = `board_id=eq.${id}&select=card_id,kind,title,body,meta,updated_at`
        + `&limit=${limit + 1}`;
      if (delta) {
        if (Number.isNaN(Date.parse(since))) {
          throw fail(400, 'bad_request', 'since must be an ISO timestamp');
        }
        q += `&updated_at=gte.${encodeURIComponent(since)}&order=updated_at.asc,card_id.asc`;
        if (after) {
          const [ts, cid] = String(after).split('|');
          if (!ts || !cid) throw fail(400, 'bad_request', 'cursor must be a next_cursor from a previous response');
          q += `&or=(updated_at.gt.${encodeURIComponent(ts)},`
             + `and(updated_at.eq.${encodeURIComponent(ts)},card_id.gt.${encodeURIComponent(cid)}))`;
        }
      } else {
        q += '&order=card_id.asc';
        if (after) q += `&card_id=gt.${encodeURIComponent(after)}`;
      }
      const rows = await userSelect(env, token, 'card_index', q);
      const page = paginate(rows, limit, 0);
      const last = page.items[page.items.length - 1];

      let cards = page.items.map((r) => {
        const pos = r.meta?.pos || {};
        return {
          id: r.card_id,
          kind: r.kind || 'note',
          title: r.title ?? null,
          body: r.body ?? null,
          x: pos.x ?? null, y: pos.y ?? null, w: pos.w ?? null, h: pos.h ?? null,
          image_key: keyFromSrc(r.meta?.src),
          url: r.meta?.url ?? null,
          updated_at: r.updated_at,
        };
      });
      if (include.has('props') || include.has('identifiers')) {
        const meta = await loadMeta(env, token, {
          boardId: id, objectType: 'card', objectIds: cards.map((c) => c.id),
        });
        cards = cards.map((c) => filterMeta(withMeta(c, meta.get(String(c.id)) || {}), include));
      }

      return json({
        board_id: id,
        source: 'index',
        cards,
        limit,
        has_more: page.has_more,
        next_cursor: page.has_more && last
          ? (delta ? `${last.updated_at}|${last.card_id}` : last.card_id)
          : null,
      });
    }

    // Read through the live room when we can, so a card added seconds ago by a
    // collaborator is visible rather than missing until the next snapshot.
    const all = await readBoardCards(env, id, token);
    const slice = all.slice(offset, offset + limit + 1);
    const page = paginate(slice, limit, offset);
    return json({
      board_id: id,
      source: 'live',
      cards: await decorateCards(env, token, id, page.items, include),
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
    const metas = incoming.map((c, i) => {
      try {
        return metaFromBody(c);
      } catch (e) {
        e.message = `cards[${i}]: ${e.message}`;
        throw e;
      }
    });

    // on_conflict: "identifier" — a card that already carries one of these
    // identifiers is UPDATED rather than added a second time. This is what lets
    // an importer re-run over three million assets without producing six.
    if (body.on_conflict === 'identifier') {
      const all = metas.flatMap((m) => m.identifiers || []);
      const matches = await matchIdentifiers(env, token, {
        workspaceId: board.workspace_id, objectType: 'card', identifiers: all,
      });
      const resolvedHits = resolveUpsert(
        metas.map((m) => ({ identifiers: m.identifiers })),
        matches, { objectType: 'card', boardId: id },
      );

      const updateIdx = [];
      const createIdx = [];
      resolvedHits.forEach((r, i) => (r.existing ? updateIdx : createIdx).push(i));

      // Existing cards first, in ONE board open — see updateCardsOnBoard.
      let updatedCards = [];
      if (updateIdx.length) {
        const out = await updateCardsOnBoard(env, {
          boardId: id, workspaceId: board.workspace_id, userId: auth.userId, accessToken: token,
          patches: updateIdx.map((i) => ({
            cardId: resolvedHits[i].existing.object_id,
            patch: (before) => normalizeIncomingCard(incoming[i],
              { partial: true, existingKind: before?.kind }),
          })),
        });
        updatedCards = out.filter(Boolean);
      }

      let createdCards = [];
      if (createIdx.length) {
        const fresh = createIdx.map((i) => built[i]);
        const positionedFresh = fresh.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y));
        const res = await addCardsToBoard(env, {
          boardId: id, workspaceId: board.workspace_id, userId: auth.userId, accessToken: token,
          ...(positionedFresh ? { appendCards: fresh } : {}),
          buildCards: async (existing) => layoutCards(fresh, existing),
        });
        createdCards = res.cards;
      }

      // Map each response position back to the card that ended up there, so the
      // caller can pair its input with what happened to it.
      const createdById = new Map(createdCards.map((c, n) => [createIdx[n], c]));
      const updatedById = new Map(updateIdx.map((i, n) => [i, updatedCards[n]]));
      const finalCards = incoming.map((_, i) => createdById.get(i) || updatedById.get(i)).filter(Boolean);

      await saveMetaBulk(env, token, {
        workspaceId: board.workspace_id, boardId: id, objectType: 'card',
        userId: auth.userId,
        entries: incoming.map((_, i) => {
          const card = createdById.get(i) || updatedById.get(i);
          return card
            ? { objectId: card.id, props: metas[i].props, identifiers: metas[i].identifiers }
            : null;
        }).filter(Boolean),
      });

      return json({
        board_id: id,
        cards: finalCards.map(publicCard),
        created: createIdx.length,
        updated: updateIdx.length,
        live: true,
      }, 201);
    }

    // THE SCALING RULE, and it is a contract worth stating plainly: a batch in
    // which EVERY card carries its own x and y is appended without reading the
    // board at all — O(batch), the same cost on a board of ten cards and a
    // board of a hundred thousand. Leave out coordinates and we have to load
    // the whole document to lay out around what is already there, which is
    // correct, convenient, and O(board).
    //
    // A bulk import always knows where it wants things, so it always gets the
    // fast path. An assistant adding one note does not, and should not have to.
    const positioned = built.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y));

    const result = await addCardsToBoard(env, {
      boardId: id,
      workspaceId: board.workspace_id,
      userId: auth.userId,
      accessToken: token,
      ...(positioned ? { appendCards: built } : {}),
      // Positioned by the same helper Scout uses, so cards arriving from an API
      // call cannot land on top of what is already there. A caller that supplied
      // explicit x/y keeps them.
      buildCards: async (existing) => layoutCards(built, existing),
    });

    // Metadata is keyed on the card id the server assigned, so it can only be
    // written once the cards exist.
    await saveMetaBulk(env, token, {
      workspaceId: board.workspace_id, boardId: id, objectType: 'card',
      userId: auth.userId,
      entries: result.cards.map((c, i) => ({
        objectId: c.id, props: metas[i]?.props, identifiers: metas[i]?.identifiers,
      })),
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

  // PATCH /boards/:id/cards — bulk patch
  //
  // ONE board open for the whole batch, not one per card. The second pass of a
  // re-runnable import is exactly this shape, and updateCardOnBoard opens,
  // syncs, commits and closes each time — fine for one card, ruinous for five
  // hundred.
  if (!subId && method === 'PATCH') {
    trace.route = '/boards/:id/cards';
    const incoming = Array.isArray(body.cards) ? body.cards : [];
    if (!incoming.length) throw fail(400, 'bad_request', 'cards is required');
    if (incoming.length > MAX_CARDS_PER_CALL) {
      throw fail(400, 'bad_request', `at most ${MAX_CARDS_PER_CALL} cards per call`);
    }
    const ids = incoming.map((c, i) => {
      const cid = String(c?.id ?? '').trim();
      if (!cid) throw fail(400, 'bad_request', `cards[${i}].id is required`);
      return cid;
    });
    const metas = incoming.map((c, i) => {
      try {
        return metaFromBody(c);
      } catch (e) {
        e.message = `cards[${i}]: ${e.message}`;
        throw e;
      }
    });

    const out = await updateCardsOnBoard(env, {
      boardId: id, workspaceId: board.workspace_id, userId: auth.userId, accessToken: token,
      patches: incoming.map((c, i) => ({
        cardId: ids[i],
        patch: (before) => normalizeIncomingCard(c, { partial: true, existingKind: before?.kind }),
      })),
    });

    await saveMetaBulk(env, token, {
      workspaceId: board.workspace_id, boardId: id, objectType: 'card', userId: auth.userId,
      entries: out.map((c, i) => (c
        ? { objectId: c.id, props: metas[i].props, identifiers: metas[i].identifiers }
        : null)).filter(Boolean),
    });

    // A card id that was not on the board is reported, not silently dropped —
    // a bulk patch that quietly does nothing for some of its input is worse
    // than one that fails.
    const missing = ids.filter((_, i) => !out[i]);
    return json({
      board_id: id,
      cards: out.filter(Boolean).map(publicCard),
      updated: out.filter(Boolean).length,
      not_found: missing,
    });
  }

  // DELETE /boards/:id/cards — bulk delete
  if (!subId && method === 'DELETE') {
    trace.route = '/boards/:id/cards';
    const cardIds = (Array.isArray(body.card_ids) ? body.card_ids : []).map(String).filter(Boolean);
    if (!cardIds.length) throw fail(400, 'bad_request', 'card_ids is required');
    if (cardIds.length > MAX_CARDS_PER_CALL) {
      throw fail(400, 'bad_request', `at most ${MAX_CARDS_PER_CALL} cards per call`);
    }
    const removed = await deleteCardsFromBoard(env, {
      boardId: id, accessToken: token, cardIds,
    });
    await purgeCardMeta(env, token, { boardId: id, cardIds });
    // Every removed card comes back in full, for the same reason the single
    // delete does it: an HTTP client has no undo toast, so the response body IS
    // the undo.
    return json({
      deleted: removed.length,
      cards: removed.map(publicCard),
      not_found: cardIds.filter((c) => !removed.some((r) => String(r.id) === c)),
      restore_with: `POST /api/v1/boards/${id}/cards`,
    });
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

    // Metadata rows carry board_id so RLS can be can_read_board without
    // recursing, which means a move has to repoint them — otherwise they end up
    // readable only by someone who can read a board the card is no longer on.
    //
    // The destination id can differ from the source id: moveCardsBetweenBoards
    // renames a card on collision, and it reports the new id in `moved`.
    await repointCardMeta(env, token, {
      fromBoardId: id,
      toBoardId: to,
      workspaceId: dest.workspace_id,
      idPairs: out.moved.map((c, n) => ({ from: cardIds[n], to: c.id })),
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

    const meta = metaFromBody(body);
    await saveMeta(env, token, {
      workspaceId: board.workspace_id, boardId: id, objectType: 'card', objectId: subId,
      props: meta.props, identifiers: meta.identifiers, userId: auth.userId,
    });

    const include = parseInclude(url, ['props', 'identifiers', 'raw']);
    return json({ card: (await decorateCards(env, token, id, [updated], include))[0] });
  }

  // DELETE /boards/:id/cards/:cardId
  if (method === 'DELETE') {
    trace.route = '/boards/:id/cards/:cardId';
    const removed = await deleteCardsFromBoard(env, {
      boardId: id, accessToken: token, cardIds: [subId],
    });
    if (!removed.length) throw fail(404, 'not_found', 'card not found');

    // A card is a Y.Doc key, not a row, so nothing cascades for it. Without this
    // the deleted card's identifier would hold its (scope, value) forever and
    // the next import would fail to re-create the card it names.
    await purgeCardMeta(env, token, { boardId: id, cardIds: [subId] });

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
