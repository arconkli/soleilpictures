// interactionClassify.test.mjs — plain-node unit tests for the shared
// dead-click / rage-click core.
//
//   node --test src/lib/interactionClassify.test.mjs
//
// The module is pure and DOM-guarded (same discipline as journey.js and
// frictionSignal.js), so the classifiers are driven here with duck-typed
// elements and an injected clock/scheduler — no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isInteractiveTarget, createRageDetector, createDeadClickWatcher,
  domActivityFingerprint, RAGE_MIN_CLICKS, RAGE_WINDOW_MS,
} from './interactionClassify.js';

// Minimal element stand-in: only what the classifiers actually read.
function el(tag, { attrs = {}, parent = null } = {}) {
  return {
    nodeType: 1,
    tagName: tag,
    parentElement: parent,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
  };
}

test('isInteractiveTarget recognises native controls', () => {
  for (const tag of ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY', 'LABEL']) {
    assert.equal(isInteractiveTarget(el(tag)), true, `${tag} is interactive`);
  }
  assert.equal(isInteractiveTarget(el('DIV')), false);
  assert.equal(isInteractiveTarget(el('SPAN')), false);
});

test('isInteractiveTarget honours role=button and the landing CTA marker', () => {
  assert.equal(isInteractiveTarget(el('DIV', { attrs: { role: 'button' } })), true);
  assert.equal(isInteractiveTarget(el('DIV', { attrs: { 'data-lp-cta': '' } })), true);
});

test('isInteractiveTarget walks up to four ancestors, and no further', () => {
  // span → div → div → button  (button is the 4th node inspected)
  const button = el('BUTTON');
  const d2 = el('DIV', { parent: button });
  const d1 = el('DIV', { parent: d2 });
  const span = el('SPAN', { parent: d1 });
  assert.equal(isInteractiveTarget(span), true, 'reachable within 4 hops');

  // One hop further out is out of range — a deeply buried control reads inert.
  const d3 = el('DIV', { parent: el('DIV', { parent: el('DIV', { parent: el('DIV', { parent: el('BUTTON') }) }) }) });
  assert.equal(isInteractiveTarget(d3), false, 'beyond 4 hops is not credited');
});

test('isInteractiveTarget never throws on junk input', () => {
  assert.equal(isInteractiveTarget(null), false);
  assert.equal(isInteractiveTarget(undefined), false);
  assert.equal(isInteractiveTarget({}), false);
  assert.equal(isInteractiveTarget({ nodeType: 3, parentElement: null }), false);
});

test('rage fires once per burst, at the threshold click', () => {
  let t = 0;
  const rage = createRageDetector(() => t);
  assert.equal(rage('a'), 0, '1st click');
  assert.equal(rage('a'), 0, '2nd click');
  assert.equal(rage('a'), RAGE_MIN_CLICKS, '3rd click tips it');
  assert.equal(rage('a'), 0, '4th click in the same burst stays quiet');
});

test('rage resets when the target changes', () => {
  let t = 0;
  const rage = createRageDetector(() => t);
  rage('a'); rage('a');
  assert.equal(rage('b'), 0, 'different target starts a new burst');
  assert.equal(rage('b'), 0);
  assert.equal(rage('b'), RAGE_MIN_CLICKS, 'and tips on its own third click');
});

test('clicks spread beyond the rage window are not rage', () => {
  let t = 0;
  const rage = createRageDetector(() => t);
  for (let i = 0; i < 6; i++) {
    assert.equal(rage('a'), 0, `click ${i + 1} is patient, not enraged`);
    t += RAGE_WINDOW_MS + 1;
  }
});

test('a burst that lapses can fire again', () => {
  let t = 0;
  const rage = createRageDetector(() => t);
  rage('a'); rage('a');
  assert.equal(rage('a'), RAGE_MIN_CLICKS, 'first burst');
  t += RAGE_WINDOW_MS + 1;                       // window lapses
  rage('a'); rage('a');
  assert.equal(rage('a'), RAGE_MIN_CLICKS, 'a second genuine burst is reported');
});

test('dead watcher calls a click dead only when nothing changed', () => {
  let fingerprint = 'same';
  const pending = [];
  const judge = createDeadClickWatcher({
    probe: () => fingerprint,
    schedule: (fn) => pending.push(fn),
  });

  let verdict = null;
  judge((k) => { verdict = k; });
  assert.equal(verdict, null, 'no verdict until the settle window elapses');
  pending.shift()();
  assert.equal(verdict, 'dead', 'unchanged fingerprint → dead');

  verdict = null;
  judge((k) => { verdict = k; });
  fingerprint = 'changed';                        // the app reacted
  pending.shift()();
  assert.equal(verdict, 'click', 'changed fingerprint → a real click');
});

test('dead watcher refuses to guess when it has no fingerprint', () => {
  // A false 'dead' sends us chasing a bug that does not exist, so no evidence
  // must mean "plain click", never "dead".
  const pending = [];
  const judge = createDeadClickWatcher({ probe: () => null, schedule: (fn) => pending.push(fn) });
  let verdict = null;
  judge((k) => { verdict = k; });
  assert.equal(verdict, 'click', 'verdict is immediate and non-committal');
  assert.equal(pending.length, 0, 'and nothing was scheduled');

  // Same when the probe throws outright.
  const judge2 = createDeadClickWatcher({ probe: () => { throw new Error('boom'); }, schedule: (fn) => pending.push(fn) });
  let v2 = null;
  judge2((k) => { v2 = k; });
  assert.equal(v2, 'click');
});

test('dead watcher treats a probe that goes blind mid-flight as a click', () => {
  let fp = 'a';
  const pending = [];
  const judge = createDeadClickWatcher({ probe: () => fp, schedule: (fn) => pending.push(fn) });
  let verdict = null;
  judge((k) => { verdict = k; });
  fp = null;                                       // DOM torn down before the re-read
  pending.shift()();
  assert.equal(verdict, 'click', 'missing after-sample is not evidence of deadness');
});

test('domActivityFingerprint returns null without a DOM instead of throwing', () => {
  assert.equal(typeof document, 'undefined', 'precondition: plain node, no DOM');
  assert.equal(domActivityFingerprint(), null);
});
