// adminKeep.test.mjs — node --test src/lib/adminKeep.test.mjs
//
// What the desktop admin keeps from the last visit: the names it is kept under,
// what is left out of it, and when the header says "Updating…". Then the wiring
// that cannot run in node (React hooks), pinned from the source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keepOf, snapKey, overviewKeep, isUpdating } from './adminKeep.js';
import { readSnap, writeSnap } from './adminSnapshot.js';
import { SHARED_REPORTS } from './adminReport.js';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

function memoryStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

test('no account or no key means nothing is kept', () => {
  assert.equal(keepOf(null), null);
  assert.equal(keepOf(undefined), null);
  assert.equal(keepOf({ uid: null, key: 'a' }), null);
  assert.equal(keepOf({ uid: 'u', key: '' }), null);
  const save = (r) => r;
  assert.deepEqual(keepOf({ uid: 'u', key: 'k', save }), { uid: 'u', key: 'k', save });
  assert.equal(keepOf({ uid: 'u', key: 'k', save: 'nope' }).save, null);
});

test('a snapshot is named by every input, so one filter never paints as another', () => {
  const keys = new Set();
  for (const internal of [true, false]) {
    for (const verified of [true, false]) keys.add(snapKey('overview.q', [internal, verified]));
  }
  assert.equal(keys.size, 4);
  assert.notEqual(snapKey('overview.q', [true, true]), snapKey('overview.g', [true, true]));
  // Order matters: (internal, verified) is not (verified, internal).
  assert.notEqual(snapKey('overview.q', [true, false]), snapKey('overview.q', [false, true]));
  assert.equal(snapKey('overview.q', [true, false]), snapKey('overview.q', [true, false]));
  // A value that looks like another's separator cannot collide with it.
  assert.notEqual(snapKey('x', ['a,b']), snapKey('x', ['a', 'b']));
});

// Invented, in the shape the Overview's main read returns.
const overviewResult = () => ({
  startedAt: 1,
  kpi: { current: { signups: 3, wau: 9 }, previous: { signups: 2, wau: 8 } },
  history: [{ day: '2026-01-05', mrr_cents: 0 }],
  weekly: [{ week_start: '2026-01-05', complete: true, signups: 3 }],
  markers: [{ day: '2026-01-06', kind: 'note', label: 'something the owner wrote', source: 'note', ref_id: 4 }],
  activeNow: 2,
  users: [{ user_id: 'u-1', email: 'someone@example.com', created_at: '2026-01-06T00:00:00Z', card_count: 1 }],
  lifetime: { users: 12, cards: 40 },
  stalled: { total: 1, rows: [{ user_id: 'u-2', email: 'other@example.com', signup_age: 3 }] },
});

test('the Overview keeps its counts and leaves out people and their words', () => {
  const full = overviewResult();
  const kept = overviewKeep(full);
  assert.equal(kept.users, null);
  assert.equal(kept.stalled, null);
  assert.equal(kept.markers, null);
  assert.deepEqual(kept.kpi, full.kpi);
  assert.deepEqual(kept.weekly, full.weekly);
  assert.deepEqual(kept.history, full.history);
  assert.deepEqual(kept.lifetime, full.lifetime);
  assert.equal(kept.activeNow, 2);
  // The read's own result is untouched: it is what is on screen.
  assert.equal(full.users.length, 1);
  assert.equal(full.markers.length, 1);

  const json = JSON.stringify(kept);
  for (const word of ['example.com', 'u-1', 'u-2', 'email', 'user_id', 'the owner wrote']) {
    assert.ok(!json.includes(word), `the kept Overview still carries "${word}"`);
  }
  assert.equal(overviewKeep(null), null);
  assert.equal(overviewKeep(undefined), undefined);
});

test('what is kept comes back as it was stored, under its own name only', () => {
  const store = memoryStore();
  const key = snapKey('overview.q', [true, true]);
  assert.equal(writeSnap('u', key, overviewKeep(overviewResult()), { store, now: () => 1000 }), true);
  const back = readSnap('u', key, { store, now: () => 2000 });
  assert.equal(back.at, 1000);
  assert.equal(back.data.users, null);
  assert.equal(back.data.kpi.current.signups, 3);
  assert.equal(readSnap('u', snapKey('overview.q', [false, true]), { store, now: () => 2000 }), null);
  assert.equal(readSnap('someone-else', key, { store, now: () => 2000 }), null);
});

test('"Updating…" shows for a snapshot on screen, and gives way to a failed refresh', () => {
  assert.equal(isUpdating(), false);
  assert.equal(isUpdating({ stale: false, error: null }), false);
  assert.equal(isUpdating({ stale: true, error: null }), true);
  // The "couldn't refresh" strip has it from here.
  assert.equal(isUpdating({ stale: true, error: 'timeout' }), false);
  assert.equal(isUpdating({ stale: false }, { stale: true, error: 'x' }, { stale: true, error: null }), true);
  assert.equal(isUpdating(null, undefined), false);
});

// ── Wiring, from the source ───────────────────────────────────────────────

test('the hook paints a snapshot before the first paint and saves what the read brings', () => {
  const s = src('../pages/admin/useAdminData.js');
  // Read in a state initializer, so the first render already has the numbers.
  assert.match(s, /useState\(\(\) => \(keep \? readSnap\(keep\.uid, keep\.key\) : null\)\)/);
  assert.match(s, /writeSnap\(kept\.uid, kept\.key, kept\.save \? kept\.save\(result\) : result\)/);
  // The button's refresh is the only one that asks for newly computed numbers.
  assert.match(s, /const refresh = useCallback\(\(\) => run\(false\), \[run\]\)/);
  assert.match(s, /const refreshFresh = useCallback\(\(\) => run\(true\), \[run\]\)/);
  // The poll, the focus refetch and the first load call run() bare.
  assert.equal((s.match(/\brun\(\);/g) || []).length, 3);
});

test('every kept read names its account, its inputs and what it stores', () => {
  const ov = src('../pages/admin/analytics/views/OverviewView.jsx');
  assert.match(ov, /keep: uid \? \{ uid, key: snapKey\('overview\.q', population\), save: overviewKeep \} : null/);
  assert.match(ov, /keep: uid \? \{ uid, key: snapKey\('overview\.g', population\) \} : null/);
  assert.match(ov, /keep: uid \? \{ uid, key: snapKey\('overview\.heat', \[f\.excludeInternal, TZ\]\) \} : null/);
  assert.match(ov, /const population = \[f\.excludeInternal, f\.verifiedOnly\];/);
  const ctx = src('../pages/admin/analytics/AnalyticsFiltersContext.jsx');
  assert.match(ctx, /key: snapKey\('analytics\.stats', \[verifiedOnly\]\)/);
  // Nothing else on the desktop keeps a read: a new one needs its own privacy check here.
  assert.equal((ov.match(/\bkeep: /g) || []).length, 3);
  assert.equal((ctx.match(/\bkeep: /g) || []).length, 1);
});

test('the heavy reports go through adminReport on the desktop, never straight to rpc', () => {
  const files = [
    '../pages/admin/analytics/views/OverviewView.jsx',
    '../pages/admin/analytics/views/RetentionView.jsx',
    '../pages/admin/analytics/views/SharingView.jsx',
    '../pages/admin/analytics/views/TestsView.jsx',
  ].map(src).join('\n');
  for (const fn of SHARED_REPORTS) {
    assert.ok(!files.includes(`supabase.rpc('${fn}'`), `${fn} is still read with supabase.rpc`);
    const calls = files.match(new RegExp(`adminReport\\(supabase, '${fn}', [^\\n]*\\{ fresh \\}\\)`, 'g')) || [];
    assert.ok(calls.length >= 1, `${fn} is not read through adminReport with { fresh }`);
  }
  // Two measures of the return by mode.
  assert.equal((files.match(/adminReport\(supabase, 'admin_return_by_mode'/g) || []).length, 2);
});

test('the heatmap is a read of its own, and the segments wait for the Funnel view', () => {
  const ov = src('../pages/admin/analytics/views/OverviewView.jsx');
  const batch = ov.slice(ov.indexOf('const q = useAdminData('), ov.indexOf('const heat = useAdminData('));
  assert.ok(batch.length > 0);
  assert.ok(!batch.includes('admin_activity_heatmap'), 'the heatmap is back in the tiles\' batch');
  assert.match(ov, /forgetReports\(\); refreshQ\(\); refreshG\(\); refreshHeat\(\);/);

  const ctx = src('../pages/admin/analytics/AnalyticsFiltersContext.jsx');
  assert.match(ctx, /const segmentsOn = view === 'funnel';/);
  assert.match(ctx, /if \(!segmentsOn\) return segmentsHeld\.current\.rows;/);
  assert.match(src('../pages/admin/AdminAnalyticsTab.jsx'), /<AnalyticsFiltersProvider view=\{view\}>/);
});
