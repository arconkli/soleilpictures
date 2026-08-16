// Synthetic universe corpus for the DEV-only admin preview harness
// (?adminpreview=1&tab=universe&n=200000). Exercises the REAL
// UniverseGraph pipeline — collectSnapshot paging, worker layout,
// disc/halo/sphere rendering — at any node count, with the same row
// shapes and orderings the party server produces. Deterministic
// (seeded LCG) so screenshots are comparable across runs.
//
// Structure mimics production: users anchor workspaces, workspaces
// hold boards (some nested), boards hold cards on a whale-heavy
// distribution (most boards small, a few huge — that's what real
// imports look like), plus a sprinkle of semantic links. Timestamps
// advance monotonically but ~15% of rows share their predecessor's
// timestamp, mimicking bulk imports (the case that used to break
// cursor pagination).

const CARD_KINDS = [
  ['note',    0.30],
  ['image',   0.30],
  ['doc',     0.12],
  ['link',    0.10],
  ['card',    0.13],
  ['palette', 0.05],
];

export function makeSyntheticUniverse({ nodeTarget = 20000, seed = 7 } = {}) {
  let s = (seed >>> 0) || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (weighted) => {
    let r = rand();
    for (const [v, w] of weighted) { r -= w; if (r <= 0) return v; }
    return weighted[weighted.length - 1][0];
  };

  // Monotonic-ish timestamps with duplicate groups.
  let tMs = Date.UTC(2026, 0, 1);
  const nextTs = () => {
    if (rand() > 0.15) tMs += 1000 + Math.floor(rand() * 800000);
    return new Date(tMs).toISOString();
  };

  const nodes = [];
  const edges = [];
  const addNode = (node_id, kind, workspace_id) =>
    nodes.push({ node_id, kind, workspace_id, created_at: nextTs() });
  const addEdge = (source_id, target_id, edge_kind) =>
    edges.push({ source_id, target_id, edge_kind, created_at: nextTs() });

  const W = Math.max(3, Math.round(nodeTarget / 80));
  const U = Math.max(3, Math.round(W * 1.1));
  const wsIds = [];
  for (let i = 0; i < W; i++) {
    const id = `ws:w${i}`;
    wsIds.push(`w${i}`);
    addNode(id, 'ws', `w${i}`);
  }
  for (let i = 0; i < U; i++) {
    const id = `user:u${i}`;
    addNode(id, 'user', null);
    // Everyone belongs somewhere; ~15% span a second workspace and
    // become the hubs that pull galaxies together.
    const home = Math.floor(rand() * W);
    addEdge(id, `ws:w${home}`, 'membership');
    if (rand() < 0.15) addEdge(id, `ws:w${(home + 1 + Math.floor(rand() * (W - 1))) % W}`, 'membership');
  }

  // Boards: 1–6 top-level per workspace, ~20% with nested children.
  const boards = []; // { bid, ws }
  for (let w = 0; w < W; w++) {
    const tops = 1 + Math.floor(rand() * 6);
    for (let b = 0; b < tops; b++) {
      const bid = `b${w}_${b}`;
      boards.push({ bid, ws: wsIds[w] });
      addNode(`board:${bid}`, 'board', wsIds[w]);
      addEdge(`ws:w${w}`, `board:${bid}`, 'wsroot');
      if (rand() < 0.2) {
        const kids = 1 + Math.floor(rand() * 3);
        for (let k = 0; k < kids; k++) {
          const kid = `b${w}_${b}_${k}`;
          boards.push({ bid: kid, ws: wsIds[w] });
          addNode(`board:${kid}`, 'board', wsIds[w]);
          addEdge(`board:${bid}`, `board:${kid}`, 'hierarchy');
        }
      }
    }
  }

  // Cards fill the remaining budget, whale-distributed across boards.
  const cardBudget = Math.max(0, nodeTarget - nodes.length);
  const weights = boards.map(() => Math.pow(rand() + 0.001, -0.7));
  const wSum = weights.reduce((a, b) => a + b, 0);
  let made = 0;
  const cardIds = [];
  for (let i = 0; i < boards.length && made < cardBudget; i++) {
    const share = i === boards.length - 1
      ? cardBudget - made
      : Math.min(cardBudget - made, Math.round((weights[i] / wSum) * cardBudget));
    const { bid, ws } = boards[i];
    for (let c = 0; c < share; c++) {
      const nid = `card:${bid}:c${c}`;
      cardIds.push(nid);
      addNode(nid, pick(CARD_KINDS), ws);
      addEdge(`board:${bid}`, nid, 'structural');
      made++;
    }
  }
  // Semantic sprinkle: ~2% of cards link to another random card.
  const semantic = Math.floor(cardIds.length * 0.02);
  for (let i = 0; i < semantic; i++) {
    const a = cardIds[Math.floor(rand() * cardIds.length)];
    const b = cardIds[Math.floor(rand() * cardIds.length)];
    if (a !== b) addEdge(a, b, 'card');
  }

  // Server contract: rows arrive ordered by (created_at, id).
  nodes.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 :
    a.node_id < b.node_id ? -1 : 1));
  edges.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  return { nodes, edges };
}

// A collectSnapshot-compatible fetchPage over the synthetic corpus.
// Cursors are plain indices (they're opaque to the walker). Pages are
// deliberately smaller than the requested limits so the multi-page
// path actually runs.
export function makeSyntheticDataSource({ nodeTarget = 20000, seed = 7 } = {}) {
  const { nodes, edges } = makeSyntheticUniverse({ nodeTarget, seed });
  const fetchPage = async ({ nodesCursor, edgesCursor, nodeLimit, edgeLimit }) => {
    const nFrom = nodesCursor ? parseInt(nodesCursor, 10) : 0;
    const eFrom = edgesCursor ? parseInt(edgesCursor, 10) : 0;
    const nPage = Math.min(nodeLimit || 50000, 20000);
    const ePage = Math.min(edgeLimit || 100000, 40000);
    const pageNodes = nodes.slice(nFrom, nFrom + nPage);
    const pageEdges = edges.slice(eFrom, eFrom + ePage);
    return {
      nodes: pageNodes,
      edges: pageEdges,
      next_nodes_cursor: String(nFrom + pageNodes.length),
      next_edges_cursor: String(eFrom + pageEdges.length),
      done: nFrom + pageNodes.length >= nodes.length && eFrom + pageEdges.length >= edges.length,
    };
  };
  return {
    fetchPage,
    disableDeltas: true,
    totals: { nodes: nodes.length, edges: edges.length },
  };
}
