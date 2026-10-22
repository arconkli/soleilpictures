// A doc open on a cluster whose copy is replaced under it.
//
// A version restore, cards moved into the cluster, a repair after a sync
// error: each REPLACES the cluster's copy on the server, so useYBoard throws
// the open copy away and loads the cluster again, and every card on it goes
// and comes back. A doc open on it used to vanish mid-sentence and come back
// closed and older, with no word of why; and whatever had been typed in the
// moments before, which the cluster's room hadn't stored, went with the old
// copy, because that copy must never be saved again (it would undo the
// restore).
//
// So useYBoard announces a reload before it lets the old copy go
// (announceBoardReload). An open doc notes then which page it is on and what
// that page holds (noteDocReset), and again as it goes, so a key typed in
// between counts (refreshDocReset); the card notes how it was open
// (noteReopen). The page as it was is kept on this device, the way the
// corruption repair keeps its draft (stashKey), and the doc says what is
// happening. Once the cluster is back the doc reopens as it was, compares its
// page with what it had (lostWriting), and says what happened, offering what
// it had when the reload took any of it away (settleDocReset); a doc the
// cluster came back without is told of by the workspace
// (settleOrphanedDocResets).

export const RELOAD_EVENT = 'soleil-board-reloading';

// The page as it was, kept on this device: support can recover it, as they
// can the corruption repair's `soleil.boards.ydoc.corrupt.` draft.
export const stashKey = (cardId) => `soleil.docs.reset.${cardId}`;

// How long each thing holds. A reload is announced, then waits up to 1.5s and
// loads the cluster, so the doc is normally back within seconds.
const LOCAL_MS = 60_000;     // a restore or a move this tab made
const RESTORED_MS = 15_000;  // a restore signal arriving beside a room reset
const REOPEN_MS = 30_000;    // reopen the doc only if it is back this soon
const PENDING_MS = 120_000;  // say nothing about a reload this old
const ANNOUNCE_TTL = 12_000;
const TOLD_TTL = 6_000;
const OFFER_TTL = 30_000;

// reason: 'restore' (a version restore), 'reset' (the room was reset: cards
// moved in, or a restore whose own signal hasn't arrived), 'heal' (a repair
// after a sync error).
export function announceBoardReload(boardId, reason = 'reset') {
  if (!boardId || typeof window === 'undefined') return;
  try { window.dispatchEvent(new CustomEvent(RELOAD_EVENT, { detail: { boardId, reason } })); } catch (_) {}
}

// A reload this tab set off (bulletproofRestore, forceResetBoardRoom): the
// person did it and knows, so their doc speaks only for a page that changed.
const localResets = new Map();
export function markLocalReset(boardId, now = Date.now()) {
  if (boardId) localResets.set(boardId, now);
}
const isLocal = (boardId, at) => {
  const t = localResets.get(boardId);
  return t != null && at - t >= 0 && at - t < LOCAL_MS;
};

// A restore's own signal (board_restore_events) can land just after the room's
// reset frame started the reload, and be deduped by useYBoard; it still makes
// that reload a restore.
const restoredAt = new Map();
export function noteBoardRestored(boardId, now = Date.now()) {
  if (boardId) restoredAt.set(boardId, now);
}
const reasonOf = (e) => {
  if (e.reason !== 'reset') return e.reason;
  const t = restoredAt.get(e.boardId);
  return t != null && Math.abs(t - e.at) < RESTORED_MS ? 'restore' : 'reset';
};

// ── what the doc held ──────────────────────────────────────────────────────

const pending = new Map();   // cardId → what the doc held as the reload began
const offers = new Map();    // cardId → the last copy offered, while it shows
// A page's text is not held for long: what no doc came back for, and offers
// no longer showing, go.
const sweep = (now) => {
  for (const [id, e] of pending) if (now - e.at > PENDING_MS) pending.delete(id);
  for (const [id, o] of offers) if (now >= o.until) offers.delete(id);
};

const stash = (e) => {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!e.canEdit || !e.text) { localStorage.removeItem(stashKey(e.cardId)); return; }
    const { boardId, cardId, pageId, pageName, title, reason, text, html, at } = e;
    localStorage.setItem(stashKey(cardId), JSON.stringify({ boardId, cardId, pageId, pageName, title, reason, text, html, at }));
  } catch (_) { /* full, or blocked: the toast's copy still works */ }
};
const unstash = (cardId) => {
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(stashKey(cardId)); } catch (_) {}
};

// entry: { boardId, cardId, docGuid (the Y.Doc's), pageId, pageName, title,
//          reason, canEdit, blocks (readPageBlocks of the page), text, html
//          (the editor's) }
export function noteDocReset(entry, { feedback = null, now = Date.now() } = {}) {
  if (!entry?.boardId || !entry?.cardId) return;
  sweep(now);
  const e = { ...entry, at: now, local: isLocal(entry.boardId, now) };
  pending.set(e.cardId, e);
  stash(e);
  // Someone else's restore or move: say so as the doc goes. (A repair has
  // the workspace's own toast; a reload from here, the person's own action;
  // and a copy still on offer from a reload just before stays where it is.)
  if (feedback && !e.local && e.reason !== 'heal' && !(offers.get(e.cardId)?.until > now)) {
    feedback.toast({
      type: 'info',
      message: reasonOf(e) === 'restore'
        ? 'This cluster was restored to an earlier version — reopening the doc.'
        : 'This cluster was updated elsewhere — reopening the doc.',
      ttl: ANNOUNCE_TTL,
      group: `doc-reset:${e.cardId}`,
    });
  }
}

// What the page holds now, as the doc goes: what was typed since the
// announcement counts too.
export function refreshDocReset(cardId, content) {
  const e = pending.get(cardId);
  if (!e || !content) return;
  Object.assign(e, content);
  stash(e);
}

// `docGuid`: the Y.Doc asking. The one the reload was noted on is the old
// copy, still showing until the cluster's cards go, not the doc come back.
const take = (cardId, boardId, now, docGuid = null) => {
  const e = pending.get(cardId);
  if (!e || e.boardId !== boardId) return null;
  if (docGuid && e.docGuid === docGuid) return null;
  pending.delete(cardId);
  if (now - e.at > PENDING_MS) return null;
  return e;
};

// The doc is back (or the cluster came back without it). `pageBlocks(pageId)`
// reads the page in the reloaded doc, null when the doc has no such page.
export function settleDocReset({ boardId, cardId, docGuid = null, pageBlocks, feedback, copy = copyToClipboard, now = Date.now() }) {
  const e = take(cardId, boardId, now, docGuid);
  if (!e) return null;
  let after = null;
  try { after = e.pageId ? pageBlocks?.(e.pageId) ?? null : []; } catch (_) { after = []; }
  return tell(e, { place: after == null ? 'page' : 'same', after, feedback, copy, now });
}

// Docs open on `boardId` that the reloaded cluster doesn't have: no doc of
// theirs is coming back to say so, so the workspace does.
export function settleOrphanedDocResets({ boardId, hasCard, feedback, copy = copyToClipboard, now = Date.now() }) {
  if (!pending.size || !boardId) return [];
  sweep(now);
  const told = [];
  for (const [cardId, e] of [...pending]) {
    if (e.boardId !== boardId || hasCard(cardId)) continue;
    const taken = take(cardId, boardId, now);
    if (taken) told.push(tell(taken, { place: 'doc', after: null, feedback, copy, now }));
  }
  return told.filter(Boolean);
}

function tell(e, { place, after, feedback, copy, now }) {
  const lost = !!e.canEdit && lostWriting(e.blocks || [], after);
  const reason = reasonOf(e);
  let notice = resetNotice({ reason, local: e.local, lost, place, title: e.title });
  let offer = lost ? { text: e.text || (e.blocks || []).join('\n\n'), html: e.html || '' } : null;
  // A second reload close behind the first (a slower signal of the same
  // restore) finds the page as the first left it: the first one's offer,
  // still showing, stands rather than being replaced by "nothing lost".
  const standing = offers.get(e.cardId);
  if (!lost && standing && now < standing.until) {
    notice = standing.notice;
    offer = standing.offer;
  }
  if (offer) offers.set(e.cardId, { notice, offer, until: now + OFFER_TTL });
  else { offers.delete(e.cardId); unstash(e.cardId); }
  if (feedback && notice) {
    feedback.toast({
      type: offer ? 'warning' : 'info',
      message: notice,
      ttl: offer ? OFFER_TTL : TOLD_TTL,
      group: `doc-reset:${e.cardId}`,
      action: offer ? {
        label: 'Copy what you had',
        onClick: async () => {
          const ok = await copy(offer);
          feedback.toast(ok
            ? { type: 'success', message: 'Copied — paste it anywhere.' }
            : { type: 'error', message: 'Couldn’t copy it — this browser didn’t allow it.' });
        },
      } : null,
    });
  }
  return { notice, lost, place };
}

// ── what it says ───────────────────────────────────────────────────────────

const flat = (s) => String(s || '').replace(/\s+/g, '');

// Lost means a block the page had is not there any more, changed or gone:
// what a restore added, or spacing, is not writing lost. `after` null: no
// page at all.
export function lostWriting(before, after) {
  const had = (before || []).map(flat).filter(Boolean);
  if (!had.length) return false;
  if (after == null) return true;
  const now = new Set(after.map(flat));
  return had.some((b) => !now.has(b));
}

// place: 'same' (the doc and its page are back), 'page' (the doc is back
// without the page it was on), 'doc' (the cluster is back without the doc).
export function resetNotice({ reason = 'reset', local = false, lost = false, place = 'same', title = '' }) {
  const doc = title ? `“${title}”` : 'this doc';
  if (reason === 'heal') {
    if (!lost) return null;
    if (place === 'doc') return `${title ? doc : 'This doc'} didn’t make it through the sync error.`;
    return place === 'page'
      ? 'The page you were on didn’t make it through the sync error.'
      : 'Your last edits on this page didn’t make it through the sync error.';
  }
  if (local) {
    // Their own restore or move: a doc it took away was theirs to take.
    if (!lost || place === 'doc') return null;
    if (reason === 'restore') {
      return place === 'page' ? 'The version you restored didn’t have the page you were on.' : 'The restore changed the page you had open.';
    }
    return place === 'page' ? 'The cluster reloaded without the page you were on.' : 'Your last edits on this page didn’t make it before the cluster reloaded.';
  }
  if (reason === 'restore') {
    if (place === 'doc') return `This cluster was restored to a version from before ${doc} existed.`;
    if (!lost) return 'This cluster was restored to an earlier version.';
    return place === 'page'
      ? 'This cluster was restored to an earlier version, without the page you were on.'
      : 'This cluster was restored to an earlier version, which changed this page.';
  }
  if (place === 'doc') return `This cluster was updated elsewhere, and ${doc} isn’t in it any more.`;
  if (!lost) return 'This cluster was updated elsewhere and reloaded.';
  return place === 'page'
    ? 'This cluster was updated elsewhere and reloaded without the page you were on.'
    : 'This cluster was updated elsewhere and reloaded, and your last edits on this page didn’t make it.';
}

// ── how it reopens ─────────────────────────────────────────────────────────

// The card comes back closed after a reload; this is how it was open. Read,
// not taken, on the way back (StrictMode renders a card twice), and cleared
// once the card is up.
const reopens = new Map();   // cardId → { mode, at }
export function noteReopen(cardId, mode, now = Date.now()) {
  if (cardId && mode && mode !== 'closed') reopens.set(cardId, { mode, at: now });
}
export function reopenMode(cardId, now = Date.now()) {
  const r = reopens.get(cardId);
  return r && now - r.at < REOPEN_MS ? r.mode : null;
}
export function clearReopen(cardId) { reopens.delete(cardId); }

// The page as it was onto the clipboard, formatted where the browser allows,
// plain otherwise. Called from the toast's button, inside the click.
export async function copyToClipboard({ text = '', html = '' }) {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : null;
  if (!clip) return false;
  if (html && typeof clip.write === 'function' && typeof ClipboardItem !== 'undefined') {
    try {
      await clip.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
      return true;
    } catch (_) { /* plain text below */ }
  }
  try { await clip.writeText(text); return true; } catch (_) { return false; }
}
