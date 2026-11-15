// idlePrefetch.test.mjs — node --test src/lib/idlePrefetch.test.mjs
//
// The lazy admin tabs are fetched while the page is idle: one at a time, in
// order, never stopped by one that fails, and not at all once cancelled. Then
// the two lists the admin hands it, pinned from the source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { idlePrefetch } from './idlePrefetch.js';

// A window whose idle slots (or timers) run when the test says so.
function fakeWin({ idle = true } = {}) {
  const slots = new Map();
  let id = 0;
  const add = (cb) => { id += 1; slots.set(id, cb); return id; };
  const win = {
    setTimeout: (cb) => add(cb),
    clearTimeout: (h) => { slots.delete(h); },
    pending: () => slots.size,
    // Run what is scheduled now, then let the loaders' promises settle.
    async tick() {
      const run = [...slots.values()];
      slots.clear();
      for (const cb of run) cb();
      await new Promise((r) => setImmediate(r));
    },
  };
  if (idle) {
    win.requestIdleCallback = (cb) => add(cb);
    win.cancelIdleCallback = (h) => { slots.delete(h); };
  }
  return win;
}

for (const idle of [true, false]) {
  const how = idle ? 'requestIdleCallback' : 'the setTimeout fallback';

  test(`one loader per slot, in order (${how})`, async () => {
    const win = fakeWin({ idle });
    const seen = [];
    idlePrefetch([1, 2, 3].map((n) => async () => { seen.push(n); }), { win });
    assert.deepEqual(seen, [], 'nothing loads before the page is idle');
    assert.equal(win.pending(), 1);
    await win.tick();
    assert.deepEqual(seen, [1]);
    await win.tick();
    assert.deepEqual(seen, [1, 2]);
    await win.tick();
    assert.deepEqual(seen, [1, 2, 3]);
    assert.equal(win.pending(), 0, 'nothing is scheduled once the list is done');
  });

  test(`a loader that fails does not stop the ones after it (${how})`, async () => {
    const win = fakeWin({ idle });
    const seen = [];
    idlePrefetch([
      async () => { seen.push('a'); throw new Error('offline'); },
      () => { seen.push('b'); throw new Error('thrown, not rejected'); },
      async () => { seen.push('c'); },
    ], { win });
    await win.tick(); await win.tick(); await win.tick();
    assert.deepEqual(seen, ['a', 'b', 'c']);
  });

  test(`cancel stops what has not started (${how})`, async () => {
    const win = fakeWin({ idle });
    const seen = [];
    const cancel = idlePrefetch([1, 2, 3].map((n) => async () => { seen.push(n); }), { win });
    await win.tick();
    cancel();
    assert.equal(win.pending(), 0, 'the scheduled slot was cancelled');
    await win.tick();
    assert.deepEqual(seen, [1]);
  });
}

test('cancel during a load starts nothing after it', async () => {
  const win = fakeWin();
  const seen = [];
  let release;
  const cancel = idlePrefetch([
    () => { seen.push(1); return new Promise((r) => { release = r; }); },
    async () => { seen.push(2); },
  ], { win });
  await win.tick();
  cancel();
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(win.pending(), 0);
  assert.deepEqual(seen, [1]);
});

test('an empty or odd list schedules nothing', () => {
  const win = fakeWin();
  idlePrefetch([], { win })();
  idlePrefetch(null, { win })();
  idlePrefetch([null, 'x'], { win })();
  assert.equal(win.pending(), 0);
});

// ── The lists, from the source ────────────────────────────────────────────

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const staticImports = (s) => [...s.matchAll(/^import [^\n]*from '([^']+)';$/gm)].map((m) => m[1]);
const loaderKeys = (s, name) => {
  const block = s.slice(s.indexOf(`const ${name} = {`), s.indexOf('};', s.indexOf(`const ${name} = {`)));
  return [...block.matchAll(/^\s+([a-z]+):\s+\(\) => import\(/gm)].map((m) => m[1]);
};

test('the admin page imports one tab with the page, and every other tab lazily', () => {
  const s = src('../pages/AdminPage.jsx');
  const tabs = staticImports(s).filter((p) => /\/Admin[A-Za-z]+Tab\.jsx$/.test(p));
  assert.deepEqual(tabs, ['./admin/AdminAnalyticsTab.jsx']);

  // Every tab in the header but Analytics (with the page) and the Universe
  // (over a megabyte: it loads when opened or pointed at) is fetched on idle.
  const ids = [...s.slice(s.indexOf('const TABS = ['), s.indexOf('];', s.indexOf('const TABS = [')))
    .matchAll(/\{ id: '([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(ids.length > 10);
  const lazy = loaderKeys(s, 'TAB_LOADERS');
  assert.deepEqual([...lazy].sort(), ids.filter((id) => id !== 'overview' && id !== 'universe').sort());
  assert.match(s, /return idlePrefetch\(Object\.values\(TAB_LOADERS\)\);/);

  // The phone panel fetches none of them, and skips the two badge reads.
  const guards = s.match(/if \(tier !== 'admin' \|\| phonePanel\) return undefined;/g) || [];
  assert.equal(guards.length, 3);
  assert.match(s, /const phonePanel = isPhone && !fullOnPhone;/);
});

test('Analytics imports Overview with the tab, and every other view lazily', () => {
  const s = src('../pages/admin/AdminAnalyticsTab.jsx');
  const views = staticImports(s).filter((p) => /\/views\/[A-Za-z]+View\.jsx$/.test(p));
  assert.deepEqual(views, ['./analytics/views/OverviewView.jsx']);
  const ids = [...s.slice(s.indexOf('const VIEWS = ['), s.indexOf('];', s.indexOf('const VIEWS = [')))
    .matchAll(/\{ id: '([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...loaderKeys(s, 'VIEW_LOADERS')].sort(), ids.filter((id) => id !== 'overview').sort());
  assert.match(s, /useEffect\(\(\) => idlePrefetch\(Object\.values\(VIEW_LOADERS\)\), \[\]\);/);
});
