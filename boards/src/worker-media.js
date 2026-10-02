// worker-media.js — POST /api/media/save-url: keep a copy of a web image.
//
// An image dragged in from another tab used to stay a HOTLINK: the card
// pointed at somebody else's server and broke the day that page moved, a
// signed CDN link expired, or the picture went behind a login. A board is
// where reference is kept, so the canvas now asks this route for a copy in the
// workspace's own storage and moves the card onto it when the copy lands. Until
// then the card is the hotlink it always was — and it stays one for good when
// no copy can be made, which costs nothing that was not already the case.
//
// It is the browser's twin of the API's URL import (worker-api.js,
// POST /boards/:id/import) and holds the same lines, plus one:
//   · Every hop is checked (safeUrl.fetchFollowingSafely). A public page
//     cannot 302 the Worker at an internal address.
//   · The BYTES decide what was fetched — never the Content-Type somebody
//     else's server sent (imageDims.sniffImageType). HTML, script and SVG
//     labelled image/png are refused, so the bucket never holds a document
//     under a picture's key. (The one addition over the API import.)
//   · The caller's own session does every database step, so PostgREST runs
//     RLS as them — lib/apiAuth.js says why the service key is never used for
//     this. can_write_board fails CLOSED; the storage ceiling
//     (authorize_image_upload) fails OPEN on an RPC error, as the browser
//     presign gate does (party/upload.ts says why the two differ).
//   · The workspace comes from the board, never from the request, and the key
//     is `<workspace>/<uuid>.<ext>` like every other original.
//   · The images row is load-bearing: it authorizes reads and keeps the R2
//     sweep off the object. If it cannot be written, the object is deleted
//     before the error goes back, so a failed save leaves nothing behind.
//   · Addresses are never logged whole — a signed CDN link is a credential.
//
// The same picture saved twice in one workspace is stored once: a row with
// the same source_url (0357) is reused while its object exists. A cluster
// other than the first can show it, because image reads follow the keys in
// each board's own snapshot (recompute_image_refs) — the same way a card
// pasted between clusters keeps working.
//
// No previews are made here (a Worker has no decoder). The canvas makes them
// the first time a writer sees the image, which is immediately: R2Image's
// on-view backfill, the path every image without previews already takes.

import { verifyUser } from './lib/workerAuth.js';
import { userSelect, userRpc, userInsert } from './lib/apiAuth.js';
import { fetchFollowingSafely, ogTargetProblem, UnsafeFetchError } from './lib/safeUrl.js';
import { sniffImageType, imageDimensions } from './lib/imageDims.js';
import {
  WEB_IMAGE, SAVEABLE_TYPES, SaveError, webImageUrlProblem, nameFromImageUrl,
  readCapped, makeRateLimiter,
} from './lib/webImageSave.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARD_ID_RE = /^[\w-]{1,100}$/;
// A response that says it is a page or data is not read at all. The bytes
// still decide every YES; this only saves pulling a page to learn it is one.
const NOT_A_PICTURE_RE = /^(text\/|application\/(json|xml|javascript|xhtml\+xml)|image\/svg)/i;

const DEFAULT_DEPS = {
  verifyUser,
  userSelect,
  userRpc,
  userInsert,
  fetchImpl: (...args) => fetch(...args),
  uuid: () => crypto.randomUUID(),
  allow: makeRateLimiter(),
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const hostOf = (raw) => { try { return new URL(raw).host; } catch { return '?'; } };

export async function handleMediaRoute(url, request, env, deps = {}) {
  if (url.pathname !== '/api/media/save-url') return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const d = { ...DEFAULT_DEPS, ...deps };

  const auth = await d.verifyUser(request, env);
  if (!auth.ok) return json({ error: 'unauthorized' }, auth.status || 401);
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!d.allow(auth.userId)) return json({ error: 'rate_limited' }, 429);
  if (!env.IMAGES) return json({ error: 'storage_unavailable' }, 503);

  let body = null;
  try { body = await request.json(); } catch (_) { /* answered below */ }
  const sourceUrl = typeof body?.url === 'string' ? body.url.trim() : '';
  const boardId = typeof body?.boardId === 'string' ? body.boardId : '';
  const cardId = typeof body?.cardId === 'string' && CARD_ID_RE.test(body.cardId) ? body.cardId : null;
  if (!UUID_RE.test(boardId)) return json({ error: 'bad_request', detail: 'boardId' }, 400);
  const problem = webImageUrlProblem(sourceUrl);
  if (problem) return json({ error: 'unsafe_url', detail: problem }, 422);

  try {
    const out = await saveWebImage({ env, token, userId: auth.userId, sourceUrl, boardId, cardId, d });
    return json(out, 200);
  } catch (err) {
    if (err instanceof SaveError) return json({ error: err.code }, err.status);
    if (err instanceof UnsafeFetchError) return json({ error: 'unsafe_url' }, 422);
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    console.warn('[media] save failed', hostOf(sourceUrl), timedOut ? 'timeout' : String(err?.message || err).slice(0, 120));
    return json({ error: timedOut ? 'source_unavailable' : 'save_failed' }, timedOut ? 502 : 500);
  }
}

async function saveWebImage({ env, token, userId, sourceUrl, boardId, cardId, d }) {
  // The board, as the caller sees it: a board they cannot read is a 404, and
  // its workspace — not anything the request said — is where the copy goes.
  const boards = await d.userSelect(env, token, 'boards',
    `id=eq.${boardId}&deleted_at=is.null&select=workspace_id`);
  const workspaceId = boards?.[0]?.workspace_id;
  if (!workspaceId) throw new SaveError('not_found', 404);

  // Fails CLOSED: an RPC error is not a yes.
  const canWrite = await d.userRpc(env, token, 'can_write_board', { p_board_id: boardId }).catch(() => false);
  if (canWrite !== true) throw new SaveError('not_writer', 403);

  // Stored once per workspace. A row whose object is gone (swept, or never
  // finished) is not reused — the save below makes a fresh one.
  const prior = await d.userSelect(env, token, 'images',
    `workspace_id=eq.${workspaceId}&source_url=eq.${encodeURIComponent(sourceUrl)}`
    + '&deleted_at=is.null&select=storage_path,width,height,original_name&order=created_at.desc&limit=1')
    .catch(() => []);
  const reuse = prior?.[0];
  if (reuse?.storage_path && await env.IMAGES.head(reuse.storage_path).catch(() => null)) {
    return {
      src: `r2:${reuse.storage_path}`, key: reuse.storage_path,
      width: reuse.width ?? null, height: reuse.height ?? null,
      fileName: reuse.original_name ?? null, reused: true, bytes: 0,
    };
  }

  const { res, url: finalUrl } = await fetchFollowingSafely(sourceUrl, {
    signal: AbortSignal.timeout(WEB_IMAGE.timeoutMs),
    // No cookies or credentials of ours ever ride along; an honest agent,
    // because some CDNs refuse an empty one outright.
    headers: {
      accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
      'user-agent': 'SoleilClusters-Save/1.0 (+https://clusters.soleilpictures.com)',
    },
  }, { check: ogTargetProblem, fetchImpl: d.fetchImpl });
  if (!res.ok) {
    try { await res.body?.cancel?.(); } catch (_) { /* already closed */ }
    throw new SaveError('source_unavailable', 502);
  }
  if (NOT_A_PICTURE_RE.test(res.headers.get('content-type') || '')) {
    try { await res.body?.cancel?.(); } catch (_) { /* already closed */ }
    throw new SaveError('not_an_image', 415);
  }

  const bytes = await readCapped(res, WEB_IMAGE.maxBytes);
  const type = sniffImageType(bytes);
  const ext = type ? SAVEABLE_TYPES[type] : null;
  if (!ext) throw new SaveError('not_an_image', 415);

  // The owner-pays storage ceiling, asked with the real size. Fails OPEN on
  // an RPC error — the presign gate's trade, for the same reason.
  const verdictRows = await d.userRpc(env, token, 'authorize_image_upload',
    { p_board_id: boardId, p_bytes: bytes.length }).catch(() => null);
  const verdict = Array.isArray(verdictRows) ? verdictRows[0] : verdictRows;
  if (verdict && verdict.allow !== true && verdict.reason === 'over_quota') {
    throw new SaveError('over_quota', 402);
  }

  const key = `${workspaceId}/${d.uuid()}.${ext}`;
  const dims = imageDimensions(bytes);
  const fileName = nameFromImageUrl(sourceUrl) || (finalUrl !== sourceUrl ? nameFromImageUrl(finalUrl) : null);
  await env.IMAGES.put(key, bytes, { httpMetadata: { contentType: type } });
  try {
    await d.userInsert(env, token, 'images', [{
      workspace_id: workspaceId,
      board_id: boardId,
      card_id: cardId,
      storage_path: key,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      size_bytes: bytes.length,
      uploaded_by: userId,
      original_name: fileName,
      source_url: sourceUrl,
    }], { returning: 'minimal' });
  } catch (err) {
    // No row, no way to read the object and nothing to keep the sweep off it:
    // take it back now rather than leave it to be found in 30 days.
    try { await env.IMAGES.delete(key); } catch (_) { /* the sweep's job, then */ }
    console.warn('[media] images row failed', hostOf(sourceUrl), String(err?.message || err).slice(0, 120));
    throw new SaveError('save_failed', 500, String(err?.message || err));
  }
  return {
    src: `r2:${key}`, key,
    width: dims?.width ?? null, height: dims?.height ?? null,
    fileName, reused: false, bytes: bytes.length,
  };
}
