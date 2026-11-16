// linkPictureKeep — our own copy of the picture a link card shows.
//
// A link card draws its site's og:image straight from that site on every view:
// slow, and gone the day the site moves it. So the first time a writer's
// browser sees one, it asks the Worker for a copy (worker-media.js, body
// `purpose: 'link'`) and writes where the copy lives onto the card or the grid
// cell, next to the picture it came from:
//
//   image       the site's address. Never changes: it is the source and the
//               fallback the card draws whenever there is no copy, or the copy
//               fails.
//   imageKey    `r2:<key>`, the FULL sentinel. The `r2:` is what the R2 sweep's
//               reference scan looks for; a bare key would be reclaimed in 30
//               days with the card still pointing at it.
//   imageKeyOf  the `image` the copy was taken from. A card whose image has
//               changed since (a new address, a refreshed preview) no longer
//               matches it, so it is drawn from the site again and kept again.
//
// The same shape as lib/hotlinkBackfill.js, which does this for dragged-in web
// images: a few per open, one at a time, and what was tried is remembered in
// this browser so a picture that can never be copied is not fetched on every
// open. A card that cannot be copied stays the link it was.
//
// Pure, apart from the storage handed in.

import { RETRY_AFTER_MS, urlKey } from './hotlinkBackfill.js';

// More than the 3 a hotlink repair gets: a link card is cheap to keep (a
// preview, never counted against anyone's storage) and a board of references
// is mostly links.
export const LINK_PER_OPEN = 8;
const MEMO_KEY = 'soleil.linkPictureTried.v1';

// Never worth asking about again. The same refusals hotlinkBackfill gives up
// on for good; the pass stops on the same ones too (hotlinkBackfill
// stopsThePass), which the canvas imports from there.
const PERMANENT = new Set(['not_an_image', 'too_large', 'unsafe_url', 'bad_request']);

export const isWebAddress = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);

// Whether this card or cell already has its copy: the sentinel is there and it
// was taken from the picture the card shows now.
export const isKept = (rec) => typeof rec?.imageKey === 'string' && rec.imageKey.startsWith('r2:')
  && rec.imageKeyOf === rec.image;

// What to draw from our own storage, or null (no copy, or a stale one): the
// `r2:<key>` for R2Image. A renderer falls back to `image` itself on null.
export const keptPicture = (rec) => (isWebAddress(rec?.image) && isKept(rec) ? rec.imageKey : null);

// Stable per (card, cell, address): what the session remembers it has asked about.
export const pictureTag = (cardId, cellId, image) => `${cardId}|${cellId ?? ''}|${image}`;

// The link pictures worth keeping now, as `{ cardId, cellId, image, tag }`
// (`cellId` is null for a link card). `cellsOf(card)` answers a grid card's
// cells as `{ cellId: record }`: they live in nested Y.Maps the card object does
// not carry (gridState.readGridModel), so the caller reads them.
// Skipped: already kept, asked about this session, known to be impossible, or
// tried in the last day.
export function pickLinkPictures(cards, {
  cellsOf = () => null, attempted = new Set(), tried = {}, now = Date.now(), limit = LINK_PER_OPEN,
} = {}) {
  const out = [];
  const consider = (cardId, cellId, rec) => {
    if (out.length >= limit) return;
    if (!isWebAddress(rec?.image) || isKept(rec)) return;
    const tag = pictureTag(cardId, cellId, rec.image);
    if (attempted.has(tag)) return;
    const memo = tried[urlKey(rec.image)];
    if (memo && (PERMANENT.has(memo.c) || now - memo.t < RETRY_AFTER_MS)) return;
    out.push({ cardId, cellId, image: rec.image, tag });
  };
  for (const c of cards || []) {
    if (out.length >= limit) break;
    if (c?.kind === 'link') consider(c.id, null, c);
    else if (c?.kind === 'grid') {
      const cells = cellsOf(c);
      if (!cells) continue;
      for (const cellId of Object.keys(cells)) {
        if (cells[cellId]?.type === 'link') consider(c.id, cellId, cells[cellId]);
      }
    }
  }
  return out;
}

// What a finished copy writes onto the card or cell. `src` is the route's
// `r2:<key>` (webImageClient has already refused anything else).
export const keptFields = (src, image) => ({ imageKey: src, imageKeyOf: image });

export function loadLinkTried(storage) {
  try {
    const v = JSON.parse(storage?.getItem?.(MEMO_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (_) { return {}; }
}

export function saveLinkTried(storage, tried) {
  try { storage?.setItem?.(MEMO_KEY, JSON.stringify(tried)); } catch (_) { /* private mode, full */ }
}
