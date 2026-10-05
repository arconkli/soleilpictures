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
// Two thresholds, because the two things done to such a card are not equally
// reversible:
//   • After ABANDON_AFTER_MS it is not indexed (boardsApi.syncCardIndex), so it
//     never costs a card — a row it got while young is released by the orphan
//     cleanup — and the board sweep (CanvasSurface) RECOVERS it when its file
//     did land and only the src patch was lost (the person switched boards
//     mid-upload; the original's images row carries the card id). Recovery
//     only ever adds. Not indexing is harmless to an upload that is in fact
//     still running — its card is indexed again when its src arrives — with one
//     exception: at the cap that late insert is refused, and the card stays on
//     the board uncounted until there is room. A leak in the person's favour,
//     and only for an upload queue longer than half an hour.
//   • Only after REMOVE_AFTER_MS is an unrecovered card REMOVED. Long enough
//     that nothing can still be uploading it anywhere — a slow list-view drop
//     working through its queue, another tab, the person's phone, a
//     collaborator, a device clock that runs ahead. Removing at the first
//     threshold could delete a card whose file was still on its way.
//
// Pure, so node tests every rule here.

export const ABANDON_AFTER_MS = 30 * 60 * 1000;
export const REMOVE_AFTER_MS = 24 * 60 * 60 * 1000;
// How long the board sweep leaves a card it looked up and left (not found,
// under REMOVE_AFTER_MS) before looking it up again.
export const SWEEP_RECHECK_MS = 10 * 60 * 1000;

// How old a card is by its creation stamp, or null when it has none.
export function uploadAge(get, now = Date.now()) {
  const at = Date.parse(get('createdAt') || '');
  return Number.isFinite(at) ? now - at : null;
}

// A card whose file hasn't arrived yet: placed pending, with nothing behind it.
// Its upload (if one is still running anywhere) writes the file into THIS card
// by id, so it must not be re-id'd away from it — moved to another cluster, cut
// and pasted, poured into a grid cell. `pending` alone is not enough: Replace
// image… used to leave it set on a card that has its file.
export function isStillUploading(card) {
  return card?.pending === true && !card?.src && !card?.fileSrc;
}

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
// `cards` are { id, age } (age in ms); `found` maps card id → storage path.
// Recover what landed, at any age; remove only what is past REMOVE_AFTER_MS;
// leave the rest for a later open.
export function planAbandonedSweep(cards, found, removeAfterMs = REMOVE_AFTER_MS) {
  const recover = [];
  const remove = [];
  for (const c of cards || []) {
    const path = found?.get?.(c.id);
    if (path) recover.push({ id: c.id, src: `r2:${path}` });
    else if (Number.isFinite(c.age) && c.age > removeAfterMs) remove.push(c.id);
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
