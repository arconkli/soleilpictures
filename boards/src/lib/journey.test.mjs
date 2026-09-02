// journey.test.mjs — plain-node unit tests for the post-signup journey core.
//
//   node --test src/lib/journey.test.mjs
//
// journey.js is deliberately node-importable (its emitter is INJECTED via
// setJourneySink, not statically imported from analytics.js) so the envelope /
// sequencing / coalescing / PII-safety logic is testable without a browser — the
// same discipline as frictionSignal.test.mjs. window/document are absent in node,
// so beginJourney won't start the heartbeat/firehose timers or bind DOM listeners;
// we drive the pure paths directly (recordInteraction, __heartbeatTick).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setJourneySink, beginJourney, endJourney, setJourneyState, journey,
  recordInteraction, recordClick, isJourneyOpen, describeTarget,
  __heartbeatTick, __resetForTest, __flushTraceForTest as flushTraceForTest,
} from './journey.js';

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

// Fresh module + storage + capturing sink per test (unless we deliberately keep
// storage to simulate a reload).
function setup({ keepStorage = false, t = 1000 } = {}) {
  if (!keepStorage) globalThis.localStorage = makeStorage();
  __resetForTest();
  const events = [];
  const clock = { t };
  setJourneySink({
    logEvent:    (name, props) => events.push({ name, props, beacon: false }),
    logEventNow: (name, props) => events.push({ name, props, beacon: true }),
    now: () => clock.t,
  });
  return { events, clock };
}

test('beginJourney is idempotent and emits ps_signup exactly once', () => {
  const { events } = setup();
  const jid1 = beginJourney('u1', { isNew: true, tier: 'demo' });
  const jid2 = beginJourney('u1', { isNew: true, tier: 'demo' });
  assert.ok(jid1, 'minted a jid');
  assert.equal(jid1, jid2, 'second call returns the same jid (no re-mint)');
  const signups = events.filter((e) => e.name === 'ps_signup');
  assert.equal(signups.length, 1, 'ps_signup fires once');
  assert.equal(signups[0].props.is_new, true);
  assert.equal(signups[0].props.tier, 'demo');
  assert.equal(signups[0].props.jid, jid1);
  assert.equal(signups[0].props.phase, 'signup');
});

test('beginJourney no-ops for non-new users and for already-done users', () => {
  setup();
  assert.equal(beginJourney('u2', { isNew: false }), null, 'not new → no journey');
  assert.equal(isJourneyOpen(), false);

  beginJourney('u3', { isNew: true });
  assert.equal(isJourneyOpen(), true);
  endJourney('activated');
  assert.equal(isJourneyOpen(), false);
  __resetForTest();                       // simulate a reload; the done stamp persists in storage
  assert.equal(beginJourney('u3', { isNew: true }), null, 'done stamp blocks reopen');
});

test('seq is monotonic across a simulated reload', () => {
  const { events } = setup({ t: 1000 });
  beginJourney('u4', { isNew: true });    // ps_signup → seq 1
  journey('ps_app_enter', {});            // seq 2
  const seqA = events.at(-1).props.seq;
  assert.equal(seqA, 2);

  // Reload: in-memory state resets, but storage (seq high-water + signup stamp) persists.
  __resetForTest();
  const events2 = [];
  setJourneySink({
    logEvent: (n, p) => events2.push({ name: n, props: p }),
    logEventNow: (n, p) => events2.push({ name: n, props: p }),
    now: () => 2000,
  });
  beginJourney('u4', { isNew: true });    // signup already stamped → does NOT re-fire
  journey('ps_heartbeat', {});
  const seqB = events2.at(-1).props.seq;
  assert.ok(seqB > seqA, `seq continued across reload: ${seqB} > ${seqA}`);
  assert.equal(events2.filter((e) => e.name === 'ps_signup').length, 0, 'no duplicate signup after reload');
});

// Regression: a run of phantom ps_signup rows once landed in analytics — one per
// pageload, each with a fresh jid, none with an authenticated user. The stamp that
// makes the anchor once-per-uid lives in localStorage, and the write silently
// swallowed its error, so in a context where storage is unavailable the "exactly
// once" guarantee degraded to "every single load" with no signal at all. Refusing
// to emit is the right trade: a missed signup is recoverable from auth.users, a
// fabricated one is indistinguishable from a real one forever after.
test('ps_signup is suppressed when the dedupe stamp cannot be persisted', () => {
  const { events } = setup();
  // Storage that reads back nothing and rejects writes (Safari private mode, quota).
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => {},
  };
  __resetForTest();

  const jid = beginJourney('u-nostore', { isNew: true, tier: 'demo' });
  assert.ok(jid, 'the journey still opens — in-session telemetry is unaffected');
  assert.equal(isJourneyOpen(), true);
  assert.equal(
    events.filter((e) => e.name === 'ps_signup').length, 0,
    'no anchor emitted when the once-only stamp cannot be written',
  );

  // And it must not creep back on the next pageload either.
  __resetForTest();
  beginJourney('u-nostore', { isNew: true, tier: 'demo' });
  assert.equal(
    events.filter((e) => e.name === 'ps_signup').length, 0,
    'still no anchor after a reload — this is the unbounded-counter case',
  );
});

test('journey() is a no-op when no journey is open', () => {
  const { events } = setup();
  journey('ps_heartbeat', { idle_ms: 5 });
  assert.equal(events.length, 0);
});

test('setJourneyState tracks from_phase across a phase change', () => {
  const { events } = setup();
  beginJourney('u5', { isNew: true });    // phase defaults to 'signup'
  setJourneyState({ phase: 'app_enter' });
  journey('ps_app_enter', {});
  const e = events.at(-1);
  assert.equal(e.props.phase, 'app_enter');
  assert.equal(e.props.from_phase, 'signup');
});

test('the firehose coalesces records into a single ps_trace at the cap', () => {
  const { events } = setup();
  beginJourney('u6', { isNew: true });
  events.length = 0;                      // drop the ps_signup
  for (let i = 0; i < 30; i++) recordInteraction('click', 'button:Add');
  const traces = events.filter((e) => e.name === 'ps_trace');
  assert.equal(traces.length, 1, 'one coalesced ps_trace, not 30 rows');
  assert.equal(traces[0].props.n, 30);
  assert.equal(traces[0].props.ev.length, 30);
  assert.equal(traces[0].props.ev[0].k, 'click');
  assert.equal(traces[0].props.ev[0].tgt, 'button:Add');
});

// ── Click classification ──────────────────────────────────────────────────────
// ps_trace used to record every in-app click as a plain 'click', which is why
// every dead- and rage-click finding came from the public pages while the
// canvas reported nothing. These pin the behaviour that closed that gap.

// setup() plus injected classifier seams: a fingerprint the test controls and a
// scheduler it drains by hand, so the verdict is deterministic and needs no DOM.
function setupClicks({ t = 1000 } = {}) {
  const s = setup({ t });
  const fp = { value: 'idle' };
  const pending = [];
  setJourneySink({
    logEvent:    (name, props) => s.events.push({ name, props, beacon: false }),
    logEventNow: (name, props) => s.events.push({ name, props, beacon: true }),
    now: () => s.clock.t,
    probe: () => fp.value,
    schedule: (fn) => pending.push(fn),
  });
  return { ...s, fp, settle: () => { while (pending.length) pending.shift()(); } };
}

const inertDiv = { nodeType: 1, tagName: 'DIV', id: 'canvas', getAttribute: () => null, parentElement: null };
const realButton = { nodeType: 1, tagName: 'BUTTON', id: '', getAttribute: () => null, textContent: 'Add note', parentElement: null };

test('a click that changes nothing is recorded dead, stamped at the click', () => {
  const { events, clock, fp, settle } = setupClicks();
  beginJourney('u10', { isNew: true });
  events.length = 0;

  recordClick(inertDiv);
  clock.t += 500;                          // the verdict lands later than the click
  settle();                                // fingerprint never moved
  flushTraceForTest();

  const ev = events.filter((e) => e.name === 'ps_trace')[0].props.ev;
  assert.equal(ev.length, 1);
  assert.equal(ev[0].k, 'dead', 'inert target + no app change → dead');
  assert.equal(ev[0].tgt, '#canvas');
  // t is ms since T0, and T0 is the clock at beginJourney — so the click is 0
  // even though the verdict was handed down 500ms later.
  assert.equal(ev[0].t, 0, 'stamped with the click, not the late verdict');
});

test('a click the app responded to is a plain click, however inert the element', () => {
  const { events, fp, settle } = setupClicks();
  beginJourney('u11', { isNew: true });
  events.length = 0;

  recordClick(inertDiv);                   // a <div> with a React handler — the canvas norm
  fp.value = 'selection changed';
  settle();
  flushTraceForTest();

  const ev = events.filter((e) => e.name === 'ps_trace')[0].props.ev;
  assert.equal(ev[0].k, 'click', 'outcome beats DOM shape — no false dead click');
});

test('a native control is a click immediately, without waiting to settle', () => {
  const { events, settle } = setupClicks();
  beginJourney('u12', { isNew: true });
  events.length = 0;

  recordClick(realButton);
  flushTraceForTest();                     // deliberately BEFORE settle()
  const ev = events.filter((e) => e.name === 'ps_trace')[0].props.ev;
  assert.equal(ev[0].k, 'click');
  assert.equal(ev[0].tgt, 'button:Add note');
  settle();
});

test('three fast clicks on one target add a rage record', () => {
  const { events, settle } = setupClicks();
  beginJourney('u13', { isNew: true });
  events.length = 0;

  recordClick(inertDiv);
  recordClick(inertDiv);
  recordClick(inertDiv);
  settle();
  flushTraceForTest();

  const ev = events.filter((e) => e.name === 'ps_trace')[0].props.ev;
  const rage = ev.filter((r) => r.k === 'rage');
  assert.equal(rage.length, 1, 'one rage record per burst, not one per click');
  assert.equal(rage[0].n, 3);
  assert.equal(ev.filter((r) => r.k === 'dead').length, 3, 'each click still recorded');
});

test('clicks are ignored entirely when no journey is open', () => {
  const { events, settle } = setupClicks();
  recordClick(inertDiv);
  settle();
  assert.equal(events.length, 0, 'no journey → no trace');
});

test('describeTarget never leaks input values or typed characters', () => {
  const input = {
    nodeType: 1, tagName: 'INPUT', id: 'email', value: 'secret@example.com',
    getAttribute: (k) => ({ type: 'email', name: 'email' }[k] ?? null),
    parentElement: null,
  };
  const d = describeTarget(input);
  assert.equal(d, 'field:email:email', 'field identity only');
  assert.ok(!d.includes('secret'), 'never includes the value');

  const btn = { nodeType: 1, tagName: 'BUTTON', id: '', getAttribute: () => null, textContent: '  Add card  ', parentElement: null };
  assert.equal(describeTarget(btn), 'button:Add card', 'button label (UI chrome) is allowed');
});

test('heartbeat stops emitting at the beat cap', () => {
  const { events } = setup();
  beginJourney('u7', { isNew: true });
  events.length = 0;
  for (let i = 0; i < 50; i++) __heartbeatTick();
  const hb = events.filter((e) => e.name === 'ps_heartbeat');
  assert.equal(hb.length, 40, 'capped at HB_MAX_BEATS');
  assert.equal(hb[0].props.beat, 0);
  assert.equal(hb[39].props.beat, 39);
});

test('endJourney beacons ps_end and stops the journey', () => {
  const { events } = setup();
  beginJourney('u8', { isNew: true });
  events.length = 0;
  endJourney('activated');
  const ends = events.filter((e) => e.name === 'ps_end');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].beacon, true, 'ps_end is beaconed');
  assert.equal(ends[0].props.reason, 'activated');
  assert.equal(isJourneyOpen(), false);
  journey('ps_heartbeat', {});            // post-end events are inert
  assert.equal(events.filter((e) => e.name === 'ps_heartbeat').length, 0);
});
