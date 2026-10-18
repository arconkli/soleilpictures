// heldUploads — a drop that did not fit, kept in THIS tab until there is room,
// then uploaded as if it had just been dropped (owner request 2026-10-18: "keep
// the file and if they pay it still goes on so they don't have to re-upload
// it, especially if it's a big file").
//
// A dropped File is a handle to the file on the person's disk, not a copy, so
// holding one costs no memory and no time however large it is. What it cannot
// do is outlive the tab: a reload, a closed tab or a same-tab Stripe Checkout
// redirect lets it go. So the store is in memory only, App warns before the
// tab is left while it holds anything, and Checkout opens in a new tab while
// files are held (checkout.js `newTab`).
//
// Nothing here uploads. A surface that owns an entry point (the canvas, the
// list view, the folder importer) claims the entries that are ready for its
// cluster and hands them back to that entry point, which re-runs every check
// — the card cap, the drive, the layout — so a release that still does not
// fit is simply asked about, and held, again.

const CHANNEL = 'clusters-billing';
// How long after starting a payment for held files the release watcher keeps
// polling for the plan or the drive to grow (Checkout, a 3D Secure page).
export const AWAIT_PAYMENT_MS = 30 * 60 * 1000;

// How long after a release this tab still answers the success page (below):
// the poll can upload the files before that page asks where they went.
const RELEASE_ACK_MS = 2 * 60 * 1000;

let seq = 0;
let entries = [];
let awaitingUntil = 0;
let lastRelease = null;
let owner = null;
const listeners = new Set();
// (kind, entries) for analytics, installed by App (hooks/useHeldUploads), so
// this module stays free of imports and the node test can drive it.
let logger = null;

// What a React reader renders from: replaced on every change, so a change
// that leaves `entries` alone (the payment wait starting or ending) still
// re-renders it (HeldUploadsBar's useSyncExternalStore).
let snapshot = { entries, awaiting: false };

function emit() {
  snapshot = { entries, awaiting: awaitingPayment() };
  for (const fn of [...listeners]) {
    try { fn(); } catch (_) { /* a listener must not break the store */ }
  }
}

export function heldSnapshot() {
  return snapshot;
}

function log(kind, list) {
  if (!logger || !list.length) return;
  try { logger(kind, list); } catch (_) { /* analytics must not break the store */ }
}

export function setHeldLogger(fn) {
  logger = typeof fn === 'function' ? fn : null;
}

export function subscribeHeld(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Hold what a drop could not place.
//   via    'canvas' | 'list' | 'folder' — which entry point gets it back
//   limit  'storage' | 'cards' — what stopped it, and so what releases it
//   files  File[] (canvas, list), or `folder` for a folder import: the
//          original { entries | pickedFiles, at, ... } args plus count/bytes
//   at     { x, y } for the canvas; `partial` when the drop's first part was
//          placed, so the rest does not land on top of it
//   tier / quota  the plan and drive at the moment of holding: a release
//          needs one of them to change
export function holdDrop({
  boardId, via, limit, files = [], at = null, partial = false, folder = null,
  tier = null, quota = null, now = Date.now(),
} = {}) {
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!boardId || !via || !limit || (!list.length && !folder)) return null;
  const id = `held-${++seq}`;
  const count = folder ? Math.max(0, Number(folder.count) || 0) : list.length;
  const bytes = folder
    ? Math.max(0, Number(folder.bytes) || 0)
    : list.reduce((n, f) => n + (Number(f?.size) || 0), 0);
  const entry = {
    id, boardId, via, limit, files: list, at, partial: Boolean(partial), folder,
    count, bytes, heldAt: now, tierAtHold: tier ?? null,
    quotaAtHold: Number.isFinite(Number(quota)) && quota != null ? Number(quota) : null,
    ready: false,
  };
  entries = [...entries, entry];
  log('kept', [entry]);
  emit();
  return id;
}

export function heldEntries() {
  return entries;
}

// The account the held files were dropped by. This store is module memory and
// outlives the app's sign-out, so someone signing in as another account in
// the same tab must not be handed the last person's files.
export function setHeldOwner(userId) {
  const id = userId || null;
  if (!id) return;
  if (owner && id !== owner) discardHeld(null, 'discarded');
  owner = id;
}

export function hasHeld() {
  return entries.length > 0;
}

// { count, bytes, entries, boards } — files and bytes held, optionally for
// one cluster.
export function heldTotals(boardId = null) {
  const list = boardId ? entries.filter((e) => e.boardId === boardId) : entries;
  return {
    count: list.reduce((n, e) => n + e.count, 0),
    bytes: list.reduce((n, e) => n + e.bytes, 0),
    entries: list.length,
    boards: [...new Set(list.map((e) => e.boardId))],
  };
}

export function discardHeld(ids = null, kind = 'discarded') {
  const drop = ids ? new Set(ids) : null;
  const gone = drop ? entries.filter((e) => drop.has(e.id)) : entries;
  if (!gone.length) return;
  entries = drop ? entries.filter((e) => !drop.has(e.id)) : [];
  log(kind, gone);
  emit();
}

// Undo for a discard: the same entries back, as they were — released ones
// stay released. Not logged as a new hold; the discard row stands, as an Undo
// of a delete leaves its row.
export function restoreHeld(list = []) {
  const have = new Set(entries.map((e) => e.id));
  const back = (Array.isArray(list) ? list : []).filter((e) => e?.id && !have.has(e.id));
  if (!back.length) return;
  entries = [...entries, ...back];
  emit();
}

// The tab is about to leave for a same-tab checkout (a new tab could not be
// opened), and the files cannot come along. Let them go, so the leave guard
// does not stop the very checkout they are waiting for, and say how many, so
// the return can ask for them again (checkoutReturn notePendingImport).
export function letGoHeld() {
  const n = heldTotals().count;
  awaitingUntil = 0;
  awaitingTab = null;
  tabClosedAt = 0;
  discardHeld(null, 'let_go');
  return n;
}

const PAID = ['paid', 'admin'];

// Has anything changed that could make room for this entry? Not "does it fit
// now" — the entry point decides that again on release — only "is it worth
// trying": the plan went from free to paid, or the drive grew. A plan that was
// not known when the drop was held cannot show an upgrade: a paying owner
// whose tier had not loaded would otherwise be "upgraded" on the first check
// and asked the same question again.
export function readyFor(entry, { tier = null, quota = null } = {}) {
  if (!entry) return false;
  const upgraded = PAID.includes(tier ?? '')
    && entry.tierAtHold != null && !PAID.includes(entry.tierAtHold);
  if (entry.limit === 'cards') return upgraded;
  if (entry.limit === 'storage') {
    const grew = quota != null && entry.quotaAtHold != null && Number(quota) > entry.quotaAtHold;
    return upgraded || grew;
  }
  return false;
}

// A storage hold made without a known drive size (a mid-upload refusal can
// lack it) takes the first size seen as its baseline, so growth from there
// can release it.
export function setHeldBaseline(id, quota) {
  if (quota == null) return;   // Number(null) is 0, and 0 would release on anything
  const q = Number(quota);
  if (!Number.isFinite(q)) return;
  let changed = false;
  entries = entries.map((e) => {
    if (e.id !== id || e.quotaAtHold != null) return e;
    changed = true;
    return { ...e, quotaAtHold: q };
  });
  if (changed) emit();
}

export function markReady(ids) {
  const set = new Set(ids || []);
  let changed = false;
  entries = entries.map((e) => {
    if (!set.has(e.id) || e.ready) return e;
    changed = true;
    return { ...e, ready: true };
  });
  if (changed) emit();
}

// "Upload now": try every entry for this cluster again, whatever changed.
export function markAllReady(boardId) {
  markReady(entries.filter((e) => !boardId || e.boardId === boardId).map((e) => e.id));
}

// Take the ready entries for one cluster and entry point out of the store.
// Removing them first means a second claimer — another surface, a re-render —
// can never upload the same files twice.
export function claimReady({ boardId, via, now = Date.now() } = {}) {
  if (!boardId || !via) return [];
  const mine = entries.filter((e) => e.ready && e.boardId === boardId && e.via === via);
  if (!mine.length) return [];
  const ids = new Set(mine.map((e) => e.id));
  entries = entries.filter((e) => !ids.has(e.id));
  // Summed across one release's claims (a canvas drop and a folder), so the
  // success page is told all of them, not the last.
  const recent = lastRelease && now - lastRelease.at < RELEASE_ACK_MS ? lastRelease.count : 0;
  lastRelease = { at: now, count: recent + mine.reduce((n, e) => n + e.count, 0) };
  log('released', mine);
  emit();
  return mine;
}

// A payment for held files is under way (Checkout in another tab, a 3D Secure
// page): the release watcher polls until it lands or this runs out. `tab`, the
// window the payment happens in when this tab opened it: closing it ends the
// wait, since that is how most people back out of a checkout, and nothing
// else would say so.
//
// Not the instant it closes, though: someone who pays and shuts the success
// page at once can beat the plan's activation by a few seconds, and the wait
// is what keeps this tab looking for it.
export const TAB_CLOSED_GRACE_MS = 2 * 60 * 1000;
let awaitingTab = null;
let tabClosedAt = 0;
export function noteAwaitingPayment(now = Date.now(), ms = AWAIT_PAYMENT_MS, tab = null) {
  awaitingUntil = now + ms;
  awaitingTab = tab || null;
  tabClosedAt = 0;
  emit();
}

export function awaitingPayment(now = Date.now()) {
  if (!entries.length || now >= awaitingUntil) return false;
  let closed = false;
  try { closed = Boolean(awaitingTab && awaitingTab.closed); } catch (_) { /* unreadable: still open */ }
  if (!closed) return true;
  if (!tabClosedAt) tabClosedAt = now;
  return now - tabClosedAt < TAB_CLOSED_GRACE_MS;
}

export function clearAwaitingPayment() {
  if (!awaitingUntil) return;
  awaitingUntil = 0;
  awaitingTab = null;
  tabClosedAt = 0;
  emit();
}

// The wait is over by itself (it ran out, or its tab was closed) but nothing
// has said so: say so, so readers stop showing it.
export function settleAwaitingPayment(now = Date.now()) {
  if (awaitingUntil && !awaitingPayment(now)) clearAwaitingPayment();
}

// Cross-tab: Checkout opens in a new tab while files are held, and its success
// page tells the tab holding them that the plan changed. BroadcastChannel is
// same-origin and needs no reference between the tabs.
export function announceBillingChange(kind = 'paid') {
  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.postMessage({ type: 'billing_changed', kind });
    bc.close();
  } catch (_) { /* no BroadcastChannel: the focus and poll triggers remain */ }
}

// How many files this tab is holding, or has just uploaded after being told
// the plan changed: what it answers the success page with. 0 when neither.
export function heldAckCount(now = Date.now()) {
  if (entries.length) return heldTotals().count;
  return lastRelease && now - lastRelease.at < RELEASE_ACK_MS ? lastRelease.count : 0;
}

// The holder answers so the success page can say where the files went.
export function listenBillingChange(fn) {
  let bc = null;
  try {
    bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (e) => {
      const msg = e?.data;
      if (msg?.type === 'billing_changed') {
        try { fn(msg); } catch (_) {}
        const count = heldAckCount();
        if (count > 0) {
          try { bc.postMessage({ type: 'held_ack', count }); } catch (_) {}
        }
      }
    };
  } catch (_) { return () => {}; }
  return () => { try { bc.close(); } catch (_) {} };
}

// Ask whether another tab is holding files, for up to `ms`. Resolves the held
// count, or 0.
export function askForHolder(ms = 800) {
  return new Promise((resolve) => {
    let bc = null;
    let done = false;
    const finish = (n) => {
      if (done) return;
      done = true;
      try { bc?.close(); } catch (_) {}
      resolve(n);
    };
    try {
      bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = (e) => {
        if (e?.data?.type === 'held_ack') finish(Number(e.data.count) || 0);
      };
      bc.postMessage({ type: 'billing_changed', kind: 'paid' });
    } catch (_) { finish(0); return; }
    setTimeout(() => finish(0), ms);
  });
}

// Tests only.
export function __resetHeldForTests() {
  entries = [];
  awaitingUntil = 0;
  lastRelease = null;
  logger = null;
  owner = null;
  awaitingTab = null;
  tabClosedAt = 0;
  snapshot = { entries, awaiting: false };
  seq = 0;
  listeners.clear();
}
