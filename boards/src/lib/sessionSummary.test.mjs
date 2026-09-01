// sessionSummary.test.mjs — node --test src/lib/sessionSummary.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSummary, noteEvent, summaryProps, worthEmitting } from './sessionSummary.js';
import { WORK_EVENTS } from './analyticsEvents.js';

const S = { id: 'sess-1', seq: 3, startedAt: 1000 };

test('counts events, cards, boards and surfaces', () => {
  const a = createSummary(S, 1000);
  noteEvent(a, 'app_open', { surface: 'canvas' }, 1100);
  noteEvent(a, 'card_placed', { n: 3, board_id: 'b1', surface: 'canvas' }, 1200);
  noteEvent(a, 'card_placed', { n: 2, board_id: 'b2', surface: 'canvas' }, 1300);
  noteEvent(a, 'board_open', { board_id: 'b1' }, 1400);

  const p = summaryProps(a, 'hide', 9999);
  assert.equal(p.events_n, 4);
  assert.equal(p.cards_placed, 5, 'card_placed carries a batch size in n');
  assert.equal(p.boards_opened, 2, 'distinct boards, not board events');
  assert.equal(p.surfaces_n, 1);
  assert.equal(p.ms_span, 400, 'span runs to the LAST event, not to now');
  assert.equal(p.visit_n, 3);
  assert.equal(p.of_session, 'sess-1');
  assert.equal(p.ended, 'hide');
});

test('a card_placed with no n still counts as one card', () => {
  const a = createSummary(S, 0);
  noteEvent(a, 'card_placed', {}, 10);
  noteEvent(a, 'card_placed', { n: 'nonsense' }, 20);
  assert.equal(summaryProps(a, 'hide').cards_placed, 2);
});

test('work is recorded, presence is not', () => {
  const idle = createSummary(S, 0);
  noteEvent(idle, 'board_open', { board_id: 'b' }, 10);
  noteEvent(idle, 'search_run', {}, 20);
  assert.equal(summaryProps(idle, 'hide').wrote, false, 'looking is not working');

  const busy = createSummary(S, 0);
  noteEvent(busy, 'doc_edit', { board_id: 'b' }, 10);
  assert.equal(summaryProps(busy, 'hide').wrote, true);
});

test('the work set does not drift from WORK_EVENTS', () => {
  // The set is duplicated as a literal so this module stays dependency-free.
  // That duplication is only safe if something fails when the two disagree.
  const a = createSummary(S, 0);
  for (const ev of WORK_EVENTS) {
    const one = createSummary(S, 0);
    noteEvent(one, ev, {}, 1);
    assert.equal(summaryProps(one, 'x').wrote, true, `${ev} is work in analyticsEvents but not here`);
    noteEvent(a, ev, {}, 1);
  }
  assert.equal(summaryProps(a, 'x').wrote, true);
});

test('errors are counted by name shape, so new ones need no edit here', () => {
  const a = createSummary(S, 0);
  noteEvent(a, 'otp_verify_error', {}, 1);
  noteEvent(a, 'onboarding_seed_failed', {}, 2);
  noteEvent(a, 'card_create_blocked', {}, 3);
  noteEvent(a, 'card_placed', { n: 1 }, 4);
  assert.equal(summaryProps(a, 'hide').errors_n, 3);
});

test('the summary never counts itself', () => {
  const a = createSummary(S, 0);
  noteEvent(a, 'app_open', {}, 1);
  noteEvent(a, 'session_summary', {}, 2);
  assert.equal(summaryProps(a, 'hide').events_n, 1);
});

test('an empty session is not worth a row', () => {
  assert.equal(worthEmitting(createSummary(S, 0)), false, 'every page load would emit one');
  const a = createSummary(S, 0);
  noteEvent(a, 'app_open', {}, 1);
  assert.equal(worthEmitting(a), true);
  assert.equal(worthEmitting(null), false);
});

test('malformed input never throws on the logging path', () => {
  const a = createSummary(null);
  assert.doesNotThrow(() => noteEvent(a, 'card_placed', null));
  assert.doesNotThrow(() => noteEvent(a, null, {}));
  assert.doesNotThrow(() => noteEvent(null, 'x', {}));
  assert.doesNotThrow(() => summaryProps(a, 'hide'));
  assert.equal(summaryProps(null, 'hide'), null);
});

test('ms_span cannot go negative on a backwards clock', () => {
  const a = createSummary({ id: 'x', seq: 1, startedAt: 5000 }, 5000);
  noteEvent(a, 'app_open', {}, 1000);
  assert.equal(summaryProps(a, 'hide').ms_span, 0);
});
