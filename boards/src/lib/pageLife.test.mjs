// pageLife.test.mjs — a page that died on screen is noticed by the load after
// it, and a page that left the way pages leave, or died hidden, is not.
//
//   node --test src/lib/pageLife.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_NOTE_KEY, diedOnScreen, startPageLife } from './pageLife.js';

const here = dirname(fileURLToPath(import.meta.url));

// One tab: its sessionStorage outlives the pages loaded in it.
function tab() {
  const items = new Map();
  return {
    getItem: (k) => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => items.set(k, String(v)),
    removeItem: (k) => items.delete(k),
    items,
  };
}

// One page in it: its document, its window, its clock.
function page(store, { vis = 'visible', at = 1000 } = {}) {
  const on = { doc: {}, win: {} };
  const listen = (where) => (name, fn) => { (on[where][name] ||= []).push(fn); };
  const p = {
    clock: at,
    reports: [],
    doc: { visibilityState: vis, addEventListener: listen('doc') },
    win: { addEventListener: listen('win'), setInterval: (fn) => { p.tick = fn; return 1; } },
    fire(where, name, e = {}) { for (const fn of on[where][name] || []) fn(e); },
  };
  startPageLife({ store, doc: p.doc, win: p.win, now: () => p.clock, report: (ms) => p.reports.push(ms) });
  return p;
}

test('what a note says', () => {
  assert.equal(diedOnScreen('1000 61000 visible'), 60_000);
  assert.equal(diedOnScreen('1000 1000 visible'), 0);
  assert.equal(diedOnScreen('1000 61000 hidden'), null);
  assert.equal(diedOnScreen('61000 1000 visible'), null, 'a clock that went back says nothing');
  assert.equal(diedOnScreen('junk'), null);
  assert.equal(diedOnScreen(''), null);
  assert.equal(diedOnScreen(null), null);
});

test('a page that died on screen is noticed by the next load, with how long it had lived', () => {
  const store = tab();
  const first = page(store, { at: 1000 });
  first.clock = 31_000;
  first.tick();                     // a minute's look, while on screen
  first.clock = 45_000;             // and then it's gone: no pagehide
  const next = page(store, { at: 50_000 });
  assert.deepEqual(next.reports, [30_000]);
  assert.match(store.getItem(PAGE_NOTE_KEY), /^50000 50000 visible$/, 'the new page keeps its own note');
});

test('a page that left as pages leave, or died hidden, is nobody\'s crash', () => {
  const store = tab();
  const left = page(store);
  left.fire('win', 'pagehide');
  assert.equal(store.getItem(PAGE_NOTE_KEY), null);
  assert.deepEqual(page(store).reports, []);

  const hidden = page(store);
  hidden.doc.visibilityState = 'hidden';
  hidden.fire('doc', 'visibilitychange');
  hidden.clock = 99_000;
  hidden.tick();                    // a hidden page doesn't look
  assert.match(store.getItem(PAGE_NOTE_KEY), / hidden$/);
  assert.deepEqual(page(store).reports, [], 'reclaimed in the background, as a phone does');
});

test('back from the back-forward cache, a page keeps its note again', () => {
  const store = tab();
  const p = page(store);
  p.fire('win', 'pagehide', { persisted: true });
  assert.equal(store.getItem(PAGE_NOTE_KEY), null);
  p.fire('win', 'pageshow', { persisted: true });
  assert.match(store.getItem(PAGE_NOTE_KEY), / visible$/);
  // A fresh load's own pageshow isn't a return.
  const q = page(tab());
  q.fire('win', 'pageshow', { persisted: false });
  assert.deepEqual(q.reports, []);
});

test('storage it can\'t use leaves it quiet', () => {
  const refused = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('x'); }, removeItem() {} };
  assert.doesNotThrow(() => page(refused));
  const full = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); }, removeItem() {} };
  assert.doesNotThrow(() => page(full));
});

test('App.jsx starts it as its chunk loads, and reports a crash with nothing in it but how long', () => {
  const src = readFileSync(join(here, '..', 'App.jsx'), 'utf8');
  const start = src.indexOf('startPageLife({');
  assert.ok(start > 0 && start < src.indexOf('\nfunction '), 'at module scope, before the first function');
  assert.match(src.slice(start, start + 400), /reportError\(new Error\('Page died on screen'\), \{ kind: 'page_crash', severity: 'crash', context: \{ ms \} \}\)/);
});
