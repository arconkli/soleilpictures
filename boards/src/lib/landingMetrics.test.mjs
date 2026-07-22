// landingMetrics.test.mjs — plain-node unit tests for the landing engagement core.
//
//   node --test src/lib/landingMetrics.test.mjs
//
// landingMetrics.js is deliberately node-importable (its emitter is INJECTED via
// setLandingSink, not statically imported from analytics.js) so the threshold /
// dwell / trace-coalescing / PII-safety logic is testable without a browser —
// the same discipline as journey.test.mjs. The DOM layer (useLandingEngagement)
// is exercised by the Playwright spec instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setLandingSink, createLandingTracker, isInteractiveTarget, lpCtaClick,
} from './landingMetrics.js';

function setup({ t = 1000 } = {}) {
  const events = [];
  const clock = { t };
  setLandingSink({
    logEvent:    (name, props) => events.push({ name, props, beacon: false }),
    logEventNow: (name, props) => events.push({ name, props, beacon: true }),
    now: () => clock.t,
  });
  return { events, clock };
}

function tracker(opts = {}) {
  return createLandingTracker({ page: '/tools/mood-board-maker', pageKind: 'tool', ...opts });
}

// Minimal fake DOM node for the dead-click classifier (no jsdom needed).
function el(tag, attrs = {}, parent = null) {
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    parentElement: parent,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
  };
}

test('view fires lp_view once with the {page, page_kind} base', () => {
  const { events } = setup();
  const t = tracker();
  t.view(); t.view();
  const views = events.filter((e) => e.name === 'lp_view');
  assert.equal(views.length, 1);
  assert.equal(views[0].props.page, '/tools/mood-board-maker');
  assert.equal(views[0].props.page_kind, 'tool');
});

test('scroll thresholds fire once each and track max depth', () => {
  const { events } = setup();
  const t = tracker();
  t.reportProgress(0.3);
  t.reportProgress(0.3);           // re-crossing fires nothing new
  t.reportProgress(0.8);
  const depths = events.filter((e) => e.name === 'lp_scroll').map((e) => e.props.depth);
  assert.deepEqual(depths, [0.1, 0.25, 0.5, 0.75]);
  t.end();
  const dwell = events.find((e) => e.name === 'lp_dwell');
  assert.equal(dwell.props.max_depth, 0.8);
});

test('legacy mapping mirrors landing_scroll/landing_dwell with their exact historical shapes', () => {
  const { events, clock } = setup({ t: 1000 });
  const t = tracker({ page: '/', pageKind: 'home', legacy: { scroll: 'landing_scroll', dwell: 'landing_dwell' } });
  t.reportProgress(0.26);
  clock.t = 6400;
  t.end();
  const ls = events.filter((e) => e.name === 'landing_scroll');
  assert.deepEqual(ls.map((e) => e.props), [{ depth: 0.1 }, { depth: 0.25 }]);   // no page/page_kind — byte-identical legacy shape
  const lp = events.filter((e) => e.name === 'lp_scroll').map((e) => e.props.depth);
  assert.deepEqual(lp, [0.1, 0.25], 'lp_scroll fires the same depths');
  const ld = events.find((e) => e.name === 'landing_dwell');
  assert.deepEqual(ld.props, { ms: 5400, max_depth: 0.26 });
  const lpd = events.find((e) => e.name === 'lp_dwell');
  assert.equal(lpd.props.ms, 5400);
});

test('dwell fires once (second end is a no-op) and beacons', () => {
  const { events } = setup();
  const t = tracker();
  t.end(); t.end();
  const dwells = events.filter((e) => e.name === 'lp_dwell');
  assert.equal(dwells.length, 1);
  assert.equal(dwells[0].beacon, true);
  assert.equal(dwells[0].props.max_depth, 0, 'a genuine bounce records max_depth 0, never null');
});

test('a tab-hide is non-terminal: dwell fires once but tracking continues', () => {
  const { events } = setup();
  const t = tracker();
  t.reportProgress(0.3);
  t.end({ terminal: false });                    // tab hidden
  assert.equal(events.filter((e) => e.name === 'lp_dwell').length, 1);
  t.reportProgress(0.8);                         // visitor came back and read on
  const depths = events.filter((e) => e.name === 'lp_scroll').map((e) => e.props.depth);
  assert.deepEqual(depths, [0.1, 0.25, 0.5, 0.75], 'post-return depths still fire (legacy parity)');
  t.end();                                       // pagehide — terminal
  assert.equal(events.filter((e) => e.name === 'lp_dwell').length, 1, 'dwell never re-fires');
  t.reportProgress(1);
  assert.equal(events.filter((e) => e.name === 'lp_scroll').length, 4, 'terminal end stops tracking');
});

test('markFullyVisible records depth 1 without firing threshold events', () => {
  const { events } = setup();
  const t = tracker();
  t.markFullyVisible();
  t.end();
  assert.equal(events.filter((e) => e.name === 'lp_scroll').length, 0);
  assert.equal(events.find((e) => e.name === 'lp_dwell').props.max_depth, 1);
});

test('ctaClick beacons with signup intent by default; nav intent overrides', () => {
  const { events } = setup();
  const t = tracker();
  t.ctaClick('hero', '/');
  t.ctaClick('explore_more', '/explore', { intent: 'nav' });
  const ctas = events.filter((e) => e.name === 'lp_cta_click');
  assert.equal(ctas.length, 2);
  assert.equal(ctas[0].beacon, true);
  assert.deepEqual([ctas[0].props.pos, ctas[0].props.intent], ['hero', 'signup']);
  assert.deepEqual([ctas[1].props.pos, ctas[1].props.intent], ['explore_more', 'nav']);
});

test('faq opens fire once per item', () => {
  const { events } = setup();
  const t = tracker();
  t.faqOpen(0, 'Is it free?');
  t.faqOpen(0, 'Is it free?');   // toggle-happy — no second row
  t.faqOpen(2, 'Does it export?');
  const faqs = events.filter((e) => e.name === 'lp_faq');
  assert.deepEqual(faqs.map((e) => e.props.idx), [0, 2]);
});

test("manual-mode trace scroll records are change-gated, not just time-throttled", () => {
  const { events, clock } = setup({ t: 1000 });
  const t = tracker();
  t.armTrace();
  // '/' feeds progress every frame: same p forever must not fill the trace.
  for (let i = 0; i < 20; i++) { clock.t += 400; t.reportProgress(0.5); }
  t.flushTrace(false);
  const recs = events.filter((e) => e.name === 'lp_trace').flatMap((e) => e.props.ev);
  assert.equal(recs.filter((r) => r.k === 'scroll').length, 1, 'unchanged p records once');
  clock.t += 400;
  t.reportProgress(0.9);
  t.flushTrace(false);
  const recs2 = events.filter((e) => e.name === 'lp_trace').flatMap((e) => e.props.ev);
  assert.equal(recs2.filter((r) => r.k === 'scroll').length, 2, 'a real move records again');
});

test('sections fire once per id with their ordinal', () => {
  const { events, clock } = setup({ t: 1000 });
  const t = tracker();
  clock.t = 3000;
  t.sectionSeen('hero', 0);
  t.sectionSeen('hero', 0);
  t.sectionSeen('s0-canvas', 2);
  const secs = events.filter((e) => e.name === 'lp_section');
  assert.deepEqual(secs.map((e) => [e.props.section, e.props.idx, e.props.t_ms]),
    [['hero', 0, 2000], ['s0-canvas', 2, 2000]]);
});

test('trace stays silent until armed; armed clicks classify dead vs interactive', () => {
  const { events } = setup();
  const t = tracker();
  t.traceClick('a:Start free', true);
  t.flushTrace(false);
  assert.equal(events.filter((e) => e.name === 'lp_trace').length, 0, 'unarmed → nothing buffered');

  t.armTrace();
  t.traceClick('a:Start free', true);
  t.traceClick('img.seo-frame-shot', false);
  t.flushTrace(false);
  const trace = events.find((e) => e.name === 'lp_trace');
  assert.equal(trace.props.n, 2);
  assert.deepEqual(trace.props.ev.map((r) => r.k), ['click', 'dead']);
  assert.equal(trace.props.page, '/tools/mood-board-maker', 'trace rows carry the base');
});

test('rage fires once per burst at 3 clicks inside 1s on the same target', () => {
  const { events, clock } = setup({ t: 1000 });
  const t = tracker();
  t.armTrace();
  for (let i = 0; i < 4; i++) { t.traceClick('button:Join', true); clock.t += 100; }
  clock.t += 2000;                              // burst over
  t.traceClick('button:Join', true);            // slow click — no new rage
  t.flushTrace(false);
  const recs = events.find((e) => e.name === 'lp_trace').props.ev;
  const rages = recs.filter((r) => r.k === 'rage');
  assert.equal(rages.length, 1, 'one rage per burst');
  assert.equal(rages[0].tgt, 'button:Join');
  assert.ok(rages[0].n >= 3);
});

test('input records are throttled to field identity only', () => {
  const { events, clock } = setup({ t: 1000 });
  const t = tracker();
  t.armTrace();
  t.traceInput('field:email:email');
  clock.t += 100;
  t.traceInput('field:email:email');            // inside the 600ms window → dropped
  clock.t += 600;
  t.traceInput('field:email:email');
  t.flushTrace(false);
  const recs = events.find((e) => e.name === 'lp_trace').props.ev;
  assert.equal(recs.filter((r) => r.k === 'input').length, 2);
  assert.ok(recs.every((r) => !('value' in r) && !('key' in r)), 'identity only — never values');
});

test('hover hesitation respects the 300ms floor', () => {
  const { events } = setup();
  const t = tracker();
  t.armTrace();
  t.traceHover('hero', 120);                    // too quick — not hesitation
  t.traceHover('hero', 900);
  t.flushTrace(false);
  const recs = events.find((e) => e.name === 'lp_trace').props.ev;
  assert.deepEqual(recs.map((r) => [r.k, r.tgt, r.ms]), [['hes', 'hero', 900]]);
});

test('the buffer coalesces at 30 records and the pageload stops at 20 trace rows', () => {
  const { events, clock } = setup({ t: 1000 });
  const t = tracker();
  t.armTrace();
  for (let i = 0; i < 30; i++) { clock.t += 1100; t.traceClick(`b${i}`, true); }   // spaced → no rage
  assert.equal(events.filter((e) => e.name === 'lp_trace').length, 1, 'auto-flush at 30 records');
  assert.equal(events[0].props.n, 30);

  for (let row = 0; row < 30; row++) {
    for (let i = 0; i < 30; i++) { clock.t += 1100; t.traceClick(`r${row}b${i}`, true); }
  }
  const rows = events.filter((e) => e.name === 'lp_trace');
  assert.equal(rows.length, 20, 'hard cap: 20 lp_trace rows per pageload');
});

test('end() flushes the pending trace as a beacon and stops further recording', () => {
  const { events } = setup();
  const t = tracker();
  t.armTrace();
  t.traceClick('a:Start free', true);
  t.end();
  const trace = events.find((e) => e.name === 'lp_trace');
  assert.equal(trace.beacon, true);
  t.traceClick('a:Start free', true);
  t.flushTrace(false);
  assert.equal(events.filter((e) => e.name === 'lp_trace').length, 1, 'nothing recorded after end');
});

test('isInteractiveTarget walks ≤4 ancestors for interactive tags, roles and lp-cta markers', () => {
  const body = el('body');
  assert.equal(isInteractiveTarget(el('a', {}, body)), true);
  assert.equal(isInteractiveTarget(el('span', {}, el('button', {}, body))), true);
  assert.equal(isInteractiveTarget(el('span', { role: 'button' }, body)), true);
  assert.equal(isInteractiveTarget(el('span', { 'data-lp-cta': 'hero' }, body)), true);
  assert.equal(isInteractiveTarget(el('img', {}, el('figure', {}, body))), false, 'inert chain = dead click');
  // 5 hops up to the <a> — beyond the walk → treated as dead.
  const deep = el('i', {}, el('i', {}, el('i', {}, el('i', {}, el('a', {}, body)))));
  assert.equal(isInteractiveTarget(deep), false);
});

test('lpCtaClick standalone emits a beaconed lp_cta_click with the base', () => {
  const { events } = setup();
  lpCtaClick('/', 'home', 'form');
  const e = events.find((x) => x.name === 'lp_cta_click');
  assert.equal(e.beacon, true);
  assert.deepEqual(
    [e.props.page, e.props.page_kind, e.props.pos, e.props.intent],
    ['/', 'home', 'form', 'signup'],
  );
});
