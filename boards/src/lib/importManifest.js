// Importing reference from wherever it currently lives.
//
// WHY THIS EXISTS. The research behind the integration surface found that
// pre-production has no incumbent system: reference material lives on
// art-department NAS shares, in PureRef files on individual desktops, and in
// Miro boards on a production designer's PERSONAL account. It evaporates when
// the production company dissolves. Everything built so far assumes the
// material is already HERE — there was no import endpoint at all, so the first
// thing a studio must do to evaluate this product is re-upload a decade of
// reference by hand.
//
// This module is the manifest half: given a list of remote sources, decide what
// each one becomes. It performs no I/O. The route fetches and stores, then
// hands the resulting specs to the SAME code path POST /boards/:id/cards uses,
// so an imported card is not a second kind of card.
//
// THE PROPERTY THAT MATTERS IS RE-RUNNABILITY. Every item gets a `source_url`
// identifier by default, and the import resolves on it. So running the same
// manifest twice updates rather than duplicates — which is what makes an import
// something you can fix and repeat, rather than a one-shot you have to get
// right while a migration is half-finished. That works because
// object_identifiers already has the unique index; nothing new was needed.

import { publicHttpsUrlProblem } from './safeUrl.js';

// A Worker gets a bounded number of subrequests per request, and each item here
// costs a fetch plus a storage write. A hundred is comfortably inside that and
// large enough that a folder is one or two calls rather than twenty.
export const MAX_IMPORT_ITEMS = 100;

// Enough to keep the network busy without opening a hundred sockets at once.
export const IMPORT_CONCURRENCY = 6;

// A source that has not answered in this long is not worth holding the whole
// import open for. The item fails; the rest of the manifest still lands.
export const IMPORT_TIMEOUT_MS = 15_000;

// The identifier scope stamped on everything imported. Legible on purpose: it
// shows up in `GET /resolve?scope=source_url&value=…`, which is how you answer
// "did we already bring this one in?".
export const SOURCE_SCOPE = 'source_url';

// Provenance, under the reserved prefix — callers are refused these keys, which
// is precisely so we can write them without ever colliding with a customer's.
export const SOURCE_PROP = 'soleil.source_url';
export const IMPORTED_AT_PROP = 'soleil.imported_at';

const MAX_TITLE = 200;

function bad(message) {
  const e = new Error(message);
  e.status = 400;
  e.code = 'bad_request';
  return e;
}

/**
 * Validate a manifest. Throws on anything structurally wrong — a bad manifest
 * is a caller bug and should fail before a single byte is fetched — and returns
 * items in a normalized shape.
 */
export function normalizeImportItems(input) {
  if (!Array.isArray(input) || !input.length) {
    throw bad('items must be a non-empty array of { url }');
  }
  if (input.length > MAX_IMPORT_ITEMS) {
    throw bad(`at most ${MAX_IMPORT_ITEMS} items per import — got ${input.length}`);
  }

  const seen = new Set();
  return input.map((raw, i) => {
    const where = `items[${i}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw bad(`${where} must be an object with a url`);
    }
    const url = typeof raw.url === 'string' ? raw.url.trim() : '';
    if (!url) throw bad(`${where}.url is required`);

    // Checked here rather than at fetch time so a manifest containing one
    // internal address is refused as a whole, before anything is imported.
    const problem = publicHttpsUrlProblem(url);
    if (problem) throw bad(`${where}.url ${problem}`);

    // A duplicate inside ONE manifest is a caller mistake, not a merge: the two
    // entries would race for the same identifier and one would silently win.
    if (seen.has(url)) throw bad(`${where}.url appears twice in the same import`);
    seen.add(url);

    return {
      url,
      title: typeof raw.title === 'string' ? raw.title.slice(0, MAX_TITLE) : null,
      caption: typeof raw.caption === 'string' ? raw.caption.slice(0, MAX_TITLE) : null,
      props: raw.props ?? null,
      identifiers: raw.identifiers ?? null,
      // Coordinates are optional and pass straight through; anything without
      // them is arranged around what is already on the board.
      x: Number.isFinite(raw.x) ? raw.x : undefined,
      y: Number.isFinite(raw.y) ? raw.y : undefined,
      w: Number.isFinite(raw.w) ? raw.w : undefined,
      h: Number.isFinite(raw.h) ? raw.h : undefined,
    };
  });
}

/**
 * What a source becomes, given what the server actually got back.
 *
 * Only images are ingested. Everything else becomes a LINK card pointing at the
 * original, and the response says so per item — a manifest mixing photographs
 * with a PDF and a web page should import the photographs rather than refuse
 * the lot, but nobody should be left thinking their PDF was stored. Video and
 * other large media go through the multipart endpoints, which stream from the
 * client instead of pulling gigabytes through a Worker isolate.
 */
export function kindForContentType(contentType, { storable }) {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (ct.startsWith('image/') && storable) return 'image';
  return 'link';
}

/**
 * The reason an item did not become what the caller probably expected. Null
 * when there is nothing worth saying.
 */
export function noteFor(kind, contentType) {
  if (kind !== 'link') return null;
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (ct.startsWith('image/')) {
    return `${ct} is not a format this API stores — linked instead of imported`;
  }
  if (ct.startsWith('video/')) {
    return 'video is linked, not copied — use the multipart upload endpoints to bring the file itself in';
  }
  return `${ct || 'that source'} is not an image — linked instead of imported`;
}

/**
 * Build the card spec for one resolved item, in exactly the shape
 * POST /boards/:id/cards accepts. `stored` is the result of putting the bytes
 * away — { imageKey, width, height } — and is absent for a link card.
 */
export function cardSpecFor(item, { kind, stored = null, importedAt }) {
  const spec = { kind };

  if (kind === 'image') {
    spec.image_key = stored.imageKey;
    if (item.caption || item.title) spec.caption = item.caption || item.title;
    // Real pixel dimensions when we could read them, so the card is not laid
    // out as a square and then jump when it first renders.
    if (Number.isFinite(stored.width) && Number.isFinite(stored.height)) {
      const fitted = fitDims(stored.width, stored.height);
      spec.w = fitted.w;
      spec.h = fitted.h;
    }
  } else {
    spec.url = item.url;
    spec.title = item.title || titleFromUrl(item.url);
  }

  for (const k of ['x', 'y', 'w', 'h']) {
    if (item[k] !== undefined) spec[k] = item[k];
  }

  // Provenance the caller cannot forge, plus whatever they sent. Their props
  // are merged UNDER ours, so an import cannot be made to lie about where a
  // card came from.
  spec.props = {
    ...(item.props || {}),
    [SOURCE_PROP]: item.url,
    [IMPORTED_AT_PROP]: importedAt,
  };

  // The source identifier goes LAST so a caller's own identifier for the same
  // scope does not silently displace the one the import resolves on.
  spec.identifiers = [
    ...(item.identifiers || []).filter((x) => x?.scope !== SOURCE_SCOPE),
    { scope: SOURCE_SCOPE, value: item.url },
  ];

  return spec;
}

// A readable fallback title: the filename, minus its extension and separators.
export function titleFromUrl(raw) {
  try {
    const { pathname } = new URL(raw);
    const last = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
    const stem = last.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[-_]+/g, ' ').trim();
    return (stem || new URL(raw).hostname).slice(0, MAX_TITLE);
  } catch {
    return String(raw).slice(0, MAX_TITLE);
  }
}

// Keep a card to a sane size on the canvas while preserving aspect ratio.
const MAX_EDGE = 480;
export function fitDims(width, height) {
  if (!(width > 0) || !(height > 0)) return { w: 320, h: 240 };
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  return { w: Math.max(40, Math.round(width * scale)), h: Math.max(40, Math.round(height * scale)) };
}

/**
 * Counts for the response envelope. Imports are partially fallible by nature —
 * a URL rots, a host refuses a robot — and a call that fails wholesale because
 * one of ninety-nine links is dead is a call nobody can use for a migration.
 */
export function summarize(results) {
  return {
    imported: results.filter((r) => r.ok && r.created).length,
    updated: results.filter((r) => r.ok && r.created === false).length,
    failed: results.filter((r) => !r.ok).length,
  };
}

/**
 * Run `worker` over `items` at most `limit` at a time, preserving input order
 * in the output. Order matters: the caller matches results to the manifest they
 * sent by index.
 */
export async function mapWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}
