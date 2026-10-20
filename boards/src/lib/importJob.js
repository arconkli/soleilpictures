// importJob — runs one bulk import: makes the clusters, then brings the files
// in a batch at a time until everything is in, the plan is full, or someone
// stops it.
//
// Pure: every call that leaves the tab is a dep, so the tests drive it with
// fakes and the App wires the real ones (the 0430 RPCs, /api/clusters/*, the
// upload functions). The input is a planBulk plan; only its `clusters` and its
// items (fit, then waiting: every file in reading order) are used, because the
// fill is run again here against the budgets of the moment.
//
// ORDER, and why:
//   1. Clusters, parents first, through import_create_clusters (createRows a
//      call). Each is born with its first doc holding its subfolders' cluster
//      cards, so one opened mid-import already shows them and the drift
//      reconcile has nothing to add. Under clusterCost 0 every folder is made
//      at once, so the whole structure shows, waiting files and all; otherwise
//      only the clusters the fitting files pay for. A cluster made in a later
//      round (after the plan grows) has no card in a parent made earlier until
//      that parent is opened and the reconcile adds it.
//   2. Per batch (one cluster, at most appendBatch files and batchBytes):
//      a. the ledger learns the batch's card ids as 'waiting' BEFORE the cards
//         exist, so a reload can always find them and add them again (adding
//         an id the cluster already holds is a no-op: /append skips it);
//      b. the cards go in pending and unplaced, which is where the card cap is
//         charged, before a byte moves. A 402 halves the batch; a single card
//         refused means the plan is full and the job waits on cards;
//      c. the uploads, `uploads` at a time. A 402/403 from one means the drive
//         is full: the job waits on storage and its pending cards stay;
//      d. finished cards are written back in batches: the ledger's 'landed'
//         FIRST, then the patch. A tab that dies between the two leaves a
//         pending card the abandoned-upload sweep completes from its images
//         row, never a landed file the ledger forgot (which would upload twice).
//   3. Once what fits is in, the rest waits on 'cards' or 'storage' until
//      release(), which the App calls when the plan or the drive grows; it runs
//      the fill again from exactly where it stopped.
//   4. After each batch, the tile of the cluster it filled (cover(), best
//      effort, one at a time, never in the import's way): the count it shows,
//      and for a cluster with nothing on its board — a folder with no
//      subfolders — a cover of its first pictures, drawn from the files in
//      hand (lib/coverMosaic.js), so the grid shows them while it runs.
//
// deps (all async unless noted):
//   createJob({ totals }) → jobId          budgets() → { cardsLeft, bytesLeft }
//   createClusters(jobId, rows)            setJob(jobId, fields)
//   appendCards(boardId, cards)            patchCards(boardId, [{ id, fields }])
//   removeCards(boardId, ids)              putItems(jobId, rows)
//   upload(item, file, { boardId, cardId, signal, onProgress(0..1) }) → up
//   placeTops([{ key, id, name }])?        indexClusterCards([{ boardId, cards }])?
//   newId() → uuid · cardId(item, n) · encodeDoc(cards) → base64 · now() · sleep(ms)
//   stamp()? → { createdBy, createdAt, updatedBy, updatedAt } for new cards
//   cover(boardId, { files, cardCount })? — files: the pictures to draw it
//     from, in order, or null for the count alone

import { buildClusterCards } from './folderImport.js';
import { cardFromUpload, cardKindFor, measuredSize } from './cardFromUpload.js';
import { fileMetaFor } from './fileIngest.js';
import { parseLoopMeta } from './loopMeta.js';
import { CLUSTER_CARD_COST } from './gridCount.js';
import { fillInOrder } from './importPlan.js';
import { MEDIA_SLACK_BYTES } from './importPreflight.js';
import { MOSAIC_PICS } from './coverMosaic.js';

export const JOB_LIMITS = Object.freeze({
  createRows: 500,        // clusters per import_create_clusters call (its own cap)
  appendBatch: 100,       // cards per /append (the route takes 200)
  batchBytes: 1024 ** 3,  // and about 1 GB a batch, so a pending card waits minutes, not hours
  uploads: 4,             // files in flight
  patchBatch: 200,        // finished cards per /patch (the route's cap)
  flushMs: 15000,         // write finished cards back at least this often
  ledgerBatch: 1000,      // rows per import_items_put (its own cap)
});

const isCapHit = (e) => e?.status === 402 || e?.code === 'limit_reached';
const isDriveFull = (e) => [402, 403].includes(e?.code) || [402, 403].includes(e?.status) || e?.reason === 'over_quota';
const isRetryable = (e) => e?.status === 503 || e?.status === 429 || e?.retry === true
  || e?.code === 'room_unavailable' || e?.name === 'TypeError';
const isAbort = (e) => e?.name === 'AbortError';
const messageOf = (e) => String(e?.message || e || 'Failed').slice(0, 300);

// A pending, unplaced card for a file not uploaded yet: the fields the Files
// list needs to show it while it comes in. The same rules as the sidebar and
// List view's pending cards (App.jsx ingestFilesArranged), plus the file's own
// date, which only the source knows. `item` is a planBulk item; its `file` is
// an importTree descriptor (name, size, type, lastModified). `stamp` is the
// app's audit stamp (createdBy/createdAt…): the abandoned-upload sweep judges
// a pending card by its createdAt, so a tab closed mid-batch leaves cards it
// can clean up, not ones that spin and count for ever.
export function pendingCard(item, id, at, stamp = null) {
  const f = item.file;
  const kind = cardKindFor(item);
  const card = { ...(stamp || {}), id, kind, x: at.x, y: at.y, w: item.w, h: item.h, pending: true, unplaced: true };
  if (Number.isFinite(f.lastModified)) card.fileModified = f.lastModified;
  const ext = (f.name?.split('.').pop() || '').toLowerCase();
  if (kind === 'image' || kind === 'video') Object.assign(card, fileMetaFor(f));
  if (kind === 'video') Object.assign(card, { sizeBytes: f.size || null, mime: f.type || null });
  if (kind === 'pdf') card.name = f.name || 'PDF';
  else if (kind === 'audio') {
    Object.assign(card, { title: f.name || 'Audio', fileName: f.name, mime: f.type, sizeBytes: f.size, ext });
    Object.assign(card, parseLoopMeta(f.name));
  } else if (kind === 'file') {
    Object.assign(card, { fileName: f.name, mime: f.type, sizeBytes: f.size, ext });
  }
  return card;
}

// What /patch writes once the bytes are in: the finished card's fields, minus
// what never changes (the server keeps only its PATCHABLE ones anyway).
export function finishFields(item, up, id) {
  const { w, h } = measuredSize(item, up);
  const { id: _id, kind: _kind, x: _x, y: _y, ...fields } = cardFromUpload({ id, item, up, rect: { x: 0, y: 0, w, h } });
  return { ...fields, pending: false };
}

// Where the nth file card of a cluster sits: a grid under its cluster cards.
// The cards are unplaced, so nobody sees this until "Put on board" lays them
// out properly; it only has to be somewhere sensible.
const FILE_COLS = 8;
const FILE_CELL = 264;
export function spotFor(clusterCards, n) {
  const top = clusterCards.length ? Math.max(...clusterCards.map((c) => c.y + c.h)) + 24 : 80;
  return { x: 80 + (n % FILE_COLS) * FILE_CELL, y: top + Math.floor(n / FILE_COLS) * FILE_CELL };
}

// seed (resuming after a reload): { jobId, created: [[key, boardId]],
// landed: [relPath], cardIds: [[relPath, cardId]] } from the 0430 ledger.
export function createImportJob({
  plan, title = 'Import', deps, clusterCost = CLUSTER_CARD_COST, limits = {}, seed = null, onChange = () => {},
}) {
  const L = { ...JOB_LIMITS, ...limits };
  const clusters = plan.clusters || [];
  const byKey = new Map(clusters.map((c) => [c.key, c]));
  const parentOf = new Map(clusters.map((c) => [c.key, c.parentKey]));
  const childrenOf = new Map();
  for (const c of clusters) {
    if (c.parentKey == null) continue;
    if (!childrenOf.has(c.parentKey)) childrenOf.set(c.parentKey, []);
    childrenOf.get(c.parentKey).push(c.key);
  }
  const topOf = (key) => { let k = key; while (parentOf.get(k) != null) k = parentOf.get(k); return k; };

  const all = [...(plan.fit || []), ...(plan.waiting || [])];
  const order = new Map(all.map((it, i) => [it, i]));
  const byOrder = (a, b) => order.get(a) - order.get(b);

  const created = new Map(seed?.created || []);   // cluster key → board id
  const landed = new Set(seed?.landed || []);     // relPath
  const cardIds = new Map(seed?.cardIds || []);   // relPath → its card's id
  const docCards = new Map();                     // cluster key → its cluster cards
  const used = new Map();                         // cluster key → file cards added
  const inDoc = new Map();                        // cluster key → ids of the file cards in its doc
  const onBoard = new Map();                      // relPath → { boardId, id }: pending, bytes not in

  const done = { files: 0, bytes: 0 };
  const tops = new Map();
  for (const c of clusters) if (c.parentKey == null) tops.set(c.key, { key: c.key, name: c.name, files: 0, landed: 0 });
  // The tray's rows: one per top cluster, or for an import of one folder, the
  // folder's own files and then one row per subfolder (with everything below
  // it). A part of a folder split by the ceiling is that folder's own files.
  const soleTop = tops.size === 1 ? [...tops.keys()][0] : null;
  const groupOf = (key) => {
    if (soleTop == null) return topOf(key);
    let k = key;
    while (parentOf.get(k) != null && parentOf.get(k) !== soleTop) k = parentOf.get(k);
    return k === soleTop || byKey.get(k)?.part ? soleTop : k;
  };
  const rows = new Map();
  for (const c of clusters) {
    const g = groupOf(c.key);
    if (!rows.has(g)) rows.set(g, { key: g, name: byKey.get(g)?.name || c.name, files: 0, landed: 0 });
  }
  const count = (it, n) => {
    const t = tops.get(topOf(it.clusterKey));
    if (t) t.landed += n;
    const r = rows.get(groupOf(it.clusterKey));
    if (r) r.landed += n;
  };
  for (const it of all) {
    const t = tops.get(topOf(it.clusterKey));
    if (t) t.files++;
    const r = rows.get(groupOf(it.clusterKey));
    if (r) r.files++;
    if (landed.has(it.file.relPath)) { done.files++; done.bytes += it.bytes; count(it, 1); }
  }
  const totals = { files: all.length, bytes: all.reduce((s, it) => s + it.bytes, 0), clusters: clusters.length };

  let rest = all.filter((it) => !landed.has(it.file.relPath));
  let queue = [];
  let plannedStop = null;
  let jobId = seed?.jobId || null;
  let status = 'idle';
  let waitingReason = null;
  let error = null;
  let stopFlag = null;              // 'pause' | 'cancel'
  let busy = false;
  let current = null;
  let seq = 0;
  const failed = [];
  const abort = new AbortController();

  // Progress: bytes in flight per file, the batch's unfinished files, and a
  // smoothed rate for the ETA.
  const inflight = new Map();
  const batchOpen = new Set();
  let rate = 0;
  let sampled = { t: deps.now(), bytes: 0 };
  let lastEmit = 0;
  const sent = () => done.bytes + [...inflight.values()].reduce((s, b) => s + b, 0);
  const sumBytes = (list) => list.reduce((s, it) => s + it.bytes, 0);
  // What the first waiting file needs before it can come in — the fill's own
  // charge — so a watcher can tell when room has appeared without a write.
  const nextNeed = () => {
    const it = rest[0];
    if (!it) return null;
    let cards = 1;
    if (clusterCost > 0) for (let k = it.clusterKey; k != null && !created.has(k); k = parentOf.get(k)) cards += clusterCost;
    return { cards, bytes: it.bytes + (it.kind === 'video' || it.kind === 'audio' ? MEDIA_SLACK_BYTES : 0) };
  };
  // Per cluster made so far, by board id: the folder it came from, as names
  // ("Night Shift › Lookbook"), and how many of its own files wait for room —
  // what an imported cluster's empty canvas says. Rebuilt only when the
  // waiting list or the made clusters change, never on a progress tick, so a
  // view that selects one cluster's entry doesn't re-render while files upload.
  const pathOf = new Map();
  const namePath = (key) => {
    if (!pathOf.has(key)) {
      const up = parentOf.get(key);
      const own = byKey.get(key)?.name || '';
      pathOf.set(key, up != null ? `${namePath(up)} › ${own}` : own);
    }
    return pathOf.get(key);
  };
  // Each made cluster: its folder path, its files not in yet, and the job's
  // status and waiting reason (a Files row says "waiting for room" only while
  // the job is). A new object only when one of those changes.
  let byBoardMemo = null;
  const byBoard = () => {
    const m = byBoardMemo;
    if (m && m.rest === rest && m.made === created.size && m.status === status && m.reason === waitingReason) return m.out;
    const waitingIn = new Map();
    for (const it of rest) waitingIn.set(it.clusterKey, (waitingIn.get(it.clusterKey) || 0) + 1);
    const out = {};
    for (const [key, boardId] of created) {
      if (byKey.has(key)) out[boardId] = { path: namePath(key), waiting: waitingIn.get(key) || 0, status, reason: waitingReason };
    }
    byBoardMemo = { rest, made: created.size, status, reason: waitingReason, out };
    return out;
  };

  const snapshot = () => {
    const open = [...batchOpen];
    const queuedBytes = sumBytes(queue) + sumBytes(open);
    const leftBytes = queuedBytes - open.reduce((s, it) => s + (inflight.get(it.file.relPath) || 0), 0);
    return {
      id: jobId, title, status, waitingReason, error,
      totals: { ...totals },
      landed: { ...done },
      sentBytes: sent(),
      waiting: { files: rest.length, bytes: sumBytes(rest) },
      queued: { files: queue.length + open.length, bytes: queuedBytes },
      failed: failed.slice(),
      tops: [...tops.values()].map((t) => ({ ...t, boardId: created.get(t.key) || null })),
      rows: [...rows.values()].filter((r) => r.files > 0).map((r) => ({ ...r })),
      byBoard: byBoard(),
      currentRow: current ? groupOf(current) : null,
      next: nextNeed(),
      current: current ? byKey.get(current)?.name || null : null,
      bytesPerSec: rate,
      etaMs: rate > 0 && leftBytes > 0 ? Math.round((leftBytes / rate) * 1000) : null,
    };
  };
  const emit =() => { lastEmit = deps.now(); try { onChange(snapshot()); } catch (_) { /* a view's bug never stops the import */ } };
  const emitSoon = () => { if (deps.now() - lastEmit >= 250) emit(); };
  const sample = () => {
    const t = deps.now();
    const dt = (t - sampled.t) / 1000;
    if (dt < 1) return;
    const r = Math.max(0, (sent() - sampled.bytes) / dt);
    rate = rate ? rate * 0.8 + r * 0.2 : r;
    sampled = { t, bytes: sent() };
  };

  const call = async (fn) => {
    for (let i = 0; ; i++) {
      try { return await fn(); }
      catch (e) {
        if (!isRetryable(e) || i >= 5 || stopFlag === 'cancel') throw e;
        await deps.sleep(Math.min(30000, 1000 * 2 ** i));
      }
    }
  };

  // ── Writing back ──────────────────────────────────────────────────────────
  let ledger = [];
  const patches = new Map();   // boardId → [{ id, fields }]
  const removals = new Map();  // boardId → [id]
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  let flushing = null;
  let flushAgain = false;
  let lastFlush = deps.now();
  const patchCount = () => [...patches.values()].reduce((s, l) => s + l.length, 0);

  async function flushNow() {
    do {
      flushAgain = false;
      const rows = ledger; ledger = [];
      const p = [...patches.entries()]; patches.clear();
      const r = [...removals.entries()]; removals.clear();
      for (let i = 0; i < rows.length; i += L.ledgerBatch) await call(() => deps.putItems(jobId, rows.slice(i, i + L.ledgerBatch)));
      for (const [boardId, list] of p) {
        for (let i = 0; i < list.length; i += L.patchBatch) await call(() => deps.patchCards(boardId, list.slice(i, i + L.patchBatch)));
      }
      for (const [boardId, ids] of r) {
        for (let i = 0; i < ids.length; i += 500) await call(() => deps.removeCards(boardId, ids.slice(i, i + 500)));
      }
      if (rows.length || p.length || r.length) {
        await call(() => deps.setJob(jobId, { done: { files: done.files, bytes: done.bytes, failed: failed.length } }));
      }
      lastFlush = deps.now();
    } while (flushAgain);
  }
  function flush() {
    if (flushing) { flushAgain = true; return flushing; }
    flushing = flushNow().finally(() => { flushing = null; });
    return flushing;
  }
  const maybeFlush = () => {
    if (patchCount() >= L.patchBatch || deps.now() - lastFlush >= L.flushMs) flush().catch(fail);
  };

  const ledgerRow = (it, status, extra = {}) => ({
    rel_path: it.file.relPath, status, size_bytes: it.bytes,
    last_modified: Number.isFinite(it.file.lastModified) ? it.file.lastModified : null, ...extra,
  });

  // ── Tiles ─────────────────────────────────────────────────────────────────
  // Only for clusters this run made: their docs hold nothing but what it put
  // there, so it knows their counts. Each one's cover is its first pictures in
  // reading order — what the cover drawn from its cards picks (mosaicPicks) —
  // whose files are kept from their upload until the cover has them all.
  const fresh = new Set();
  const coverWant = new Map();   // cluster key → its first MOSAIC_PICS pictures
  const wanted = new Set();      // their relPaths
  for (const it of all) {
    if (cardKindFor(it) !== 'image') continue;
    const list = coverWant.get(it.clusterKey) || [];
    if (list.length >= MOSAIC_PICS) continue;
    list.push(it);
    coverWant.set(it.clusterKey, list);
    wanted.add(it.file.relPath);
  }
  const coverFiles = new Map();  // relPath → its file, landed
  const coverDrawn = new Map();  // cluster key → pictures in its last cover
  let tiles = Promise.resolve();
  function noteTile(key, boardId) {
    if (!deps.cover || !fresh.has(key)) return;
    const own = docCards.get(key)?.length || 0;
    const cardCount = own + (inDoc.get(key)?.size || 0);
    let files = null;
    const want = coverWant.get(key) || [];
    const pics = own ? [] : want.filter((it) => coverFiles.has(it.file.relPath));
    if (pics.length > (coverDrawn.get(key) || 0)) {
      coverDrawn.set(key, pics.length);
      files = pics.map((it) => coverFiles.get(it.file.relPath));
      if (pics.length === want.length) for (const it of pics) coverFiles.delete(it.file.relPath);
    }
    tiles = tiles.then(() => deps.cover(boardId, { files, cardCount })).catch(() => { /* the cover drawn from its cards follows */ });
  }

  // ── Clusters ──────────────────────────────────────────────────────────────
  async function makeClusters(keys) {
    if (!keys.length) return;
    const ids = new Map(keys.map((k) => [k, deps.newId()]));
    const rows = keys.map((k) => {
      const c = byKey.get(k);
      const cards = buildClusterCards((childrenOf.get(k) || []).filter((ck) => ids.has(ck)).map((ck) => ids.get(ck)), []);
      docCards.set(k, cards);
      return { key: k, id: ids.get(k), parent_key: c.parentKey ?? null, name: c.name, files: c.files, doc: deps.encodeDoc(cards) };
    });
    for (let i = 0; i < rows.length; i += L.createRows) {
      const chunk = rows.slice(i, i + L.createRows);
      await call(() => deps.createClusters(jobId, chunk));
      for (const row of chunk) { created.set(row.key, row.id); fresh.add(row.key); }
    }
    // Both best-effort: the reconcile places a missing top card, and the next
    // save of a cluster indexes its cards.
    const newTops = rows.filter((r) => r.parent_key == null).map((r) => ({ key: r.key, id: r.id, name: r.name }));
    if (newTops.length && deps.placeTops) await Promise.resolve(deps.placeTops(newTops)).catch(() => {});
    const withCards = rows.filter((r) => docCards.get(r.key).length).map((r) => ({ boardId: r.id, cards: docCards.get(r.key) }));
    if (withCards.length && deps.indexClusterCards) await Promise.resolve(deps.indexClusterCards(withCards)).catch(() => {});
  }

  async function refill() {
    const b = await call(() => deps.budgets());
    const r = fillInOrder(rest, {
      parentOf, clusterCost, cardsLeft: b?.cardsLeft, bytesLeft: b?.bytesLeft, created: new Set(created.keys()),
    });
    queue = r.fit;
    rest = r.waiting;
    plannedStop = r.stoppedBy;
    const need = clusterCost === 0 ? new Set(clusters.map((c) => c.key)) : r.paid;
    await makeClusters(clusters.map((c) => c.key).filter((k) => need.has(k) && !created.has(k)));
  }

  // ── One batch ─────────────────────────────────────────────────────────────
  function takeBatch() {
    const key = queue[0].clusterKey;
    const batch = [];
    let bytes = 0;
    while (queue.length && queue[0].clusterKey === key && batch.length < L.appendBatch
           && (!batch.length || bytes + queue[0].bytes <= L.batchBytes)) {
      const it = queue.shift();
      bytes += it.bytes;
      batch.push(it);
    }
    return batch;
  }

  async function runBatch() {
    const batch = takeBatch();
    const key = batch[0].clusterKey;
    const boardId = created.get(key);
    current = key;
    for (const it of batch) if (!cardIds.has(it.file.relPath)) cardIds.set(it.file.relPath, deps.cardId(it, seq++));
    const idOf = (it) => cardIds.get(it.file.relPath);

    await call(() => deps.putItems(jobId, batch.map((it) => ledgerRow(it, 'waiting', { board_id: boardId, card_id: idOf(it) }))));

    let take = batch.length;
    for (;;) {
      const part = batch.slice(0, take);
      const base = used.get(key) || 0;
      const cards = docCards.get(key) || buildClusterCards((childrenOf.get(key) || []).map((ck) => created.get(ck)).filter(Boolean), []);
      try {
        const stamp = deps.stamp?.() || null;
        await call(() => deps.appendCards(boardId, part.map((it, i) => pendingCard(it, idOf(it), spotFor(cards, base + i), stamp))));
        used.set(key, base + part.length);
        if (!inDoc.has(key)) inDoc.set(key, new Set());
        for (const it of part) inDoc.get(key).add(idOf(it));
        break;
      } catch (e) {
        if (!isCapHit(e)) throw e;
        if (take === 1) { queue.unshift(...batch); return stop('cards'); }
        take = Math.ceil(take / 2);
      }
    }
    if (take < batch.length) queue.unshift(...batch.slice(take));
    const inBatch = batch.slice(0, take);
    for (const it of inBatch) {
      onBoard.set(it.file.relPath, { boardId, id: idOf(it) });
      batchOpen.add(it);
    }
    emit();

    let driveFull = false;
    const held = [];
    let next = 0;
    const worker = async () => {
      while (next < inBatch.length) {
        const it = inBatch[next++];
        if (driveFull || stopFlag) { held.push(it); continue; }
        await uploadOne(it, boardId, idOf(it)).then((outcome) => {
          if (outcome === 'full') { driveFull = true; held.push(it); }
          else if (outcome === 'held') held.push(it);
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(L.uploads, inBatch.length) }, worker));
    batchOpen.clear();

    held.sort(byOrder);
    if (stopFlag === 'cancel') return;
    noteTile(key, boardId);
    if (held.length) queue.unshift(...held);
    if (driveFull) return stop('storage');
  }

  async function uploadOne(it, boardId, id) {
    const rel = it.file.relPath;
    inflight.set(rel, 0);
    try {
      const file = await it.file.open();
      const up = await deps.upload(it, file, {
        boardId, cardId: id, signal: abort.signal,
        onProgress: (p) => { inflight.set(rel, Math.max(0, Math.min(1, Number(p) || 0)) * it.bytes); sample(); emitSoon(); },
      });
      inflight.delete(rel);
      batchOpen.delete(it);
      onBoard.delete(rel);
      landed.add(rel);
      done.files++;
      done.bytes += it.bytes;
      count(it, 1);
      ledger.push(ledgerRow(it, 'landed', { board_id: boardId, card_id: id }));
      push(patches, boardId, { id, fields: finishFields(it, up, id) });
      if (wanted.has(rel) && fresh.has(it.clusterKey)) coverFiles.set(rel, file);
      sample();
      emitSoon();
      maybeFlush();
      return 'landed';
    } catch (e) {
      inflight.delete(rel);
      batchOpen.delete(it);
      if (isAbort(e) || stopFlag === 'cancel') return 'held';
      if (isDriveFull(e)) return 'full';
      onBoard.delete(rel);
      failed.push({ relPath: rel, message: messageOf(e) });
      ledger.push(ledgerRow(it, 'failed', { board_id: boardId, card_id: id, error: messageOf(e) }));
      push(removals, boardId, id);
      inDoc.get(it.clusterKey)?.delete(id);
      emitSoon();
      maybeFlush();
      return 'failed';
    }
  }

  // ── States ────────────────────────────────────────────────────────────────
  async function stop(reason) {
    rest = [...queue, ...rest];
    queue = [];
    status = 'waiting';
    waitingReason = reason;
    current = null;
    await flush();
    await call(() => deps.setJob(jobId, { status: 'waiting', waiting_reason: reason }));
    emit();
  }

  async function fail(e) {
    if (status === 'failed' || status === 'cancelled') return;
    stopFlag = stopFlag || 'fail';   // the batch in hand starts nothing new
    status = 'failed';
    error = messageOf(e);
    current = null;
    emit();
    try { await flush(); } catch (_) { /* the ledger catches up on resume */ }
    try { await deps.setJob(jobId, { status: 'failed' }); } catch (_) { /* best effort */ }
  }

  async function loop() {
    status = 'running';
    waitingReason = null;
    emit();
    await call(() => deps.setJob(jobId, { status: 'running', waiting_reason: null }));
    while (queue.length && !stopFlag) {
      await runBatch();
      if (status !== 'running') return;
    }
    current = null;
    if (stopFlag === 'cancel') return finishCancel();
    if (status !== 'running') return;
    await flush();
    if (stopFlag === 'pause') {
      status = 'paused';
      await call(() => deps.setJob(jobId, { status: 'paused' }));
      return emit();
    }
    if (rest.length) return stop(plannedStop || 'cards');
    status = 'done';
    coverFiles.clear();
    await call(() => deps.setJob(jobId, { status: 'done' }));
    emit();
  }

  async function finishCancel() {
    for (const { boardId, id } of onBoard.values()) push(removals, boardId, id);
    onBoard.clear();
    coverFiles.clear();
    rest = [...queue, ...rest];
    queue = [];
    status = 'cancelled';
    current = null;
    emit();
    await flush();
    await call(() => deps.setJob(jobId, { status: 'cancelled' }));
  }

  let running = null;   // the guarded run in progress, for cancel() to wait on
  const guarded = (fn) => {
    if (busy) return Promise.resolve(snapshot());
    busy = true;
    running = (async () => {
      try { await fn(); } catch (e) { await fail(e); } finally { busy = false; running = null; }
      return snapshot();
    })();
    return running;
  };

  return {
    get state() { return snapshot(); },
    start: () => guarded(async () => {
      if (status !== 'idle') return;
      status = 'creating';
      emit();
      if (!jobId) jobId = await call(() => deps.createJob({ totals }));
      await refill();
      await loop();
    }),
    pause() { if (status === 'running') { stopFlag = 'pause'; emit(); } },
    // After a pause, or a failure (the network, a room that stayed down):
    // the queue is where it was, and re-adding a card it already has is a no-op.
    resume: () => guarded(async () => {
      if (status !== 'paused' && status !== 'failed') return;
      stopFlag = null;
      error = null;
      await loop();
    }),
    // The plan or the drive grew: fill again from where the import stopped.
    release: () => guarded(async () => {
      if (status !== 'waiting') return;
      stopFlag = null;
      await refill();
      if (queue.length) await loop();
      else { await call(() => deps.setJob(jobId, { status: 'waiting', waiting_reason: plannedStop || waitingReason })); emit(); }
    }),
    // "Try these again": the files that failed go back to the front, in
    // reading order, and come in like any other (their cards were removed, so
    // re-adding them is a fresh add under the same ids).
    retryFailed: () => guarded(async () => {
      if (status !== 'done' || !failed.length) return;
      const again = new Set(failed.map((f) => f.relPath));
      failed.length = 0;
      rest = [...all.filter((it) => again.has(it.file.relPath)), ...rest];
      stopFlag = null;
      await refill();
      if (queue.length) await loop();
      else await stop(plannedStop || 'cards');
    }),
    // Resolves once it has stopped: a running batch is aborted and its loop
    // takes the cancel at the next turn, which this waits for.
    async cancel() {
      if (['done', 'cancelled', 'failed'].includes(status)) return snapshot();
      stopFlag = 'cancel';
      abort.abort();
      if (busy) { await running; return snapshot(); }
      busy = true;
      try { await finishCancel(); } catch (e) { await fail(e); } finally { busy = false; }
      return snapshot();
    },
  };
}
