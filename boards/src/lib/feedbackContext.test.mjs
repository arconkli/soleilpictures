// feedbackContext — the record every ask attaches, and the line that shows it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedbackContext, describeFeedbackContext, FEEDBACK_CONTEXT_KEYS } from './feedbackContext.js';

const env = { surface: 'canvas', board_id: 'b-1', tier: 'demo', device: 'desktop', os: 'macOS', browser: 'Chrome', build: 'abc1234', path: '/b/abc?share=SECRET#x' };

test('only whitelisted keys survive, and what the asker knows beats the ambient record', () => {
  const ctx = buildFeedbackContext({ offer: 'cap-hit', cards: 34, cap: 50, tier: 'paid', note: 'typed words', q: 'search' }, env);
  assert.equal(ctx.offer, 'cap-hit');
  assert.equal(ctx.cards, 34);
  assert.equal(ctx.tier, 'paid', 'input wins over env');
  assert.equal(ctx.note, undefined, 'never anything typed');
  assert.equal(ctx.q, undefined);
  for (const k of Object.keys(ctx)) assert.ok(FEEDBACK_CONTEXT_KEYS.includes(k), k);
});

test('the path is the pathname alone — a query string can carry a token', () => {
  assert.equal(buildFeedbackContext({}, env).path, '/b/abc');
  assert.equal(buildFeedbackContext({ path: '?only=query' }, {}).path, undefined);
});

test('scalars only: objects, arrays, NaN and empty strings are dropped; numbers are whole', () => {
  const ctx = buildFeedbackContext({ cards: Number.NaN, cap: 50.6, dwell_ms: Infinity, via: '  ', surface: { a: 1 }, method: ['x'], trial_offered: false });
  assert.deepEqual(ctx, { cap: 51, trial_offered: false });
});

test('strings are capped at 80, matching the server, so what is shown is what is stored', () => {
  assert.equal(buildFeedbackContext({ via: 'x'.repeat(200) }).via.length, 80);
});

test('the visible line names surface, depth, plan and device, and nothing it does not have', () => {
  assert.equal(describeFeedbackContext(buildFeedbackContext({ cards: 34 }, env)), 'canvas · 34 cards · Free · desktop');
  assert.equal(describeFeedbackContext({ surface: 'list', cards: 1 }), 'list view · 1 card');
  assert.equal(describeFeedbackContext({}), '');
  assert.equal(describeFeedbackContext({ tier: 'paid' }), 'Creator');
});
