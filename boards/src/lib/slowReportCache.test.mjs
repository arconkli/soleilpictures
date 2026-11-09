import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedReport, forgetReports, _dropMemory } from './slowReportCache.js';

function fakeStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}
const reset = () => { _dropMemory(); };

test('a fresh hit does not call the loader', async () => {
  reset();
  const store = fakeStore(); let n = 0;
  const load = async () => { n++; return { data: [1], error: null }; };
  await cachedReport('a', { x: 1 }, load, { store });
  const r = await cachedReport('a', { x: 1 }, load, { store });
  assert.equal(n, 1);
  assert.deepEqual(r.data, [1]);
});

test('different args load separately', async () => {
  reset();
  const store = fakeStore(); let n = 0;
  const load = async () => { n++; return { data: n, error: null }; };
  await cachedReport('a', { x: 1 }, load, { store });
  await cachedReport('a', { x: 2 }, load, { store });
  assert.equal(n, 2);
});

test('an expired entry loads again', async () => {
  reset();
  const store = fakeStore(); let n = 0; let t = 1000;
  const load = async () => { n++; return { data: n, error: null }; };
  const o = { store, now: () => t, ttlMs: 100 };
  await cachedReport('a', {}, load, o);
  t += 99; await cachedReport('a', {}, load, o);
  assert.equal(n, 1);
  t += 1; const r = await cachedReport('a', {}, load, o);
  assert.equal(n, 2);
  assert.equal(r.data, 2);
});

test('sessionStorage serves a reload', async () => {
  reset();
  const store = fakeStore(); let n = 0;
  const load = async () => { n++; return { data: 'x', error: null }; };
  await cachedReport('a', {}, load, { store });
  _dropMemory();
  const r = await cachedReport('a', {}, load, { store });
  assert.equal(n, 1);
  assert.equal(r.data, 'x');
});

test('two calls while loading share one load', async () => {
  reset();
  const store = fakeStore(); let n = 0;
  const load = async () => { n++; await new Promise((r) => setTimeout(r, 10)); return { data: 1, error: null }; };
  const [a, b] = await Promise.all([cachedReport('a', {}, load, { store }), cachedReport('a', {}, load, { store })]);
  assert.equal(n, 1);
  assert.equal(a, b);
});

test('failed loads are not stored', async () => {
  reset();
  const store = fakeStore(); let n = 0;
  await cachedReport('a', {}, async () => { n++; return { data: null, error: new Error('boom') }; }, { store });
  await assert.rejects(cachedReport('a', {}, async () => { n++; throw new Error('down'); }, { store }));
  const r = await cachedReport('a', {}, async () => { n++; return { data: 1, error: null }; }, { store });
  assert.equal(n, 3);
  assert.equal(r.data, 1);
});

test('broken storage and unparseable values are ignored', async () => {
  reset();
  const broken = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); }, key() { throw new Error('no'); }, length: 1 };
  let n = 0;
  const load = async () => { n++; return { data: 1, error: null }; };
  await cachedReport('a', {}, load, { store: broken });
  await cachedReport('a', {}, load, { store: broken });
  assert.equal(n, 1);
  forgetReports(broken);

  reset();
  const store = fakeStore();
  store.setItem('slowReport:a{}', '{not json');
  await cachedReport('a', {}, load, { store });
  assert.equal(n, 2);
});

test('forgetReports clears the Map and storage', async () => {
  reset();
  const store = fakeStore(); let n = 0;
  const load = async () => { n++; return { data: 1, error: null }; };
  await cachedReport('a', {}, load, { store });
  forgetReports(store);
  assert.equal(store.length, 0);
  await cachedReport('a', {}, load, { store });
  assert.equal(n, 2);
});
