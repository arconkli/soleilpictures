// importPlan — what a bulk import fits now, what waits, and the clusters.
//
// importTree gives one tree for every source (folder, picker, zip). This turns
// it into a flat, ordered plan: the clusters to make, and every file in
// READING order — a cluster's own files, then its child clusters — split at the
// point the user's remaining room (cards, bytes) runs out. Pure, like
// folderPlan, whose classification handling it copies.
//
// BUDGET FILL is strictly in reading order. The first file that doesn't fit
// stops the fill and everything after it waits, even a smaller file that would
// have fitted: the import then resumes exactly where it stopped rather than
// leaving holes scattered through the folders.
//   · cards: a file costs 1; the first fitted file in a cluster also pays
//     `clusterCost` for that cluster and each ancestor not yet paid for, so
//     every cluster is charged once, and never when nothing in it fits.
//   · bytes: the file's size, plus importPreflight.MEDIA_SLACK_BYTES for video
//     and audio (the planBytes rule).
//   · an unknown budget (null, undefined, NaN) is unlimited — fail open, as
//     planBytes does and the card preflight does when its RPC is down.
//
// CEILING: a folder with more than `ceiling` planned files keeps its cluster
// (holding none itself) and its files go into ceil(n / ceiling) "part"
// clusters, split in order as evenly as possible, earlier parts taking the
// extra file. Parts come BEFORE the folder's subfolders, because a folder's
// files read before its subfolders.

import { classifyDropFile } from './fileIngest.js';
import { CLUSTER_CARD_COST } from './gridCount.js';
import { MEDIA_SLACK_BYTES } from './importPreflight.js';

// Why 2,000 (M1, scripts/measure-import-doc.mjs, 2026-10-20: the doc built
// the way the import builds it, pending cards a batch per /append and each
// finished card replaced whole by /patch). A file card costs 560–580 bytes
// of Yjs, history included, so a full cluster's doc is ~1.1 MB (1.5 MB as
// board_state's base64), which the room re-flushes whole on every change.
// Every /append and /patch opens the whole doc, so one cluster's import moves
// ~33 MB over its life at 2,000, but ~206 MB at 5,000 and ~0.8 GB at 10,000:
// the cost grows as the square. And every write of board_state re-parses the
// whole doc for its image keys (recompute_image_refs): ~58 ms at 2,000, ~147
// ms at 5,000, measured on the database, paid again on every later edit of
// that cluster, not only during the import.
export const CLUSTER_FILE_CEILING = 2000;

// null / undefined / NaN / Infinity / non-numbers → unlimited; negatives → 0.
const budget = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : Infinity);

// The BUDGET FILL rule above, on its own: the longest run of planned `items`
// that fits. planBulk runs it for the dialog; importJob runs it again each
// time the plan grows, with `created` naming clusters already made (paid for).
// parentOf: Map cluster key → parent key. Returns { fit, waiting, stoppedBy,
// fitBytes, paid } — paid holds `created` plus every cluster the fit pays for.
export function fillInOrder(items, {
  parentOf, clusterCost = CLUSTER_CARD_COST, cardsLeft = Infinity, bytesLeft = Infinity, created = null,
} = {}) {
  const paid = new Set(created || []);
  let cards = budget(cardsLeft);
  let bytes = budget(bytesLeft);
  const fit = [];
  const waiting = [];
  let stoppedBy = null;
  let fitBytes = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const unpaid = [];
    if (clusterCost > 0) {
      for (let k = it.clusterKey; k != null && !paid.has(k); k = parentOf.get(k)) unpaid.push(k);
    }
    const cardCost = 1 + unpaid.length * clusterCost;
    const byteCost = it.bytes + (it.kind === 'video' || it.kind === 'audio' ? MEDIA_SLACK_BYTES : 0);
    if (cardCost > cards || byteCost > bytes) {
      stoppedBy = cardCost > cards ? 'cards' : 'storage';
      for (let j = i; j < items.length; j++) waiting.push(items[j]);
      break;
    }
    cards -= cardCost;
    bytes -= byteCost;
    fitBytes += it.bytes;
    for (const k of unpaid) paid.add(k);
    fit.push(it);
  }
  return { fit, waiting, stoppedBy, fitBytes, paid };
}

export function planBulk(root, {
  clusterCost = CLUSTER_CARD_COST, cardsLeft = Infinity, bytesLeft = Infinity,
  ceiling = CLUSTER_FILE_CEILING, classify = classifyDropFile, canAttemptFiles = true,
} = {}) {
  const skipped = { partial: 0, pureref: 0, scripts: 0 };
  const blocked = [];

  // 1. Classify, folder by folder. Returns { node, items, children } or null
  // for a folder left with nothing in it and nothing below it.
  const planDir = (node) => {
    const items = [];
    for (const file of node.files || []) {
      const c = classify(file, { canAttemptFiles });
      if (c.route === 'partial') { skipped.partial++; continue; }
      if (c.route === 'pureref') { skipped.pureref++; continue; }
      if (c.route === 'screenplay') { skipped.scripts++; continue; }
      if (c.route === 'blocked') { blocked.push(file); continue; }
      items.push({ file, kind: c.kind, route: c.route, w: c.w, h: c.h, bytes: Math.max(0, Number(file.size) || 0) });
    }
    const children = (node.dirs || []).map(planDir).filter(Boolean);
    if (!items.length && !children.length) return null;
    return { node, items, children };
  };

  // 2. Emit clusters pre-order, and the planned files in reading order.
  const clusters = [];
  const planned = [];   // { clusterKey, ...item }
  const emit = (p, parentKey, depth) => {
    const { node, items, children } = p;
    const key = node.relPath;
    const name = String(node.name || 'Folder').slice(0, 200);
    const cluster = { key, name, parentKey, depth, part: null, files: items.length };
    clusters.push(cluster);
    if (items.length > ceiling) {
      cluster.files = 0;
      const of = Math.ceil(items.length / ceiling);
      const base = Math.floor(items.length / of);
      const extra = items.length % of;
      let at = 0;
      for (let i = 1; i <= of; i++) {
        const n = base + (i <= extra ? 1 : 0);
        const part = items.slice(at, at + n);
        at += n;
        const partKey = `${key}#${i}`;
        clusters.push({ key: partKey, name: `${name} · ${i} of ${of}`, parentKey: key, depth: depth + 1, part: { index: i, of }, files: part.length });
        for (const it of part) planned.push({ clusterKey: partKey, ...it });
      }
    } else {
      for (const it of items) planned.push({ clusterKey: key, ...it });
    }
    for (const c of children) emit(c, key, depth + 1);
  };
  for (const d of root?.dirs || []) {
    const p = planDir(d);
    if (p) emit(p, null, 1);
  }

  // 3. Fill the budget in reading order.
  const parentOf = new Map(clusters.map((c) => [c.key, c.parentKey]));
  const { fit, waiting, stoppedBy, fitBytes, paid } = fillInOrder(planned, { parentOf, clusterCost, cardsLeft, bytesLeft });

  let totalBytes = 0;
  for (const it of planned) totalBytes += it.bytes;
  return {
    clusters,
    fit,
    waiting,
    totals: { files: planned.length, bytes: totalBytes, clusters: clusters.length },
    fitTotals: { files: fit.length, bytes: fitBytes, clustersNow: clusterCost === 0 ? clusters.length : paid.size },
    stoppedBy,
    skipped,
    blocked,
  };
}
