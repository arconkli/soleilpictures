// abandonedUploads — an upload whose card never got its file.
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
// Every uploaded kind, not only photos (2026-10). A PDF, file, audio or video
// card dropped before a cluster switch stayed "Uploading" for everyone, for
// ever: the patch was skipped, and this sweep only knew photos. Each kind's
// upload now writes its card id on the images row, so the sweep can recover
// any of them, and remove the ones whose file never arrived.
//
// Pure, so node tests every rule here — except the late-result registry at the
// bottom, which is session state by design.

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
  return card?.pending === true && !card?.src && !card?.fileSrc && !card?.pdfSrc;
}

// The kinds a drop uploads into a pending card, and the field each one's file
// lands in. A PDF's original goes to pdfSrc; its src is the page-1 thumbnail.
export const UPLOAD_KINDS = new Set(['image', 'pdf', 'file', 'video', 'audio']);
const FILE_FIELDS = ['src', 'fileSrc', 'pdfSrc'];

// `get` reads a card field: (k) => yMap.get(k) in the sync, (k) => card[k] on
// the rendered card list.
export function isAbandonedUpload(get, now = Date.now(), afterMs = ABANDON_AFTER_MS) {
  if (!UPLOAD_KINDS.has(get('kind'))) return false;
  if (get('pending') !== true) return false;
  for (const f of FILE_FIELDS) {
    const v = get(f);
    if (typeof v === 'string' && v) return false;
  }
  const at = Date.parse(get('createdAt') || '');
  // No creation stamp: too old to have one, or not placed by this app. Either
  // way not ours to judge.
  if (!Number.isFinite(at)) return false;
  return now - at > afterMs;
}

// The card fields a landed upload restores, from the storage paths the images
// table holds for its card id (a PDF has two rows: the original and its page-1
// thumbnail). null when nothing usable landed — a PDF thumbnail without its
// PDF can't open, so it is not a recovery.
export function recoveryPatch(kind, paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter((p) => typeof p === 'string' && p);
  if (!list.length) return null;
  if (kind === 'pdf') {
    const pdf = list.find((p) => /\.pdf$/i.test(p));
    if (!pdf) return null;
    const thumb = list.find((p) => p !== pdf);
    return { pdfSrc: `r2:${pdf}`, ...(thumb ? { src: `r2:${thumb}` } : {}) };
  }
  if (kind === 'file') return { fileSrc: `r2:${list[0]}` };
  return { src: `r2:${list[0]}` };
}

// What the sweep does with them, given which originals the images table holds.
// `cards` are { id, age, kind } (age in ms; kind defaults to a photo); `found`
// maps card id → storage path, or a list of them. Recover what landed, at any
// age; remove only what is past REMOVE_AFTER_MS; leave the rest for a later
// open. A recovery is { id, ...the fields to set }.
export function planAbandonedSweep(cards, found, removeAfterMs = REMOVE_AFTER_MS) {
  const recover = [];
  const remove = [];
  for (const c of cards || []) {
    const patch = recoveryPatch(c.kind || 'image', found?.get?.(c.id));
    if (patch) recover.push({ id: c.id, ...patch });
    else if (Number.isFinite(c.age) && c.age > removeAfterMs) remove.push(c.id);
  }
  return { recover, remove };
}

// The one line the person reads about it. Plain about what happened and what
// to do; the files are still on their device. "photo" when every one was a
// photo, which is the case this was written for and still the common one.
export function abandonedNotice(n, allPhotos = true) {
  if (!(n > 0)) return '';
  const one = n === 1;
  const noun = allPhotos ? (one ? 'photo' : 'photos') : (one ? 'file' : 'files');
  return `${n} ${noun} didn't finish uploading before the page closed, so ${one ? 'it was' : 'they were'} removed. Add ${one ? 'it' : 'them'} again to keep ${one ? 'it' : 'them'}.`;
}

// ── Late results ──────────────────────────────────────────────────────────
// What an upload produced when its card could not take it: the person had
// switched clusters (the live mutators write to another board), or the card
// was deleted mid-upload and might come back with Undo. Held per board and
// card for this session, and handed back once that card is on screen again
// and still waiting for its file (CanvasSurface applies them). One entry per
// card, of three shapes:
//   { patch }   — the upload landed: set these fields (pending:false included)
//   { remove }  — the upload failed: take the placeholder away
//   { retry }   — the upload was cancelled because the card was deleted; if
//                 Undo brings the card back, run it again (it holds the File)
// The sweep above is the durable half — it serves collaborators and reloads.
// This is the immediate one, and the only one that can help Undo.
const late = new Map();   // boardId → Map(cardId → entry)

export function stashLateUpload(boardId, cardId, entry, store = late) {
  if (!boardId || !cardId || !entry) return;
  let byCard = store.get(boardId);
  if (!byCard) { byCard = new Map(); store.set(boardId, byCard); }
  const prev = byCard.get(cardId);
  // A follow-up patch (a poster after the src) joins the one already waiting.
  if (entry.patch && prev?.patch) byCard.set(cardId, { patch: { ...prev.patch, ...entry.patch } });
  else byCard.set(cardId, entry);
}

// The entries whose card `isWaiting(id)` says is back and still uploading;
// they leave the registry as they are handed out.
export function takeLateUploads(boardId, isWaiting, store = late) {
  const byCard = store.get(boardId);
  if (!byCard || !byCard.size) return [];
  const due = [];
  for (const [id, entry] of byCard) {
    if (!isWaiting(id)) continue;
    due.push({ id, entry });
    byCard.delete(id);
  }
  if (!byCard.size) store.delete(boardId);
  return due;
}
