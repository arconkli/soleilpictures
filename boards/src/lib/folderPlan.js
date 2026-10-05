// folderPlan — what a dropped folder will become, and what it costs.
//
// A folder becomes a cluster; each folder inside it a nested cluster; each file
// a card in the cluster it was in. Pure: the tree comes from folderWalk, the
// routing from fileIngest.classifyDropFile, so the canvas, list view and the
// tests all price a folder the same way.
//
// COST is in cards, because that is what the free plan counts: one card per
// file, AND one per cluster — a cluster sits on its parent's canvas as a card,
// the same rule the plans page states. The preflight asks about this number,
// and slicePlan cuts the plan down to whatever the answer allows.

import { classifyDropFile } from './fileIngest.js';

// A plan node: { name, items: [{ file, route, kind, w, h }], children: [node] }.
function planNode(node, ctx) {
  const items = [];
  for (const file of node.files) {
    const c = ctx.classify(file, { canAttemptFiles: ctx.canAttemptFiles });
    if (c.route === 'partial') { ctx.skipped.partial++; continue; }
    if (c.route === 'pureref') { ctx.skipped.pureref++; continue; }
    // A screenplay becomes a script DOCUMENT on a canvas drop (scriptImport);
    // inside a folder it is left out and said so, rather than half-handled.
    if (c.route === 'screenplay') { ctx.skipped.scripts++; continue; }
    if (c.route === 'blocked') { ctx.blocked.push(file); continue; }
    items.push({ file, ...c });
  }
  const children = node.dirs.map((d) => planNode(d, ctx)).filter(Boolean);
  // An empty folder — or one whose every file was left out — makes no cluster.
  if (!items.length && !children.length) return null;
  return { name: String(node.name || 'Folder').slice(0, 200), items, children };
}

export function countPlan(nodes) {
  const out = { clusters: 0, files: 0, cost: 0, kinds: {}, depth: 0 };
  const walk = (n, depth) => {
    out.clusters++;
    out.files += n.items.length;
    out.depth = Math.max(out.depth, depth);
    for (const it of n.items) out.kinds[it.kind] = (out.kinds[it.kind] || 0) + 1;
    n.children.forEach((c) => walk(c, depth + 1));
  };
  (nodes || []).forEach((n) => walk(n, 1));
  out.cost = out.clusters + out.files;
  return out;
}

// root: folderWalk's virtual root. Folders dropped at the top become clusters
// on the current board; LOOSE files dropped beside them are returned for the
// ordinary drop path, which already knows how to place files on this board.
export function planFolderImport(root, { canAttemptFiles = true, classify = classifyDropFile } = {}) {
  const ctx = {
    canAttemptFiles, classify,
    skipped: { partial: 0, pureref: 0, scripts: 0 },
    blocked: [],
  };
  // `nodes` are the top-level clusters; `clusters` (from countPlan) is how many
  // clusters there are in all, nested ones included.
  const nodes = (root?.dirs || []).map((d) => planNode(d, ctx)).filter(Boolean);
  return {
    nodes,
    loose: Array.from(root?.files || []),
    skipped: ctx.skipped,
    blocked: ctx.blocked,
    ...countPlan(nodes),
  };
}

// Cut a plan down to `budget` cards without ever making an empty cluster.
//
// Depth-first, in the order the folders read: a cluster is only taken if there
// is room for it AND at least one card inside it, so a budget that runs out
// halfway leaves the first folders whole rather than a trail of empty shells.
export function slicePlan(nodes, budget) {
  let left = Math.max(0, Math.floor(Number(budget) || 0));
  const take = (node) => {
    if (left < 2) return null;   // the cluster's own card, plus one inside it
    left -= 1;
    const items = node.items.slice(0, left);
    left -= items.length;
    const children = [];
    for (const child of node.children) {
      const t = take(child);
      if (t) children.push(t);
    }
    if (!items.length && !children.length) { left += 1; return null; }
    return { ...node, items, children };
  };
  const out = [];
  for (const n of nodes || []) {
    const t = take(n);
    if (t) out.push(t);
  }
  return out;
}

// Post-order: children before their parent. Undo deletes in this order, because
// deleting a cluster re-homes its live children onto ITS parent (0275) — a
// parent deleted first would scatter its folder's clusters onto the board.
export function postOrder(nodes, idOf) {
  const out = [];
  const walk = (n) => { n.children.forEach(walk); out.push(idOf(n)); };
  (nodes || []).forEach(walk);
  return out;
}
