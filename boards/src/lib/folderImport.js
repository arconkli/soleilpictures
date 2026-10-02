// folderImport — a dropped folder, made into clusters and cards.
//
// Takes the plan folderPlan built (and the preflight already cut to fit) and
// does it: a cluster per folder, nested the way the folders were, each file a
// finished card in the cluster it came from.
//
// Every effect arrives through `deps`, so the order of operations — which is
// the part that can lose work — is tested here against real Y.Docs, with no
// network:
//   createCluster({ parentBoardId, name }) → id      a boards row (boardsApi.createBoard)
//   placeTopCard(card) / removeTopCard(id)           the CURRENT board's live doc
//   upload(item, { boardId, cardId }) → result       the same upload functions a drop uses
//   writeCluster(boardId, cards)                     a NEW cluster's snapshot, written whole
//   deleteCluster(id)                                soft delete, for an import that ends empty
//
// Order, and why:
//   1. A folder's cluster is created before anything inside it (a child needs
//      its parent's row). A top-level one appears on the board at once, so the
//      person sees the import start where they dropped it.
//   2. Its own files upload, a few at a time.
//   3. Its subfolders, the same way, depth first.
//   4. It is written ONCE, with its files and its subfolders' cluster cards.
//      Writing after the children is what lets a cancelled import leave no
//      empty shells: by then it is known which subfolders got anything.
// A quota or plan refusal (402/403) stops the import where it stands — what
// landed is written, and the caller makes the one pitch.

import { layoutDrop } from './layoutEngine.js';
import { cardFromUpload, cardIdFor, measuredSize, cardKindFor } from './cardFromUpload.js';

export const CLUSTER_CARD = Object.freeze({ w: 280, h: 220 });
const MARGIN = 80;
const GAP = 24;
const ROW = 6;                 // subfolder cards per row inside a cluster
export const UPLOAD_CONCURRENCY = 3;

export const isStopError = (err) => err?.code === 402 || err?.code === 403;

export function countFiles(nodes) {
  let n = 0;
  const walk = (node) => { n += node.items.length; node.children.forEach(walk); };
  (nodes || []).forEach(walk);
  return n;
}

// Top-level clusters on the current board: a row centred on the drop point.
export function layoutTops(n, at) {
  const width = n * CLUSTER_CARD.w + Math.max(0, n - 1) * GAP;
  const x0 = Math.round((Number.isFinite(at?.x) ? at.x : 200) - width / 2);
  const y0 = Math.round((Number.isFinite(at?.y) ? at.y : 200) - CLUSTER_CARD.h / 2);
  return Array.from({ length: n }, (_, i) => ({
    x: Math.max(8, x0 + i * (CLUSTER_CARD.w + GAP)), y: Math.max(8, y0),
    w: CLUSTER_CARD.w, h: CLUSTER_CARD.h,
  }));
}

// Inside a new cluster: its subfolders as cluster cards along the top, then
// its files below, laid out the way a drop lays them out (justified rows for an
// all-photo folder, a grid for a mixed one).
export function buildClusterCards(childIds, uploaded) {
  const cards = childIds.map((id, i) => ({
    id, kind: 'board',
    x: MARGIN + (i % ROW) * (CLUSTER_CARD.w + GAP),
    y: MARGIN + Math.floor(i / ROW) * (CLUSTER_CARD.h + GAP),
    w: CLUSTER_CARD.w, h: CLUSTER_CARD.h,
  }));
  if (!uploaded.length) return cards;
  const rows = Math.ceil(childIds.length / ROW);
  const top = childIds.length ? MARGIN + rows * (CLUSTER_CARD.h + GAP) + GAP : MARGIN;
  const sized = uploaded.map((u) => ({ ...u, ...measuredSize(u.item, u.up) }));
  const allImages = sized.every((u) => cardKindFor(u.item) === 'image');
  const rects = layoutDrop(sized.map((u) => ({ w: u.w, h: u.h })), {
    at: { x: 0, y: 0 }, layout: allImages ? 'justified' : 'grid',
  });
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  sized.forEach((u, i) => {
    const r = rects[i];
    cards.push(cardFromUpload({
      id: u.id, item: u.item, up: u.up,
      rect: { x: r.x - minX + MARGIN, y: r.y - minY + top, w: r.w, h: r.h },
    }));
  });
  return cards;
}

// Run `fn` over `list`, at most `limit` at a time, in order of starting.
async function pool(list, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      await fn(list[i], i);
    }
  });
  await Promise.all(workers);
}

export async function runFolderImport(nodes, deps) {
  const {
    parentBoardId, at,
    createCluster, deleteCluster, placeTopCard, removeTopCard, upload, writeCluster,
    signal = null, onProgress = () => {}, stopOn = isStopError, rand = Math.random,
  } = deps;
  const total = countFiles(nodes);
  let done = 0;
  const result = {
    total, created: [], tops: [], placed: 0, failed: 0, writeFailed: 0,
    cancelled: false, stopped: null, firstError: null,
  };
  const halted = () => !!(signal?.aborted || result.stopped);
  const topRects = layoutTops(nodes.length, at);

  const visit = async (node, parentId, topIndex) => {
    if (halted()) return null;
    const id = await createCluster({ parentBoardId: parentId, name: node.name });
    result.created.push({ id, name: node.name, parentId });
    if (topIndex != null) {
      // null = the board refused the card (the cap moved since the preflight
      // asked). Stop rather than fill a cluster nobody can see on the board.
      const placed = placeTopCard({ id, kind: 'board', ...topRects[topIndex] });
      if (placed === null) {
        result.stopped = { code: 'cap', message: 'the board had no room left for the cluster' };
        result.created = result.created.filter((e) => e.id !== id);
        try { await deleteCluster(id); } catch (_) { /* soft delete; harmless if it stays */ }
        return null;
      }
      result.tops.push(id);
    }

    const uploaded = [];
    await pool(node.items, UPLOAD_CONCURRENCY, async (item, order) => {
      if (halted()) return;
      const cardId = cardIdFor(item, done + order, rand);
      try {
        const up = await upload(item, { boardId: id, cardId });
        uploaded.push({ item, up, id: cardId, order });
        result.placed++;
      } catch (err) {
        if (stopOn(err)) result.stopped = { code: err?.code ?? null, message: String(err?.message || err) };
        else {
          result.failed++;
          if (!result.firstError) result.firstError = String(err?.message || err).slice(0, 200);
        }
      } finally {
        done++;
        onProgress({ done, total, folder: node.name });
      }
    });

    const childIds = [];
    for (const child of node.children) {
      // A subfolder that cannot be made (a failed createBoard) costs that
      // subfolder, not the import: its parent is still written with the files
      // that already landed, which would otherwise be stranded in an unwritten
      // cluster.
      try {
        const c = await visit(child, id, null);
        if (c) childIds.push(c);
      } catch (err) {
        result.failed += countFiles([child]);
        if (!result.firstError) result.firstError = String(err?.message || err).slice(0, 200);
      }
    }

    uploaded.sort((a, b) => a.order - b.order);
    if (!uploaded.length && !childIds.length) {
      // Nothing landed — cancelled or refused before the first file. Take the
      // empty cluster back rather than leave a shell on the board.
      result.created = result.created.filter((e) => e.id !== id);
      if (topIndex != null) {
        result.tops = result.tops.filter((t) => t !== id);
        try { removeTopCard(id); } catch (_) { /* the card may already be gone */ }
      }
      try { await deleteCluster(id); } catch (_) { /* soft delete; a stray empty cluster is harmless */ }
      return null;
    }
    const cards = buildClusterCards(childIds, uploaded);
    try {
      await writeCluster(id, cards);
    } catch (err) {
      // The bytes are stored; the cluster just could not be written. Say how
      // many files that cost rather than pretending they landed.
      result.writeFailed += uploaded.length;
      result.placed -= uploaded.length;
      if (!result.firstError) result.firstError = String(err?.message || err).slice(0, 200);
    }
    return id;
  };

  for (let i = 0; i < nodes.length; i++) {
    if (halted()) break;
    await visit(nodes[i], parentBoardId, i);
  }
  result.cancelled = !!signal?.aborted;
  return result;
}

// Undo: every cluster the import made, children before parents (folderPlan
// postOrder says why), then the top cards off the current board.
export async function undoFolderImport(result, { deleteCluster, removeTopCard }) {
  const byParent = new Map();
  for (const e of result.created) {
    if (!byParent.has(e.parentId)) byParent.set(e.parentId, []);
    byParent.get(e.parentId).push(e.id);
  }
  const order = [];
  const walk = (id) => { (byParent.get(id) || []).forEach(walk); order.push(id); };
  result.tops.forEach(walk);
  for (const id of order) await deleteCluster(id);
  for (const id of result.tops) removeTopCard(id);
  return order;
}
