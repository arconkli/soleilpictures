// selectAll.test.mjs — node --test src/lib/selectAll.test.mjs
//
// PostgREST stops at its row cap without an error, so a single select of a
// growing table becomes a sample of it and every figure built on it
// undercounts, silently. These drive selectAll against a stand-in that caps
// each response the way PostgREST does, and pin the admin Tagging tab to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectAll, SELECT_ALL_PAGE } from './selectAll.js';

const CAP = 1000;

// A query over `n` rows that honours .range() and never returns more than CAP,
// recording every range asked for. `failAt` makes that request fail.
function table(n, { failAt = -1 } = {}) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }));
  const ranges = [];
  const build = () => ({
    range(from, to) {
      ranges.push([from, to]);
      if (ranges.length - 1 === failAt) return Promise.resolve({ data: null, error: { message: 'boom' } });
      return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + CAP)), error: null });
    },
  });
  return { build, ranges };
}

test('every row comes back, in order, past the cap', async () => {
  const { build, ranges } = table(2345);
  const r = await selectAll(build);
  assert.equal(r.error, null);
  assert.equal(r.data.length, 2345);
  assert.deepEqual(r.data.map((x) => x.id), Array.from({ length: 2345 }, (_, i) => i));
  assert.deepEqual(ranges[0], [0, SELECT_ALL_PAGE - 1]);
  assert.equal(ranges.length, Math.ceil(2345 / SELECT_ALL_PAGE));
});

test('the page is under the cap, so a short page always means the end', () => {
  assert.ok(SELECT_ALL_PAGE < CAP);
});

test('a table that is an exact number of pages ends on the empty page after it', async () => {
  const { build, ranges } = table(SELECT_ALL_PAGE * 2);
  const r = await selectAll(build);
  assert.equal(r.data.length, SELECT_ALL_PAGE * 2);
  assert.equal(ranges.length, 3);
});

test('an empty table is one request and no rows', async () => {
  const { build, ranges } = table(0);
  assert.deepEqual(await selectAll(build), { data: [], error: null });
  assert.equal(ranges.length, 1);
});

test('a failed page is the error, never the rows read before it', async () => {
  const { build } = table(1800, { failAt: 1 });
  const r = await selectAll(build);
  assert.equal(r.data, null);
  assert.deepEqual(r.error, { message: 'boom' });
});

test('the Tagging tab reads every table through it, each in a stable order', () => {
  const src = readFileSync(new URL('../pages/admin/AdminTaggingTab.jsx', import.meta.url), 'utf8');
  assert.match(src, /import \{ selectAll \} from '\.\.\/\.\.\/lib\/selectAll\.js';/);
  const reads = [...src.matchAll(/selectAll\(\(\) => supabase\.from\('([a-z_]+)'\)([\s\S]*?)\),\n/g)]
    .map((m) => [m[1], m[2]]);
  assert.deepEqual(reads.map(([t]) => t),
    ['tags', 'workspaces', 'tag_centroids', 'card_embeddings', 'entity_links', 'tag_eval_labels']);
  for (const [t, chain] of reads) assert.match(chain, /\.order\('/, `${t} is read in key order`);
  assert.doesNotMatch(src.replace(/selectAll\(\(\) => supabase\.from/g, ''), /supabase\.from\('(tags|workspaces|tag_centroids|card_embeddings|tag_eval_labels)'\)/,
    'no table is also read with one capped select');
});
