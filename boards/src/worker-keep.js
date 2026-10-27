// worker-keep.js — a draft's keep page, from the Worker's side.
//
//   POST /api/keep/bundle  { token, board_id? }  the draft as its keep page shows it
//   GET  /api/img/<payload>.<sig>             one of its pictures, by a signed address
//
// A draft is what ChatGPT or Claude made through /mcp for someone without an
// account (lib/mcpDrafts.js, 0705). Its keep link, /keep/<token>, shows it read
// only and lets whoever holds the link keep it. The token is the key to
// keeping it, so it never goes in a path the Worker logs: the page posts it in
// a body, and its pictures come by addresses that name only the picture
// (lib/signedImage.js), signed here after mcp_draft_keep_view has said which
// pictures are the draft's.
//
// The bundle has the shape the share viewer reads (get_share_bundle's, with
// image_urls signed), plus the draft's state, host, card count and expiry. A
// draft that is kept, expired or unknown answers its state alone. Every answer
// says how long drafts last, for the page to say it. Held with drafts: where
// they aren't open, there is no draft to show.
import { draftsOpen, sha256Hex, DRAFT_LIFETIME_DAYS } from './lib/mcpDrafts.js';
import {
  imageSecret, signImageKey, verifySignedImage, servedTypeFor,
  SIGNED_IMAGE_PATH, SIGNED_IMAGE_TTL_S,
} from './lib/signedImage.js';
import { makeEdgeLimiter } from './lib/edgeLimits.js';
import { scoutRpc } from './lib/scoutDb.js';
import { reportWorkerError } from './lib/workerErrors.js';

const KEEP_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The page is the draft as it is now, and a token rides on it.
const PRIVATE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };

const bundleAllow = makeEdgeLimiter('KEEP_BUNDLE');
const imageAllow = makeEdgeLimiter('SIGNED_IMAGE');

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', ...PRIVATE, ...headers },
  });
}
const clientIp = (request) => request.headers.get('cf-connecting-ip') || 'unknown';

export async function handleKeepBundle(url, request, env, ctx) {
  if (request.method !== 'POST') {
    return json({ error: 'POST the keep link\'s token', code: 'method_not_allowed' }, 405, { allow: 'POST' });
  }
  if (!draftsOpen(url.hostname)) return json({ state: 'unknown', lifetime_days: DRAFT_LIFETIME_DAYS }, 404);
  const gate = await bundleAllow(env, clientIp(request));
  if (!gate.ok) {
    return json({ error: 'too many requests', code: 'rate_limited' }, 429, { 'retry-after': String(gate.retryAfter) });
  }
  let body = null;
  try { body = await request.json(); } catch (_) { /* answered below */ }
  const token = typeof body?.token === 'string' ? body.token.trim().toLowerCase() : '';
  if (!KEEP_TOKEN_RE.test(token)) return json({ state: 'unknown', lifetime_days: DRAFT_LIFETIME_DAYS }, 404);
  const boardId = typeof body?.board_id === 'string' && UUID_RE.test(body.board_id) ? body.board_id : null;

  let view;
  try {
    view = await scoutRpc(env, 'mcp_draft_keep_view', { p_keep_hash: await sha256Hex(token), p_board_id: boardId });
  } catch (error) {
    reportWorkerError(env, ctx, { kind: 'api', error, status: 503, code: 'keep_bundle_failed', op: 'keep_bundle' });
    return json({ error: 'the draft could not be read just now', code: 'temporarily_unavailable' }, 503, { 'retry-after': '5' });
  }
  if (view?.state !== 'live' || !view.bundle) {
    const state = ['kept', 'expired'].includes(view?.state) ? view.state : 'unknown';
    return json({ state, host: view?.host ?? null, lifetime_days: DRAFT_LIFETIME_DAYS }, state === 'unknown' ? 404 : 200);
  }

  const b = view.bundle;
  const secret = await imageSecret(env.SUPABASE_SERVICE_ROLE_KEY);
  const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_IMAGE_TTL_S;
  const imageUrls = {};
  for (const key of Array.isArray(b.image_keys) ? b.image_keys : []) {
    if (typeof key === 'string' && key) {
      imageUrls[key] = `${url.origin}${SIGNED_IMAGE_PATH}${await signImageKey(secret, key, expiresAt)}`;
    }
  }
  return json({
    state: 'live',
    host: view.host || 'other',
    expires_at: view.expires_at,
    lifetime_days: DRAFT_LIFETIME_DAYS,
    card_count: view.card_count,
    card_limit: view.card_limit,
    board: b.board,
    snapshot: b.snapshot,
    image_urls: imageUrls,
    image_meta: b.image_meta || {},
    role: 'viewer',
    root_id: b.root_id,
    include_subboards: true,
    nav_boards: Array.isArray(b.nav_boards) ? b.nav_boards : [],
  });
}

// The bytes behind a signed address, with what keeps them from being anything
// but a picture, a video or a sound on this origin: the type from the file's
// kind (servedTypeFor), nosniff, and a sandbox for anything opened on its own.
// Cross-origin readable, so the inline view in an AI chat can show them too.
export async function handleSignedImage(url, request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const signed = url.pathname.slice(SIGNED_IMAGE_PATH.length);
  const ok = await verifySignedImage(await imageSecret(env.SUPABASE_SERVICE_ROLE_KEY), signed);
  // An address past its time answers like any address that isn't one: the page
  // asks for fresh ones, and nothing says which keys exist.
  if (!ok) return new Response(null, { status: 403, headers: { 'cache-control': 'no-store' } });
  const gate = await imageAllow(env, clientIp(request));
  if (!gate.ok) {
    return new Response(null, { status: 429, headers: { 'retry-after': String(gate.retryAfter), 'cache-control': 'no-store' } });
  }
  let obj;
  try {
    obj = await env.IMAGES.get(ok.key, { range: request.headers, onlyIf: request.headers });
  } catch (_) {
    // R2 refuses a range past the file's end by throwing.
    return new Response(null, { status: 416, headers: { 'cache-control': 'no-store' } });
  }
  if (!obj) return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });

  const served = servedTypeFor(ok.key, obj.httpMetadata?.contentType);
  const maxAge = Math.max(0, ok.expiresAt - Math.floor(Date.now() / 1000));
  const headers = new Headers({
    'content-type': served.type,
    'content-disposition': served.inline ? 'inline' : 'attachment',
    'cache-control': `private, max-age=${maxAge}`,
    'cross-origin-resource-policy': 'cross-origin',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    'accept-ranges': 'bytes',
    etag: obj.httpEtag,
  });
  if (!('body' in obj) || !obj.body) return new Response(null, { status: 304, headers });
  if (obj.range && request.headers.get('range')) {
    // R2 answers a range as { offset, length? } or { suffix } (the last n bytes).
    const r = obj.range;
    const offset = r.suffix != null ? Math.max(0, obj.size - r.suffix) : (r.offset ?? 0);
    const end = r.suffix == null && r.length != null ? offset + r.length - 1 : obj.size - 1;
    headers.set('content-range', `bytes ${offset}-${end}/${obj.size}`);
    return new Response(request.method === 'HEAD' ? null : obj.body, { status: 206, headers });
  }
  return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers });
}
