import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCursor, decodeCursor, collectSnapshot } from './universePaging.js';

test('cursor codec round-trips a compound cursor', () => {
  const ts = '2026-08-16T12:34:56.123456+00:00';
  const enc = encodeCursor(ts, 'board:abc');
  assert.equal(enc, `${ts}~board:abc`);
  assert.deepEqual(decodeCursor(enc), { ts, key: 'board:abc' });
});

test('cursor codec: keys containing chr(31) and ~ survive', () => {
  const ts = '2026-01-01T00:00:00+00:00';
  const key = `card:a:b\x1fboard:c\x1fstructural~weird`;
  assert.deepEqual(decodeCursor(encodeCursor(ts, key)), { ts, key });
});

test('cursor codec: legacy plain-ISO cursor decodes with empty key', () => {
  assert.deepEqual(decodeCursor('2026-01-01T00:00:00+00:00'),
    { ts: '2026-01-01T00:00:00+00:00', key: '' });
});

test('cursor codec: null/empty', () => {
  assert.equal(encodeCursor(null, 'x'), null);
  assert.deepEqual(decodeCursor(null), { ts: null, key: '' });
  assert.deepEqual(decodeCursor(''), { ts: null, key: '' });
});

// Build a fake party server over a synthetic corpus with duplicate
// timestamps (the exact shape that used to skip rows).
function makeServer({ nodeCount, edgeCount, pageSize }) {
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    // Ten nodes share each timestamp — worse than production's 51-in-
    // one-transaction case relative to the page size used below.
    nodes.push({ node_id: `card:b:${String(i).padStart(6, '0')}`, created_at: `ts${String(Math.floor(i / 10)).padStart(6, '0')}` });
  }
  const edges = [];
  for (let i = 0; i < edgeCount; i++) {
    edges.push({ source_id: 'board:b', target_id: `card:b:${i}`, edge_kind: 'structural', created_at: `ts${String(i).padStart(6, '0')}` });
  }
  const keyOf = (r) => r.node_id || `${r.source_id}\x1f${r.target_id}\x1f${r.edge_kind}`;
  const after = (rows, cursor) => {
    const { ts, key } = decodeCursor(cursor);
    if (!ts) return rows;
    return rows.filter((r) => r.created_at > ts || (r.created_at === ts && keyOf(r) > key));
  };
  let calls = 0;
  const fetchPage = async ({ nodesCursor, edgesCursor }) => {
    calls++;
    const np = after(nodes, nodesCursor).slice(0, pageSize);
    const ep = after(edges, edgesCursor).slice(0, pageSize);
    const nLast = np[np.length - 1];
    const eLast = ep[ep.length - 1];
    return {
      nodes: np,
      edges: ep,
      next_nodes_cursor: nLast ? encodeCursor(nLast.created_at, keyOf(nLast)) : nodesCursor,
      next_edges_cursor: eLast ? encodeCursor(eLast.created_at, keyOf(eLast)) : edgesCursor,
      done: np.length < pageSize && ep.length < pageSize,
    };
  };
  return { fetchPage, callCount: () => calls };
}

test('collectSnapshot walks every page: all nodes and edges, no dupes', async () => {
  const { fetchPage } = makeServer({ nodeCount: 437, edgeCount: 251, pageSize: 97 });
  const out = await collectSnapshot({ fetchPage });
  assert.equal(out.nodes.length, 437);
  assert.equal(out.edges.length, 251);
  assert.equal(new Set(out.nodes.map((n) => n.node_id)).size, 437);
  assert.equal(out.truncated, false);
});

test('collectSnapshot survives page boundaries inside duplicate-timestamp groups', async () => {
  // pageSize 7 with 10 nodes per timestamp guarantees boundaries land
  // mid-group on most pages.
  const { fetchPage } = makeServer({ nodeCount: 200, edgeCount: 0, pageSize: 7 });
  const out = await collectSnapshot({ fetchPage });
  assert.equal(out.nodes.length, 200);
});

test('collectSnapshot: maxNodes cap reports truncation', async () => {
  const { fetchPage } = makeServer({ nodeCount: 500, edgeCount: 0, pageSize: 100 });
  const out = await collectSnapshot({ fetchPage, maxNodes: 250 });
  assert.equal(out.nodes.length, 250);
  assert.equal(out.truncated, true);
});

test('collectSnapshot: a server that never advances cursors cannot loop forever', async () => {
  let calls = 0;
  const fetchPage = async () => {
    calls++;
    return { nodes: [{ node_id: `n${calls}` }], edges: [], next_nodes_cursor: 'stuck', next_edges_cursor: null, done: false };
  };
  const out = await collectSnapshot({ fetchPage });
  assert.equal(calls, 2); // page 1 sets cursor to 'stuck', page 2 detects no advance
  assert.equal(out.nodes.length, 2);
});

test('collectSnapshot: cancellation abandons the walk', async () => {
  const { fetchPage, callCount } = makeServer({ nodeCount: 1000, edgeCount: 0, pageSize: 10 });
  let pages = 0;
  const out = await collectSnapshot({
    fetchPage,
    isCancelled: () => ++pages >= 3,
  });
  assert.equal(out.cancelled, true);
  assert.equal(callCount(), 3);
});

test('collectSnapshot: onProgress reports running totals', async () => {
  const { fetchPage } = makeServer({ nodeCount: 30, edgeCount: 30, pageSize: 10 });
  const seen = [];
  await collectSnapshot({ fetchPage, onProgress: (p) => seen.push({ ...p }) });
  assert.equal(seen[seen.length - 1].nodes, 30);
  assert.equal(seen[seen.length - 1].edges, 30);
  assert.ok(seen.length >= 3);
});
