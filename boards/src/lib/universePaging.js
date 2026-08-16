// universePaging — cursor codec + snapshot page-walk for the admin
// universe. Shared by party/universe.ts (which talks to the _v2
// Supabase RPCs) and UniverseGraph.jsx (which walks the party's
// /snapshot pages). Worker-safe: no DOM, no deps.
//
// Why this exists: the universe could never show more than 1,000
// nodes. The v1 RPCs are set-returning, so PostgREST truncated every
// page at the project's max_rows (1000) regardless of the requested
// limit — and the client treated "fewer rows than I asked for" as
// "done" after page one. The _v2 RPCs return a single jsonb row
// (immune to max_rows) and paginate on a compound (created_at, id)
// keyset so rows sharing a timestamp — bulk imports share their
// transaction's now() — can never be skipped. `done` is computed in
// SQL, where LIMIT is actually enforced, and is the ONLY termination
// signal the client trusts.

// Opaque compound cursor: '<iso-ts>~<tiebreak>'. '~' never appears in
// an ISO timestamp, so we split on the FIRST '~' only — the tiebreak
// may contain anything (edge keys embed chr(31)). A legacy plain-ISO
// cursor (no '~') decodes as { ts, key: '' }, which keeps still-
// deployed clients working against the new party server.
export function encodeCursor(ts, key) {
  if (!ts) return null;
  return `${ts}~${key || ''}`;
}

export function decodeCursor(raw) {
  if (!raw) return { ts: null, key: '' };
  const i = raw.indexOf('~');
  if (i === -1) return { ts: raw, key: '' };
  return { ts: raw.slice(0, i), key: raw.slice(i + 1) };
}

// Walk every /snapshot page until the server says done.
//
//   fetchPage({ nodesCursor, edgesCursor, nodeLimit, edgeLimit })
//     → { nodes, edges, next_nodes_cursor, next_edges_cursor, done }
//
// Termination:
//   • server `done` (both axes exhausted) — the normal path
//   • maxNodes cap → { truncated: true } so the caller can say so
//   • neither cursor advanced across a page → defensive break (a
//     server bug must not become an infinite loop)
//   • maxPages safety bound, same reasoning
//
// onProgress({ nodes, edges }) fires after each page with running
// totals. isCancelled() lets the caller abandon a stale walk.
export async function collectSnapshot({
  fetchPage,
  nodeLimit = 50000,
  edgeLimit = 100000,
  maxNodes = Infinity,
  maxPages = 500,
  onProgress = null,
  isCancelled = null,
}) {
  const nodes = [];
  const edges = [];
  let nodesCursor = null;
  let edgesCursor = null;
  let truncated = false;

  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage({ nodesCursor, edgesCursor, nodeLimit, edgeLimit });
    if (isCancelled?.()) return { nodes, edges, truncated, cancelled: true };

    for (const n of page.nodes || []) {
      if (nodes.length >= maxNodes) { truncated = true; break; }
      nodes.push(n);
    }
    for (const e of page.edges || []) edges.push(e);
    onProgress?.({ nodes: nodes.length, edges: edges.length });
    if (truncated) break;
    if (page.done) break;

    const nextNodes = page.next_nodes_cursor ?? nodesCursor;
    const nextEdges = page.next_edges_cursor ?? edgesCursor;
    if (nextNodes === nodesCursor && nextEdges === edgesCursor) break;
    nodesCursor = nextNodes;
    edgesCursor = nextEdges;
  }

  return { nodes, edges, truncated, cancelled: false };
}
