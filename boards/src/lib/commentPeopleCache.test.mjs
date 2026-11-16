// Who "@" offers, asked once per cluster and not on every open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPeopleCache } from './commentPeopleCache.js';

const loader = (value, keep = true) => {
  const f = async () => { f.calls += 1; return { value, keep }; };
  f.calls = 0;
  return f;
};

test('one ask per key while the cluster stays the same', async () => {
  const c = createPeopleCache();
  const load = loader({ members: ['a'], shares: [] });
  assert.equal(c.peek('b1', 'w:b1:1'), null);
  const [x, y] = await Promise.all([c.get('b1', 'w:b1:1', load), c.get('b1', 'w:b1:1', load)]);
  assert.equal(load.calls, 1, 'two asks at once share one');
  assert.equal(x, y);
  assert.deepEqual(await c.get('b1', 'w:b1:1', load), { members: ['a'], shares: [] });
  assert.equal(load.calls, 1, 'the next open asks nothing');
  assert.deepEqual(c.peek('b1', 'w:b1:1'), { members: ['a'], shares: [] });
  // an editor's lists are their own key
  const ed = loader({ members: ['a'], shares: ['s'] });
  await c.get('b1', 'w:b1:0', ed);
  assert.equal(ed.calls, 1);
  assert.equal(load.calls, 1);
});

test('another cluster drops what was kept', async () => {
  const c = createPeopleCache();
  const one = loader({ members: ['a'], shares: [] });
  await c.get('b1', 'w:b1:1', one);
  const two = loader({ members: ['z'], shares: [] });
  assert.deepEqual(await c.get('b2', 'w:b2:1', two), { members: ['z'], shares: [] });
  assert.equal(c.peek('b1', 'w:b1:1'), null);
  await c.get('b1', 'w:b1:1', one);
  assert.equal(one.calls, 2, 'back on the first cluster: asked again');
});

test('a list that could not be fetched is handed over but not kept', async () => {
  const c = createPeopleCache();
  const bad = loader({ members: [], shares: [] }, false);
  assert.deepEqual(await c.get('b1', 'k', bad), { members: [], shares: [] });
  assert.equal(c.peek('b1', 'k'), null);
  await c.get('b1', 'k', bad);
  assert.equal(bad.calls, 2);
  // a load that throws is not kept either
  await assert.rejects(c.get('b1', 'x', async () => { throw new Error('no'); }));
  const ok = loader({ members: ['a'], shares: [] });
  await c.get('b1', 'x', ok);
  assert.equal(ok.calls, 1);
});

test('an answer that arrives after the cluster changed is not kept under the new one', async () => {
  const c = createPeopleCache();
  let release;
  const slow = () => new Promise((r) => { release = () => r({ value: { members: ['old'], shares: [] }, keep: true }); });
  const p = c.get('b1', 'k', slow);
  await new Promise((r) => setTimeout(r, 5));
  await c.get('b2', 'k2', loader({ members: [], shares: [] }));
  release();
  assert.deepEqual(await p, { members: ['old'], shares: [] });
  assert.equal(c.peek('b2', 'k'), null);
  assert.equal(c.peek('b1', 'k'), null);
});
