// appTrace.test.mjs — plain-node unit tests for the established-user trace.
//
//   node --test src/lib/appTrace.test.mjs
//
// Emitter + dead-click seams are INJECTED (same discipline as journey.js), so
// the caps, the drop rule and the PII contract are all testable without a DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setAppTraceSink, armAppTrace, disarmAppTrace, isAppTraceArmed,
  flushTrace, traceClick, traceKey, traceRoute, __resetForTest, __TUNABLES,
} from './appTrace.js';

const describe = (el) => (el && el.id ? '#' + el.id : (el && el.tagName ? el.tagName.toLowerCase() : 'unknown'));
const inert  = { nodeType: 1, tagName: 'DIV', id: 'canvas', getAttribute: () => null, parentElement: null };
const button = { nodeType: 1, tagName: 'BUTTON', id: 'save', getAttribute: () => null, parentElement: null };

function setup({ fingerprint = 'idle' } = {}) {
  __resetForTest();
  const events = [];
  const clock = { t: 5000 };
  const pending = [];
  const fp = { value: fingerprint };
  setAppTraceSink({
    logEvent:    (name, props) => events.push({ name, props, beacon: false }),
    logEventNow: (name, props) => events.push({ name, props, beacon: true }),
    now: () => clock.t,
    probe: () => fp.value,
    schedule: (fn) => pending.push(fn),
  });
  return { events, clock, fp, settle: () => { while (pending.length) pending.shift()(); } };
}

const recordsOf = (events) => events.filter((e) => e.name === 'app_trace').flatMap((e) => e.props.ev);

test('nothing is recorded until armed', () => {
  const { events, settle } = setup();
  assert.equal(isAppTraceArmed(), false);
  traceClick(inert, describe);
  traceKey('z', 'M-');
  settle();
  flushTrace(false);
  assert.equal(events.length, 0);
});

test('a dead click is recorded; a click the app answered is not', () => {
  const { events, fp, settle } = setup();
  armAppTrace();

  traceClick(inert, describe);          // nothing changes → dead
  settle();
  traceClick(inert, describe);
  fp.value = 'something moved';          // the app reacted → not evidence
  settle();
  flushTrace(false);

  const recs = recordsOf(events);
  assert.equal(recs.length, 1, 'only the dead one is kept');
  assert.equal(recs[0].k, 'dead');
  assert.equal(recs[0].tgt, '#canvas');
});

test('plain clicks on working controls are dropped, keeping long sessions quiet', () => {
  const { events, clock, settle } = setup();
  armAppTrace();
  // Advance past the rage window between clicks — this is someone working
  // steadily, not hammering one control.
  for (let i = 0; i < 50; i++) { traceClick(button, describe); clock.t += 1001; }
  settle();
  flushTrace(false);
  assert.equal(events.length, 0, 'a productive session emits nothing at all');
});

test('a rage burst is recorded even on an interactive control', () => {
  const { events, settle } = setup();
  armAppTrace();
  traceClick(button, describe);
  traceClick(button, describe);
  traceClick(button, describe);          // tips into rage
  settle();
  flushTrace(false);

  const recs = recordsOf(events);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].k, 'rage');
  assert.equal(recs[0].n, 3);
});

test('only modifier commands are recorded, and they are throttled', () => {
  const { events, clock } = setup();
  armAppTrace();
  traceKey('z', 'M-');
  traceKey('k', 'M-');                   // inside the throttle window → dropped
  clock.t += 1000;
  traceKey('k', 'M-');
  flushTrace(false);

  const recs = recordsOf(events);
  assert.deepEqual(recs.map((r) => r.key), ['M-z', 'M-k']);
  assert.ok(recs.every((r) => !('tgt' in r)), 'keys never carry a target');
});

test('route records dedupe against the current path', () => {
  const { events } = setup();
  armAppTrace();
  traceRoute('/a');
  traceRoute('/a');                      // same path — not a navigation
  traceRoute('/b');
  flushTrace(false);
  assert.deepEqual(recordsOf(events).map((r) => r.to), ['/a', '/b']);
});

test('rows are hard-capped per pageload so a long session cannot flood', () => {
  const { events, settle } = setup();
  armAppTrace();
  for (let i = 0; i < __TUNABLES.TRACE_MAX_ROWS + 8; i++) {
    traceClick(inert, describe);
    settle();
    flushTrace(false);                   // force one row per click
  }
  assert.equal(events.length, __TUNABLES.TRACE_MAX_ROWS, 'capped, not unbounded');
});

test('records batch into one row rather than one row per interaction', () => {
  const { events, clock, settle } = setup();
  armAppTrace();
  // Spaced out, so these are five separate dead clicks and not one rage burst.
  for (let i = 0; i < 5; i++) { traceClick(inert, describe); settle(); clock.t += 1001; }
  flushTrace(false);
  assert.equal(events.length, 1, 'coalesced');
  assert.equal(events[0].props.n, 5);
  assert.equal(events[0].props.ev.length, 5);
});

test('disarm beacons whatever is buffered', () => {
  const { events, settle } = setup();
  armAppTrace();
  traceClick(inert, describe);
  settle();
  disarmAppTrace();
  assert.equal(events.length, 1);
  assert.equal(events[0].beacon, true, 'sent via the keepalive path');
  assert.equal(isAppTraceArmed(), false);
});

test('re-arming starts a clean budget and a clean rage burst', () => {
  const { events, settle } = setup();
  armAppTrace();
  traceClick(button, describe);
  traceClick(button, describe);          // two of the three needed for rage
  settle();
  disarmAppTrace();
  events.length = 0;

  armAppTrace();
  traceClick(button, describe);          // must NOT complete the old burst
  settle();
  flushTrace(false);
  assert.equal(events.length, 0, 'a burst never spans two arms');
});
