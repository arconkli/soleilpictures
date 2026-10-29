// worker-showcase.js — GET /api/showcase-shot/<board id>/<file>?s=<sig>[&dl=<name>]
//
// Serves the boards engine's shots (desktop, phone, wide, close-ups, the zip) to
// the admin's Boards tab. The shots live in the images bucket under
// showcase/<board id>/<file>; nothing outside that prefix can be reached here.
//
// The gate is a signature in the URL, made by showcase_library() in the database
// (migration 0820, _showcase_shot_sig): the email-card secret (app_config
// 'email_thumb_hmac'), key = sha256(secret + ':email-thumb-v1'), HMAC-SHA256 over
// 'showcase-shot:<board id>/<file>', first 32 hex. An <img> can't carry the
// admin's session, so the page gets links that are already signed. Keep this and
// the migration in lockstep; workerShowcase.test.mjs pins both to one value.

const BOARD_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_RE = /^[a-z0-9][a-z0-9._-]{0,80}$/;

export const SHOWCASE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  zip: 'application/zip',
};

const extOf = (file) => (file.match(/\.([a-z0-9]+)$/) || [])[1] || '';

export function showcaseShotPath(pathname) {
  const m = String(pathname || '').match(/^\/api\/showcase-shot\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  const boardId = m[1].toLowerCase();
  const file = m[2];
  if (!BOARD_RE.test(boardId) || !FILE_RE.test(file) || file.includes('..')) return null;
  if (!SHOWCASE_TYPES[extOf(file)]) return null;
  return { boardId, file, key: `showcase/${boardId}/${file}` };
}

export async function showcaseShotSig(secret, boardId, file) {
  const enc = new TextEncoder();
  const keyBytes = await crypto.subtle.digest('SHA-256', enc.encode(`${secret}:email-thumb-v1`));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`showcase-shot:${boardId}/${file}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// A download name the browser can't be tricked by: letters, digits, dot, dash,
// underscore; the shot's own extension kept.
export function downloadName(asked, file) {
  const ext = extOf(file);
  const base = String(asked || '').replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '').slice(0, 100);
  return `${base || file.replace(/\.[a-z0-9]+$/, '')}.${ext}`;
}

const plain = (status, text) => new Response(text, {
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
});

// deps.secret(): the email-card secret (worker.js passes its cached reader).
export async function handleShowcaseShot(url, request, env, deps) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'GET only');
  const at = showcaseShotPath(url.pathname);
  if (!at) return plain(404, 'Not found');

  let secret = '';
  try { secret = await deps.secret(); } catch { return plain(503, 'Signature unavailable'); }
  if (!secret) return plain(503, 'Signature unavailable');
  const expected = await showcaseShotSig(secret, at.boardId, at.file);
  if (!sameText(url.searchParams.get('s') || '', expected)) return plain(403, 'Bad signature');

  if (!env.IMAGES) return plain(503, 'No bucket');
  const obj = await env.IMAGES.get(at.key);
  if (!obj) return plain(404, 'Not found');

  const headers = {
    'content-type': SHOWCASE_TYPES[extOf(at.file)],
    'cache-control': 'private, max-age=3600',
    'etag': obj.httpEtag,
    'x-robots-tag': 'noindex',
    'x-content-type-options': 'nosniff',
  };
  if (url.searchParams.has('dl')) {
    headers['content-disposition'] = `attachment; filename="${downloadName(url.searchParams.get('dl'), at.file)}"`;
  }
  if (request.headers.get('if-none-match') === obj.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers });
}
