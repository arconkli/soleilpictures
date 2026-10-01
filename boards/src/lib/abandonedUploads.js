// abandonedUploads — a photo whose upload died with its page.
//
// A dropped photo is placed at once as `pending: true` with no src, and its
// upload runs inside the page. If the page goes away first, the card is saved
// into the board without its file, and nothing can ever complete it: the File
// object went with the page. On 2026-09-19 a tablet backgrounded the tab a
// second and a half after a 36-photo import began. The board was saved at that
// moment with 36 photo cards and not one file behind them. Reopened, those cards
// would have spun "Uploading…" for ever, and the next index sync would have
// counted all 36 toward the cap — an account walled at 50/50 by photos that do
// not exist.
//
// A pending image card with no src, older than ABANDON_AFTER_MS, cannot be an
// upload still in flight on any reasonable connection. So:
//   • it is not indexed (boardsApi.syncCardIndex), so it never costs a card,
//     and a row it got while it was young is released by the orphan cleanup;
//   • the board sweep (CanvasSurface) RECOVERS it when its file did land and
//     only the src patch was lost — the person switched boards mid-upload, and
//     the original's images row carries the card id — and otherwise removes it,
//     and says so.
//
// Pure, so node tests every rule here.

export const ABANDON_AFTER_MS = 30 * 60 * 1000;

// `get` reads a card field: (k) => yMap.get(k) in the sync, (k) => card[k] on
// the rendered card list.
export function isAbandonedUpload(get, now = Date.now(), afterMs = ABANDON_AFTER_MS) {
  if (get('kind') !== 'image') return false;
  if (get('pending') !== true) return false;
  const src = get('src');
  if (typeof src === 'string' && src) return false;
  const at = Date.parse(get('createdAt') || '');
  // No creation stamp: too old to have one, or not placed by this app. Either
  // way not ours to judge.
  if (!Number.isFinite(at)) return false;
  return now - at > afterMs;
}

// What the sweep does with them, given which originals the images table holds.
// `found` maps card id → storage path. Recover what landed; remove the rest.
export function planAbandonedSweep(cardIds, found) {
  const recover = [];
  const remove = [];
  for (const id of cardIds || []) {
    const path = found?.get?.(id);
    if (path) recover.push({ id, src: `r2:${path}` });
    else remove.push(id);
  }
  return { recover, remove };
}

// The one line the person reads about it. Plain about what happened and what
// to do; the photos are still on their device.
export function abandonedNotice(n) {
  if (!(n > 0)) return '';
  const one = n === 1;
  return `${n} ${one ? 'photo' : 'photos'} didn't finish uploading before the page closed, so ${one ? 'it was' : 'they were'} removed. Add ${one ? 'it' : 'them'} again to keep ${one ? 'it' : 'them'}.`;
}
