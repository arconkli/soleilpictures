// adminIssues.test.mjs — the Issues view's words and its trail.
//
//   node --test src/lib/adminIssues.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ISSUE_LENSES, kindLabel, sourceLabel, failureLabel, crumbText, beforeText, offsetText,
  contextChips, eventSummary, trailItems, issueText, breakingOutcome,
} from './adminIssues.js';

test('labels read as words, and anything unnamed still reads', () => {
  assert.equal(kindLabel('render'), 'Crash screen');
  assert.equal(kindLabel('yboard-snapshot-load'), 'Yboard snapshot load');
  assert.equal(kindLabel(null), 'Error');
  assert.equal(sourceLabel('edge'), 'Edge function');
  assert.equal(sourceLabel(undefined), 'Browser');
  assert.equal(failureLabel('otp_verify_error'), 'Sign-in code');
  assert.equal(failureLabel('some_new_thing_failed'), 'Some new thing');
  assert.equal(new Set(ISSUE_LENSES.map((l) => l.id)).size, ISSUE_LENSES.length);
  // 0581's dry-run outcomes, said as what happens.
  assert.equal(breakingOutcome('would email'), 'emails within 5 minutes');
  assert.match(breakingOutcome('would record: 6 emails today'), /not emailed/);
  assert.equal(breakingOutcome('emailed in the last 6 hours'), 'emailed in the last 6 hours');
});

test('a step reads as what happened, with when', () => {
  assert.equal(crumbText({ t: 1200, k: 'nav', n: '/b/:id' }), 'Went to /b/:id');
  assert.equal(crumbText({ t: 10, k: 'ev', n: 'card_create' }), 'card_create');
  assert.equal(crumbText({ t: 10, k: 'toast', n: 'move_step_failed' }), 'Saw error move_step_failed');
  assert.equal(crumbText(null), '');
  assert.equal(beforeText(0), 'at the error');
  assert.equal(beforeText(1234), '1.2s before');
  assert.equal(beforeText(42000), '42s before');
  assert.equal(beforeText(125000), '2m 05s before');
  assert.equal(offsetText(-130000), '−2m 10s');
  assert.equal(offsetText(4000), '+4s');
  assert.equal(offsetText(200), '0s');
});

test('context becomes chips, never the raw object', () => {
  assert.deepEqual(
    contextChips({ op: 'save', http: { method: 'POST', svc: 'rpc', route: 'save_board', status: 500, pg: '57014', ms: 8123 }, online: false, attempt: 2 }),
    ['op save', 'POST rpc/save_board', '500', '57014', '8123ms', 'attempt 2', 'offline'],
  );
  assert.deepEqual(contextChips(null), []);
  assert.deepEqual(contextChips({ op: 'boot', phase: 'shell', ms: 45000, vis: 'visible' }), ['op boot', 'phase shell', '45000ms']);
});

test('an event says what explains it; a trace says its clicks', () => {
  assert.equal(eventSummary({ event: 'files_move', props: { outcome: 'failed', code: 'P0001', n: 3 } }),
    'outcome failed · code P0001 · n 3');
  assert.equal(eventSummary({ event: 'app_trace', props: { ev: [{ k: 'dead' }, { k: 'dead' }, { k: 'rage', n: 4 }, { k: 'route' }] } }),
    '2 dead clicks, 1 rage click');
  assert.equal(eventSummary({ event: 'home_view', props: null }), '');
});

test('a trail is one timeline, oldest first, offset from its moment', () => {
  const t = (s) => new Date(Date.UTC(2026, 9, 24, 12, 0, s)).toISOString();
  const items = trailItems({
    at: t(30),
    errors: [{ id: 'e1', at: t(30), kind: 'http' }],
    events: [{ at: t(40), event: 'files_move' }, { at: t(10), event: 'home_view' }],
    feedback: [{ id: 'f1', at: t(50), kind: 'bug' }],
  });
  assert.deepEqual(items.map((i) => i.is), ['event', 'error', 'event', 'feedback']);
  assert.deepEqual(items.map((i) => i.offset), [-20000, 0, 10000, 20000]);
  assert.deepEqual(trailItems(null), []);
});

test('a problem copies as plain text, its steps included', () => {
  const text = issueText(
    { message: 'GET rest/boards: server error', kind: 'http', severity: 'error', source: 'client', people: 3, n: 9, fingerprint: 'abc' },
    { occurrences: [{ at: '2026-10-24T12:00:00Z', env: 'prod', release: 'r1', ua: 'Chrome · Mac',
      context: { http: { method: 'GET', svc: 'rest', route: 'boards', status: 500 } },
      breadcrumbs: [{ t: 3000, k: 'nav', n: '/' }], stack: 'Error: x' }] },
  );
  assert.match(text, /^problem: GET rest\/boards: server error$/m);
  assert.match(text, /^context: GET rest\/boards · 500$/m);
  assert.match(text, /^ {2}3\.0s before: Went to \/$/m);
  assert.match(text, /^stack:\nError: x$/m);
});
