// The /c/<slug> page's board, asked for at our own address.
//
// A published board's page is the server-rendered article plus the live canvas,
// and the canvas comes from the party's /public-bundle. That used to be a POST
// from the browser straight to the party's host: a second origin, JSON, so a
// CORS preflight. Google's renderer stopped making it (late 2026-10: status 0
// after about a millisecond, Googlebot's own rows in client_errors), so every
// /c/ page it rendered said "Couldn't load this board", and Search Console
// filed the boards as Soft 404s.
//
// The page now asks this Worker with a plain same-origin GET: no preflight, no
// second host, nothing for a crawler's renderer to refuse. The Worker asks the
// party itself, server to server, over the PARTY service binding
// (lib/partyFetch.js). Pure, so node tests pin the shape both sides build.

export const PUBLIC_BUNDLE_PATH = '/api/public-bundle';

// The same slug rule as the /c/ route and the early fetch in worker.js.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const BOARD_ID_RE = /^[0-9a-f-]{36}$/i;

// URLSearchParams → the party's body, { slug, boardId? }, or null when the
// slug is not one. A malformed ?b= is dropped (the root board answers), the
// same as the early fetch has always done.
export function publicBundleQuery(params) {
  const slug = String(params?.get?.('slug') || '').trim();
  if (!SLUG_RE.test(slug)) return null;
  const b = String(params.get('b') || '').trim();
  return BOARD_ID_RE.test(b) ? { slug, boardId: b } : { slug };
}

// The URL the page fetches.
export function publicBundlePath(slug, boardId) {
  const q = new URLSearchParams({ slug: String(slug || '') });
  if (boardId) q.set('b', String(boardId));
  return `${PUBLIC_BUNDLE_PATH}?${q}`;
}
