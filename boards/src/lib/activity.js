// activity — what this tab is moving, right now.
//
// Uploads, downloads, exports and copies register here as items inside
// batches (kind: 'upload' | 'download' | 'export' | 'copy'); the tray, the card overlays, the tab title and the presence
// publisher all read this one store. No React in this file: it is node-testable,
// and src/hooks/useActivity.js wraps it for components. The words live in
// activityWords.js.
//
// Time: `now` comes from an injectable clock (__setActivityClock). Delays use
// plain setTimeout and queueMicrotask, so node:test's mock.timers can drive them.
//
// Reads are O(1): byCard points a card at its newest item that is not done,
// cardItems / batchItems list each card's and batch's items, and a card's key
// string is cached until that card's item changes. Nothing a
// useSyncExternalStore snapshot calls reads the clock: the time-left words sit
// on the item (etaText) and a 1 s ticker refreshes them while something runs.

import { etaShort } from './activityWords.js';

export const DONE_LINGER_MS = 4000;
const PROGRESS_NOTIFY_MS = 250;
const RATE_SAMPLE_MS = 1000;
const ETA_AFTER_MS = 3000;
const ETA_TICK_MS = 1000;
const ACTIVE = new Set(['waiting', 'running', 'finishing']);

let clock = () => Date.now();
let nextBatch = 1;
let nextItem = 1;
const items = new Map();     // id -> Item (replaced, never mutated, on every change)
const batches = new Map();   // id -> Batch
const samples = new Map();   // item id -> { at, bytes }, the base of the rate sample
const lingers = new Map();   // batch id -> timer of a finished batch about to leave
const listeners = new Set();
const byCard = new Map();     // card id -> id of its newest item that is not done
const cardItems = new Map();  // card id -> Set of item ids, oldest first
const batchItems = new Map(); // batch id -> Set of item ids
const keyCache = new Map();   // card id -> cardTransferKey string
const watchers = new Set();   // slotFree / untilTransferRuns checks, called on every change
const cancellers = new Map(); // board id -> stack of fn(cardId) (a cluster open in both panes registers twice), newest last
let etaTimer = null;
let trays = 0;               // ActivityTray instances mounted (lib/activityOps.js asks)
let snap = null;
let idSet = new Set();
let microPending = false;
let progressTimer = null;
let lastNotify = -Infinity;

export function __setActivityClock(fn) { clock = typeof fn === 'function' ? fn : () => Date.now(); }

export function __resetActivityForTests() {
  for (const t of lingers.values()) clearTimeout(t);
  lingers.clear();
  clearTimeout(progressTimer);
  progressTimer = null;
  clearTimeout(etaTimer);
  etaTimer = null;
  for (const w of [...watchers]) w.cancel();
  watchers.clear();
  items.clear(); batches.clear(); samples.clear(); listeners.clear(); cancellers.clear();
  byCard.clear(); cardItems.clear(); batchItems.clear(); keyCache.clear();
  nextBatch = 1; nextItem = 1; trays = 0;
  snap = null; idSet = new Set();
  microPending = false; lastNotify = -Infinity;
  clock = () => Date.now();
}

function flush() {
  microPending = false;
  clearTimeout(progressTimer);
  progressTimer = null;
  lastNotify = clock();
  for (const fn of [...listeners]) fn();
}

// Structural changes (adds, removes, state changes) notify on a microtask,
// coalesced. A fraction-only change waits for the 250 ms window to pass, so
// the last value always lands but a fast upload doesn't re-render the tray
// at every progress event.
function changed(structural) {
  snap = null;
  for (const w of [...watchers]) w.check();
  if (microPending) return;
  if (structural) {
    microPending = true;
    queueMicrotask(flush);
    return;
  }
  if (progressTimer) return;
  const wait = lastNotify + PROGRESS_NOTIFY_MS - clock();
  if (wait <= 0) {
    microPending = true;
    queueMicrotask(flush);
  } else {
    progressTimer = setTimeout(flush, wait);
    progressTimer.unref?.();
  }
}

// ActivityTray registers itself while mounted; an op (lib/activityOps.js) only
// goes to the tray when one is there to draw it.
export const trayMounted = () => trays > 0;
export function noteTrayMounted() {
  trays++;
  let gone = false;
  return () => { if (!gone) { gone = true; trays = Math.max(0, trays - 1); } };
}

export function subscribeActivity(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function activitySnapshot() {
  if (!snap) snap = { items: [...items.values()], batches: [...batches.values()], cancellers: [...cancellers.keys()], cancellerCount: [...cancellers.values()].reduce((n, l) => n + l.length, 0) };
  return snap;
}

// A hidden batch is one another surface already shows (the import tray): its
// items count for cards, guards and presence, but no words list it.
// `showAfterMs` (null: the tray's 1000) is how long the tray waits before it
// shows the batch; `lingerMs` (null: DONE_LINGER_MS) how long a finished one stays.
export function startBatch({
  kind = 'upload', boardId = null, boardName = null, label = null, hidden = false, showAfterMs = null, lingerMs = null,
} = {}) {
  const id = `b${nextBatch++}`;
  batches.set(id, {
    id, kind, boardId, boardName, label, hidden, createdAt: clock(), paused: false, dismissed: false, showAfterMs, lingerMs,
  });
  changed(true);
  return id;
}

// Re-point a card at its newest item that is not done, and drop its cached key.
function reindexCard(cardId) {
  if (!cardId) return;
  keyCache.delete(cardId);
  let pick = null;
  for (const tid of cardItems.get(cardId) || []) if (items.get(tid)?.state !== 'done') pick = tid;
  if (pick) byCard.set(cardId, pick); else byCard.delete(cardId);
}

function indexItem(it) {
  if (it.cardId) {
    if (!cardItems.has(it.cardId)) cardItems.set(it.cardId, new Set());
    cardItems.get(it.cardId).add(it.id);
  }
  if (!batchItems.has(it.batch)) batchItems.set(it.batch, new Set());
  batchItems.get(it.batch).add(it.id);
}

function unindexItem(it) {
  if (it.cardId) {
    const set = cardItems.get(it.cardId);
    set?.delete(it.id);
    if (set && !set.size) cardItems.delete(it.cardId);
  }
  const bs = batchItems.get(it.batch);
  bs?.delete(it.id);
  if (bs && !bs.size) batchItems.delete(it.batch);
}

// The one way an item leaves the store.
function dropItem(id) {
  const it = items.get(id);
  if (!it) return;
  items.delete(id);
  samples.delete(id);
  unindexItem(it);
  reindexCard(it.cardId);
}

const batchOf = (batchId) => [...(batchItems.get(batchId) || [])].map((tid) => items.get(tid)).filter(Boolean);

// Time-left words for a running item; null otherwise.
const etaTextOf = (it, now) => (it.state === 'running' ? etaShort(itemEtaMs(it, now)) : null);

// One tick a second while anything runs: the words change with the clock, the
// snapshot never does. Notifies only when some item's words changed.
function armEtaTimer() {
  if (etaTimer) return;
  etaTimer = setTimeout(() => {
    etaTimer = null;
    const now = clock();
    let running = false;
    let moved = false;
    for (const [tid, it] of [...items]) {
      if (it.state !== 'running') continue;
      running = true;
      const text = etaTextOf(it, now);
      if (text === it.etaText) continue;
      items.set(tid, { ...it, etaText: text });
      reindexCard(it.cardId);
      moved = true;
    }
    if (moved) changed(true);
    if (running) armEtaTimer();
  }, ETA_TICK_MS);
  etaTimer.unref?.();
}

export function addTransfer({
  batch, kind = 'upload', label, boardId = null, cardId = null, bytesTotal = 0, state = 'waiting', actions = null,
  mime = '', thumb = null, cancellable = false, count = null, cancel = null, version = null,
} = {}) {
  const id = `t${nextItem++}`;
  const now = clock();
  const done = state === 'done';
  const it = {
    id, batch, kind, label, boardId, cardId, bytesTotal,
    fraction: done ? 1 : 0, sentBytes: done ? bytesTotal : 0, rateBps: 0,
    state, error: null, startedAt: state === 'running' ? now : null, doneAt: done ? now : null, actions,
    etaText: null, parked: false, mime, thumb, cancellable, abortable: false, paused: state === 'waiting' && !!batches.get(batch)?.paused, retryOnline: false,
    // count { done, total }: "34 of 120 files"; cancel: an op's own abort (not the card-based canCancelTransfer);
    // version { n }: an upload that is a new version of a card's file.
    count, cancel, version,
  };
  items.set(id, it);
  indexItem(it);
  reindexCard(cardId);
  if (state === 'running') armEtaTimer();
  changed(true);
  settle(batch);
  return id;
}

// Rate: an EWMA over samples at least a second apart. A fraction going
// backwards (a retried PUT restarts at 0) restarts the sample base.
function sampleRate(id, prev, fraction, bytes) {
  const now = clock();
  const base = samples.get(id);
  if (!base || fraction < prev.fraction) {
    samples.set(id, { at: now, bytes });
    return prev.rateBps;
  }
  const dt = now - base.at;
  if (dt < RATE_SAMPLE_MS) return prev.rateBps;
  const r = Math.max(0, (bytes - base.bytes) / (dt / 1000));
  samples.set(id, { at: now, bytes });
  return prev.rateBps > 0 ? prev.rateBps * 0.8 + r * 0.2 : r;
}

export function updateTransfer(id, patch = {}) {
  const prev = items.get(id);
  if (!prev) return;
  const now = clock();
  const next = { ...prev, ...patch };
  // A kept upload's "connection dropped" mark belongs to the failure it was set on.
  if (patch.state && patch.state !== prev.state && !('retryOnline' in patch)) next.retryOnline = false;
  if (patch.state === 'waiting') {
    Object.assign(next, { fraction: 0, sentBytes: 0, rateBps: 0, startedAt: null, error: null, abortable: false });
    samples.delete(id);
  }
  if (typeof patch.fraction === 'number') {
    const f = Math.min(1, Math.max(0, patch.fraction));
    next.fraction = f;
    next.sentBytes = Math.round(f * next.bytesTotal);
    next.rateBps = sampleRate(id, prev, f, next.sentBytes);
  }
  // A retried PUT restarts at 0: a finishing item whose fraction falls back is running again.
  if (next.state === 'finishing' && typeof patch.fraction === 'number'
    && next.fraction < 0.999 && next.fraction < prev.fraction) next.state = 'running';
  if (next.state === 'running' && next.startedAt == null) next.startedAt = now;
  if (next.state === 'running' && next.fraction >= 0.999) next.state = 'finishing';
  if (next.state === 'done') {
    next.fraction = 1;
    next.sentBytes = next.bytesTotal;
    if (next.doneAt == null) next.doneAt = now;
    samples.delete(id);
  }
  next.etaText = etaTextOf(next, now);
  next.paused = next.state === 'waiting' && !!batches.get(next.batch)?.paused;
  items.set(id, next);
  // A dismissed batch that starts moving again is on the tray again.
  const bt = batches.get(next.batch);
  if (bt?.dismissed && next.state !== prev.state && ACTIVE.has(next.state)) batches.set(bt.id, { ...bt, dismissed: false });
  if (next.cardId !== prev.cardId) {
    unindexItem(prev);
    indexItem(next);
    reindexCard(prev.cardId);
  }
  reindexCard(next.cardId);
  if (next.state === 'running') armEtaTimer();
  const progressOnly = next.state === prev.state && Object.keys(patch).every((k) => k === 'fraction' || k === 'count');
  changed(!progressOnly);
  settle(next.batch);
}

export function removeTransfer(id) {
  const prev = items.get(id);
  if (!prev) return;
  dropItem(id);
  if (!batchItems.has(prev.batch)) dropBatch(prev.batch);
  changed(true);
  settle(prev.batch);
}

function dropBatch(batchId) {
  batches.delete(batchId);
  clearTimeout(lingers.get(batchId));
  lingers.delete(batchId);
}

// Drops the batch's items that are no longer moving; the batch itself goes
// unless something in it still is. A failed item whose card is on the canvas
// and still offers Retry stays too (the card shows the failure; a failed new
// version has no placeholder, its card is intact, so it does not), and the batch
// stays dismissed until something in it moves again.
export function dismissBatch(batchId) {
  let stays = false;
  for (const it of batchOf(batchId)) {
    if (ACTIVE.has(it.state) || (it.state === 'failed' && it.cardId && it.actions?.retry && !it.version)) stays = true;
    else dropItem(it.id);
  }
  const b = batches.get(batchId);
  if (stays && b) batches.set(batchId, { ...b, dismissed: true });
  else dropBatch(batchId);
  changed(true);
}

// Pause holds back the items still waiting for a slot (a running upload
// finishes); the upload paths wait in inLimiterUnlessPaused.
function setBatchPaused(batchId, paused) {
  const b = batches.get(batchId);
  if (!b) return;
  batches.set(batchId, { ...b, paused });
  for (const it of batchOf(batchId)) {
    if (it.state !== 'waiting' || it.paused === paused) continue;
    items.set(it.id, { ...it, paused });
    reindexCard(it.cardId);
  }
  changed(true);
}
export const pauseBatch = (batchId) => setBatchPaused(batchId, true);
export const resumeBatch = (batchId) => setBatchPaused(batchId, false);

export function transferPaused(tid) {
  const it = items.get(tid);
  return !!it && !it.parked && it.state === 'waiting' && !!batches.get(it.batch)?.paused;
}

// Resolves at once when `tid` is not paused, else when it stops being: resumed,
// removed, or no longer waiting. Never hangs on a removed item.
export function untilTransferRuns(tid) {
  if (!transferPaused(tid)) return Promise.resolve();
  return new Promise((resolve) => {
    const w = {
      check: () => { if (!transferPaused(tid)) { watchers.delete(w); resolve(); } },
      cancel: () => { watchers.delete(w); resolve(); },
    };
    watchers.add(w);
  });
}

// Runs `task` in `limiter` once the item is not paused. An item paused while it
// queued gives its slot straight back and waits again.
export async function inLimiterUnlessPaused(tid, limiter, task) {
  for (;;) {
    await untilTransferRuns(tid);
    let again = false;
    const out = await limiter(async () => {
      if (transferPaused(tid)) { again = true; return undefined; }   // paused while it queued: give the slot back
      return task();
    });
    if (!again) return out;
  }
}

// The canvas registers how a card's upload is cancelled (it deletes the card,
// which parks or cancels the upload); the tray offers Cancel only where one exists.
export function setCardCanceller(boardId, fn) {
  if (!boardId || typeof fn !== 'function') return () => {};
  if (!cancellers.has(boardId)) cancellers.set(boardId, []);
  cancellers.get(boardId).push(fn);
  changed(true);
  return () => {
    const list = cancellers.get(boardId);
    const at = list ? list.lastIndexOf(fn) : -1;
    if (at < 0) return;
    list.splice(at, 1);
    if (!list.length) cancellers.delete(boardId);
    changed(true);
  };
}

// Only a list drop or paste on the canvas (cancellable) whose card is there; a
// running one only when its upload aborts with the card (abortable, set by the
// canvas's runCancellableUpload).
export function canCancelTransfer(item) {
  return !!(item?.cancellable && item.cardId && cancellers.has(item.boardId)
    && (item.state === 'waiting' || (item.state === 'running' && item.abortable)));
}

export function cancelTransfer(tid) {
  const it = items.get(tid);
  if (!it?.cardId) return;
  const list = cancellers.get(it.boardId);
  list?.[list.length - 1]?.(it.cardId);
}

// A batch whose every item is done leaves 4 s (its lingerMs) after the last one finished.
// A failed item keeps it until dismissBatch, a retry or a removal.
function settle(batchId) {
  if (!batches.has(batchId)) return;
  const mine = batchOf(batchId);
  const allDone = mine.length > 0 && mine.every((i) => i.state === 'done');
  if (!allDone) {
    clearTimeout(lingers.get(batchId));
    lingers.delete(batchId);
    return;
  }
  if (lingers.has(batchId)) return;
  const last = Math.max(...mine.map((i) => i.doneAt ?? 0));
  const linger = batches.get(batchId).lingerMs ?? DONE_LINGER_MS;
  const delay = Math.max(0, linger - (clock() - last));
  const t = setTimeout(() => {
    lingers.delete(batchId);
    const still = batchOf(batchId);
    if (!still.length || !still.every((i) => i.state === 'done')) return;
    for (const i of still) dropItem(i.id);
    batches.delete(batchId);
    changed(true);
  }, delay);
  t.unref?.();
  lingers.set(batchId, t);
}

export function transferForCard(cardId) {
  if (!cardId) return null;
  const tid = byCard.get(cardId);
  return tid ? items.get(tid) || null : null;
}

// Resolves (never rejects) once item `tid` has handed its slot back: it is
// gone, finishing, done or failed, or its bytes have not moved for quietMs.
// cancel() leaves no subscription or timer behind.
export function slotFree(tid, { quietMs = 60000 } = {}) {
  let timer = null;
  let over = false;
  let lastBytes = null;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  const w = { check: null, cancel: null };
  const end = (resolved) => {
    if (over) return;
    over = true;
    clearTimeout(timer);
    watchers.delete(w);
    if (resolved) resolve();
  };
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => end(true), quietMs);
    timer.unref?.();
  };
  w.cancel = () => end(false);
  w.check = () => {
    const it = items.get(tid);
    if (!it || it.state === 'finishing' || it.state === 'done' || it.state === 'failed') { end(true); return; }
    if (it.sentBytes !== lastBytes) { lastBytes = it.sentBytes; arm(); }
  };
  watchers.add(w);
  w.check();
  return { promise, cancel: w.cancel };
}

// Time left for one item, once it has run 3 s and a rate is known.
export function itemEtaMs(item, now = clock()) {
  if (!item || item.state !== 'running' || item.startedAt == null) return null;
  if (now - item.startedAt < ETA_AFTER_MS) return null;
  if (!(item.rateBps > 0) || !(item.bytesTotal > 0)) return null;
  return Math.max(0, ((item.bytesTotal - item.sentBytes) / item.rateBps) * 1000);
}

// Time left for a batch: what remains of everything still to go, at the pace
// of what is running now. A failed item is not going to go, so it adds nothing.
export function batchEtaMs(batch, batchItems, now = clock()) {
  if (!batch || now - batch.createdAt < ETA_AFTER_MS) return null;
  let rate = 0;
  let left = 0;
  for (const it of batchItems) {
    if (!ACTIVE.has(it.state)) continue;
    left += Math.max(0, it.bytesTotal - it.sentBytes);
    if (it.state === 'running') rate += it.rateBps;
  }
  return rate > 0 && left > 0 ? (left / rate) * 1000 : null;
}

// A primitive for useSyncExternalStore: a card re-renders only when its
// state, whole percent or time-left words change. Cached per card and never
// reads the clock, so two calls with no change return the same string.
export function cardTransferKey(cardId) {
  const it = transferForCard(cardId);
  if (!it) return '';
  let key = keyCache.get(cardId);
  if (key === undefined) {
    const pct = it.state === 'running' ? Math.floor(it.fraction * 100) : 0;
    key = `${it.state}|${pct}|${it.etaText || ''}${it.paused ? '|paused' : ''}`;
    keyCache.set(cardId, key);
  }
  return key;
}

// Same Set object until the membership changes, so progress ticks are free.
export function transferCardIds() {
  const next = new Set();
  for (const [cardId, tid] of byCard) if (!items.get(tid)?.parked) next.add(cardId);
  if (next.size === idSet.size && [...next].every((c) => idSet.has(c))) return idSet;
  idSet = next;
  return idSet;
}
