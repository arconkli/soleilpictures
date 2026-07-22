// upsellMetrics.test.mjs — plain-node unit tests for the upsell exposure core.
//
//   node --test src/lib/upsellMetrics.test.mjs
//
// upsellMetrics.js is deliberately node-importable (emitter + storage are
// INJECTED via setUpsellSink, not statically imported from analytics.js) so the
// envelope / summary-once / hover-threshold / trace-coalescing / PII-safety
// logic is testable without a browser — the same discipline as
// landingMetrics.test.mjs. The DOM layer (useUpsellExposure) is exercised by
// the Playwright spec instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setUpsellSink, createUpsellExposure, nextExposureN, FEATURE_HOVER_MS,
} from './upsellMetrics.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

function setup({ t = 1000 } = {}) {
  const events = [];
  const clock = { t };
  const store = fakeStorage();
  setUpsellSink({
    logEvent:    (name, props) => events.push({ name, props, beacon: false }),
    logEventNow: (name, props) => events.push({ name, props, beacon: true }),
    now: () => clock.t,
    storage: store,
  });
  return { events, clock, store };
}

function exposure(opts = {}) {
  return createUpsellExposure({
    surface: 'modal', header: 'cap-hit', via: 'cap_hit', copyRev: 'studio_v1',
    uid: 'u1', tier: 'demo',
    userState: { demoCardCount: 90, cardLimit: 100, signupAt: null },
    ...opts,
  });
}

function summaries(events) { return events.filter((e) => e.name === 'up_exposure_summary'); }

test('view mints exposure_n once and the counter increments across exposures per uid', () => {
  setup();
  const a = exposure();
  a.view(); a.view();
  assert.equal(a.__state().exposureN, 1, 'double view mints once');
  const b = exposure();
  b.view();
  assert.equal(b.__state().exposureN, 2, 'second exposure increments');
  const other = exposure({ uid: 'u2' });
  other.view();
  assert.equal(other.__state().exposureN, 1, 'per-uid key isolation');
});

test('nextExposureN returns null without storage instead of throwing', () => {
  setup();
  setUpsellSink({ storage: { getItem() { throw new Error('quota'); }, setItem() {} } });
  assert.equal(nextExposureN('u1'), null);
});

test('envelope carries the full schema and derives cap_pct/acct_days', () => {
  const { clock } = setup({ t: 1000 });
  const x = exposure({ userState: { demoCardCount: 90, cardLimit: 100, signupAt: new Date(clock.t - 5 * 86400000).toISOString() } });
  x.view();
  const env = x.envelope();
  assert.deepEqual(env, {
    surface: 'modal', header: 'cap-hit', via: 'cap_hit', copy_rev: 'studio_v1',
    exposure_n: 1, tier: 'demo', cap_pct: 90, demo_cards: 90, acct_days: 5,
  });
  const bare = exposure({ tier: null, userState: null });
  const benv = bare.envelope();
  assert.deepEqual(
    [benv.tier, benv.cap_pct, benv.demo_cards, benv.acct_days],
    [null, null, null, null],
    'missing state is null, never NaN/undefined',
  );
});

test('update() refreshes what envelope() sees (tier/userState resolve async)', () => {
  setup();
  const x = exposure({ tier: null, userState: null });
  x.update({ tier: 'demo', userState: { demoCardCount: 50, cardLimit: 100 } });
  const env = x.envelope();
  assert.deepEqual([env.tier, env.cap_pct], ['demo', 50]);
});

test('ttfi is set once at the first interaction', () => {
  const { clock } = setup({ t: 1000 });
  const x = exposure();
  clock.t = 2200;
  x.markInteraction();
  clock.t = 9000;
  x.markInteraction();
  x.end();
  assert.equal(x.__state().ttfi, 1200);
});

test('feature hover: below-threshold ignored; fires once per row; repeats accumulate feat_ms only', () => {
  const { events } = setup();
  const x = exposure();
  x.featureHover(1, 'storage', FEATURE_HOVER_MS - 1);   // too quick — not a read
  x.featureHover(1, 'storage', 640);
  x.featureHover(1, 'storage', 500);                    // re-read: no second event
  x.featureHover(4, 'events', 350);
  const hovers = events.filter((e) => e.name === 'up_feature_hover');
  assert.deepEqual(hovers.map((e) => [e.props.row, e.props.key, e.props.ms]), [[1, 'storage', 640], [4, 'events', 350]]);
  assert.equal(hovers[0].props.surface, 'modal', 'hover rows carry the envelope');
  x.end();
  const s = summaries(events)[0];
  assert.deepEqual(s.props.feat_rows, [1, 4], 'sorted indices');
  assert.equal(s.props.feat_ms, 640 + 500 + 350);
});

test('price/cta hesitation keep the max and respect the floor', () => {
  const { events } = setup();
  const x = exposure();
  x.priceHover(100);            // below floor
  x.priceHover(900);
  x.priceHover(400);
  x.ctaHover(350);
  x.end();
  const s = summaries(events)[0];
  assert.equal(s.props.price_hes_ms, 900);
  assert.equal(s.props.cta_hes_ms, 350);
});

test('plan toggles: seq string, count, cap at 10 hops, and timing return value', () => {
  const { events, clock } = setup({ t: 1000 });
  const x = exposure();
  clock.t = 3000;
  const r = x.planToggle('annual');
  assert.deepEqual(r, { seq_n: 1, t_ms: 2000 });
  x.planToggle('monthly');
  for (let i = 0; i < 12; i++) x.planToggle(i % 2 ? 'monthly' : 'annual');
  x.end();
  const s = summaries(events)[0];
  assert.equal(s.props.toggles_n, 14, 'count keeps going past the seq cap');
  assert.equal(s.props.toggle_seq.split('>').length, 11, 'initial + 10 capped hops');
  assert.ok(s.props.toggle_seq.startsWith('m>a>m'));
  assert.equal(s.props.plan_final, 'monthly', 'last toggle wins');
});

test('outcome: first wins; error after CTA stays outcome cta with error_seen', () => {
  const { events } = setup();
  const x = exposure();
  x.outcome('cta', { plan: 'annual' });
  x.noteError();
  x.outcome('dismiss', { method: 'x' });   // post-error close — must not overwrite
  x.end();
  const s = summaries(events)[0];
  assert.equal(s.props.outcome, 'cta');
  assert.equal(s.props.dismiss_method, null, 'non-dismiss outcomes carry no method');
  assert.equal(s.props.plan_final, 'annual');
  assert.equal(s.props.error_seen, true);
});

test('summary fires once, beacons, and contains every schema key even at zero', () => {
  const { events } = setup();
  const x = exposure();
  x.view();
  x.end(); x.end();
  const s = summaries(events);
  assert.equal(s.length, 1);
  assert.equal(s[0].beacon, true);
  const p = s[0].props;
  for (const k of [
    'surface', 'header', 'via', 'copy_rev', 'exposure_n', 'tier', 'cap_pct', 'demo_cards', 'acct_days',
    'outcome', 'dismiss_method', 'plan_final', 'toggles_n', 'toggle_seq', 'dwell_ms', 'ttfi_ms',
    'feat_rows', 'feat_ms', 'price_hes_ms', 'cta_hes_ms', 'rage_n', 'dead_n', 'error_seen',
  ]) assert.ok(k in p, `summary has ${k}`);
  assert.deepEqual(
    [p.outcome, p.dismiss_method, p.toggles_n, p.feat_ms, p.rage_n, p.dead_n, p.ttfi_ms],
    ['dismiss', 'nav', 0, 0, 0, 0, null],
    'terminal end without outcome = dismiss via nav; zeros present, never omitted',
  );
});

test('a tab-hide is non-terminal: summary fires once as hidden, tracking continues', () => {
  const { events } = setup();
  const x = exposure();
  x.view();
  x.end({ terminal: false });                     // tab hidden
  assert.equal(summaries(events)[0].props.outcome, 'hidden');
  x.featureHover(0, 'studio', 500);               // user came back and read on
  assert.equal(events.filter((e) => e.name === 'up_feature_hover').length, 1, 'post-return hovers still fire');
  x.end();                                        // unmount — terminal
  assert.equal(summaries(events).length, 1, 'summary never re-fires');
  x.featureHover(2, 'edit_access', 500);
  assert.equal(events.filter((e) => e.name === 'up_feature_hover').length, 1, 'terminal end stops tracking');
});

test('explicit dismiss records its method', () => {
  const { events } = setup();
  const x = exposure();
  x.outcome('dismiss', { method: 'esc' });
  x.end();
  const s = summaries(events)[0];
  assert.deepEqual([s.props.outcome, s.props.dismiss_method], ['dismiss', 'esc']);
});

test('clicks count rage/dead for the summary even with the trace unarmed', () => {
  const { events, clock } = setup({ t: 1000 });
  const x = exposure();
  x.click('img.upgrade-art', false);              // dead
  for (let i = 0; i < 4; i++) { x.click('button:Get Creator', true); clock.t += 100; }
  clock.t += 2000;
  x.click('button:Get Creator', true);            // slow click — no new rage
  x.end();
  const s = summaries(events)[0];
  assert.equal(s.props.dead_n, 1);
  assert.equal(s.props.rage_n, 1, 'one rage per burst');
  assert.equal(events.filter((e) => e.name === 'up_trace').length, 0, 'unarmed → no trace rows');
});

test('armed trace coalesces at 30 records, caps at 8 rows, and carries the envelope', () => {
  const { events, clock } = setup({ t: 1000 });
  const x = exposure();
  x.armTrace();
  for (let i = 0; i < 30; i++) { clock.t += 1100; x.click(`b${i}`, true); }   // spaced → no rage
  const rows = events.filter((e) => e.name === 'up_trace');
  assert.equal(rows.length, 1, 'auto-flush at 30 records');
  assert.equal(rows[0].props.n, 30);
  assert.equal(rows[0].props.surface, 'modal', 'trace rows carry the envelope');
  for (let row = 0; row < 12; row++) {
    for (let i = 0; i < 30; i++) { clock.t += 1100; x.click(`r${row}b${i}`, true); }
  }
  assert.equal(events.filter((e) => e.name === 'up_trace').length, 8, 'hard cap: 8 up_trace rows per exposure');
});

test('trace inputs are throttled to field identity only; no values ever recorded', () => {
  const { events, clock } = setup({ t: 1000 });
  const x = exposure();
  x.armTrace();
  x.traceInput('field:promo:text');
  clock.t += 100;
  x.traceInput('field:promo:text');               // inside the 600ms window → dropped
  clock.t += 600;
  x.traceInput('field:promo:text');
  x.outcome('cta');
  x.flushTrace(false);
  const recs = events.find((e) => e.name === 'up_trace').props.ev;
  assert.equal(recs.filter((r) => r.k === 'input').length, 2);
  assert.ok(recs.every((r) => !('value' in r) && !('key' in r)), 'identity only — never values');
  assert.ok(recs.some((r) => r.k === 'cta'), 'outcomes land in the trace timeline');
});

test('end() flushes the pending trace as a beacon and stops further recording', () => {
  const { events } = setup();
  const x = exposure();
  x.armTrace();
  x.click('button:Get Creator', true);
  x.end();
  const trace = events.find((e) => e.name === 'up_trace');
  assert.equal(trace.beacon, true);
  x.click('button:Get Creator', true);
  x.flushTrace(false);
  assert.equal(events.filter((e) => e.name === 'up_trace').length, 1, 'nothing recorded after end');
});

test('StrictMode seam: an ended exposure reports ended so the hook can renew', () => {
  setup();
  const x = exposure();
  x.view();
  x.end();
  assert.equal(x.__state().ended, true);
  const fresh = exposure();
  assert.equal(fresh.__state().ended, false);
  assert.equal(fresh.__state().summaryFired, false);
});
