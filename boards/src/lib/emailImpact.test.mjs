// emailImpact.test.mjs — what Emails › Impact says, against invented numbers.
//
//   node --test src/lib/emailImpact.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOX, CHANGE_KINDS, EMAILS, MARK_KIND, MIN_EACH_SIDE, THIN_WEEK, WELCOME_WAIT_DAYS,
  armRows, changeFigure, changesList, daysBetween, emailName, impactCalendar, lostRows, mailboxRows,
  monthsBand, openGeometry, openReading, openRows, openTip, opensFoot, pctText, pctX, rowMarks,
  sendGeometry, sendGroups, sendPace, sendReading, sendTip, spanText, sparkPath, tipSide, weekName,
  weekRules, welcomeFoot, welcomeGeometry, welcomeSeries, welcomeTip, windowText, xLabels,
} from './emailImpact.js';
import { EMAIL_CHANGES, SPLIT_DAY } from './emailChanges.js';
import { GLYPH, glyphFor } from '../pages/admin/viz/markerGlyphs.js';

// An admin_email_impact payload: eight UTC weeks from Monday Mar 2, read on
// Wednesday Apr 22, compared either side of Sunday Mar 29. Every number here is
// invented.
const WEEKS = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30', '2026-04-06', '2026-04-13', '2026-04-20'];
const zeros = () => WEEKS.map(() => 0);

const WELCOME = {
  type: 'welcome_board', first_sent: '2026-03-10T09:00:00Z', last_sent: '2026-04-21T19:00:00Z',
  sent: [10, 10, 10, 10, 10, 10, 10, 4], delivered: [10, 10, 10, 10, 10, 10, 10, 4], opened: [6, 6, 6, 6, 3, 3, 3, 1],
  made: [1, 2, 1, 0, 1, 1, 2, 0], held: zeros(), held_made: zeros(), young: [0, 0, 0, 0, 0, 0, 1, 4], failed: zeros(),
  before: { delivered: 40, opened: 24 }, after: { delivered: 34, opened: 10 },
};
const NUDGE = {
  type: 'activate_nudge_1', first_sent: '2026-03-02T10:00:00Z', last_sent: '2026-04-21T21:00:00Z',
  sent: [8, 8, 8, 8, 8, 8, 8, 2], delivered: [8, 8, 8, 8, 8, 8, 8, 2], opened: [3, 3, 3, 4, 3, 3, 3, 1],
  made: [0, 1, 0, 0, 1, 0, 0, 0], held: [0, 0, 0, 0, 0, 2, 1, 1], held_made: [0, 0, 0, 0, 0, 1, 0, 0],
  young: [0, 0, 0, 0, 0, 0, 1, 2], failed: zeros(),
  before: { delivered: 32, opened: 13 }, after: { delivered: 26, opened: 10 },
};
const NEWS = {
  type: 'whats_new', first_sent: '2026-03-03T05:00:00Z', last_sent: '2026-03-14T05:00:00Z',
  sent: [6, 6, 0, 0, 0, 0, 0, 0], delivered: [6, 6, 0, 0, 0, 0, 0, 0], opened: [2, 3, 0, 0, 0, 0, 0, 0],
  made: zeros(), held: zeros(), held_made: zeros(), young: zeros(), failed: zeros(),
  before: { delivered: 12, opened: 5 }, after: { delivered: 0, opened: 0 },
};
const RAW = {
  weeks: WEEKS,
  today: '2026-04-22',
  split: '2026-03-29',
  tracked_from: '2026-03-02T10:00:00Z',
  types: [NEWS, NUDGE, WELCOME],
  months: [
    { month: '2026-02-01', delivered: 200, opened: 90 },
    { month: '2026-03-01', delivered: 150, opened: 45 },
    { month: '2026-04-01', delivered: 40, opened: 10 },
  ],
  signups: [5, 10, 10, 10, 9, 10, 8, 3],
  welcomed: [0, 7, 6, 0, 7, 8, 2, 0],
  mailbox: [
    { box: 'other', delivered: [2, 2, 2, 2, 2, 2, 2, 0], opened: [1, 1, 1, 1, 0, 0, 1, 0], before: { delivered: 8, opened: 4 }, after: { delivered: 6, opened: 1 } },
    { box: 'gmail', delivered: [18, 18, 12, 12, 12, 12, 12, 5], opened: [8, 9, 6, 7, 4, 4, 4, 2], before: { delivered: 60, opened: 30 }, after: { delivered: 41, opened: 14 } },
    { box: 'icloud', delivered: [4, 4, 4, 4, 4, 4, 4, 1], opened: [3, 3, 3, 3, 3, 3, 3, 1], before: { delivered: 16, opened: 12 }, after: { delivered: 13, opened: 10 } },
  ],
  lost: [
    { type: 'activate_nudge_1', reason: 'bounced', n: 2, by_week: [0, 1, 0, 0, 0, 1, 0, 0] },
    { type: 'welcome_board', reason: 'failed', n: 3, by_week: [0, 0, 3, 0, 0, 0, 0, 0] },
    { type: 'whats_new', reason: 'no_report', n: 2, by_week: [2, 0, 0, 0, 0, 0, 0, 0] },
  ],
  arms: [
    { type: 'activate_nudge_1', factor: 'body', arm: 'b1', sends: 20, delivered: 19, opened: 8, clicked: 2, returned: 3, made: 1, first: '2026-03-02', last: '2026-04-21' },
    { type: 'activate_nudge_1', factor: 'subject', arm: 's10', sends: 9, delivered: 9, opened: 4, clicked: 1, returned: 1, made: 0, first: '2026-03-09', last: '2026-04-21' },
    { type: 'activate_nudge_1', factor: 'subject', arm: 's2', sends: 11, delivered: 10, opened: 4, clicked: 1, returned: 2, made: 1, first: '2026-03-02', last: '2026-04-20' },
    { type: 'welcome_board', factor: 'subject', arm: 's1', sends: 10, delivered: 0, opened: 0, clicked: 0, returned: 0, made: 0, first: '2026-03-03', last: '2026-03-20' },
  ],
};
const CAL = impactCalendar(RAW);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} ≈ ${b}`);

// ── The calendar ────────────────────────────────────────────────────────────

test('the calendar: eight weeks, the days of this one so far, and the x of a day', () => {
  assert.equal(CAL.n, 8);
  assert.equal(CAL.today, '2026-04-22');
  assert.equal(CAL.daysSoFar, 3);
  near(CAL.slot, (BOX.X1 - BOX.X0) / 8);
  assert.equal(CAL.bw, 26, 'bars are 26 wide at most');
  near(CAL.left(0), BOX.X0);
  near(CAL.center(0), BOX.X0 + CAL.slot / 2);
  near(CAL.xOfDay('2026-03-02'), BOX.X0);
  near(CAL.xOfDay('2026-03-05'), BOX.X0 + (3 / 7) * CAL.slot);
  near(CAL.xOfDay('2026-04-27'), BOX.X1, 'the day after the last week ends at the right edge');
  assert.equal(CAL.xOfDay('2026-02-28'), null, 'before the first week');
  assert.equal(CAL.xOfDay('2026-04-28'), null, 'after the last week');
  assert.equal(CAL.xOfDay('not a day'), null);
  // A Monday read is the first day of its week; a read with no weeks has no calendar.
  assert.equal(impactCalendar({ ...RAW, today: '2026-04-20' }).daysSoFar, 1);
  const none = impactCalendar({});
  assert.equal(none.n, 0);
  assert.equal(none.daysSoFar, null);
});

test('the axis labels every fourth week and this week, and rules the weeks between', () => {
  assert.deepEqual(xLabels(CAL).map((l) => l.label), ['Mar 2', 'Mar 30', 'this week']);
  assert.equal(xLabels(CAL)[0].lx, pctX(CAL.center(0)));
  assert.deepEqual(xLabels(CAL).at(-1), { key: 'now', lx: 100, label: 'this week', end: true });
  // A fourth week too close to the end is left out, so it never crowds 'this week'.
  const seven = impactCalendar({ ...RAW, weeks: WEEKS.slice(0, 7) });
  assert.deepEqual(xLabels(seven).map((l) => l.label), ['Mar 2', 'this week']);
  assert.deepEqual(weekRules(CAL), [250.5, 683.5]);
  assert.equal(weekName(CAL, 0), 'week of Mar 2');
  assert.equal(weekName(CAL, 7), 'this week so far');
  assert.deepEqual([tipSide(10), tipSide(50), tipSide(90)], ['start', 'mid', 'end']);
});

test('small words: a rate, a span of days, an email by name', () => {
  assert.equal(pctText(null), '—');
  assert.equal(pctText(0.415), '42%');
  assert.equal(daysBetween('2026-04-22', '2026-04-27'), 5);
  assert.equal(daysBetween('2026-04-22T23:59:00Z', '2026-04-23'), 1, 'whole UTC days');
  assert.equal(daysBetween(null, '2026-04-23'), null);
  assert.equal(spanText('2026-09-06', '2026-09-16'), 'Sep 6 to 16');
  assert.equal(spanText('2026-08-30', '2026-09-02'), 'Aug 30 to Sep 2');
  assert.equal(spanText('2026-08-30'), 'Aug 30');
  assert.equal(emailName('welcome_board'), 'Welcome');
  assert.equal(emailName('board_waiting'), 'Your cluster is waiting');
  assert.equal(emailName('a_new_one'), 'A new one', 'an email the page has not heard of shows its own name');
  assert.equal(windowText(RAW), '8 wk UTC, from Mar 2 · 3 of 7 days');
  assert.equal(windowText({}), '');
});

// ── The band ────────────────────────────────────────────────────────────────

test('the band: opened per delivered, month by month, this one so far', () => {
  const b = monthsBand(RAW);
  assert.deepEqual(b.rows.map((r) => [r.name, r.pct, r.n]), [
    ['February', '45%', '90 of 200 delivered'],
    ['March', '30%', '45 of 150 delivered'],
    ['April so far', '25%', '10 of 40 delivered'],
  ]);
  assert.deepEqual(b.head, { k: 'Opened in April so far', value: '25%', of: 'of 40 delivered' });
  assert.equal(b.sentence, 'About 45% opened in February, 30% in March, 25% so far in April.');
  assert.equal(b.rows[0].w, 45);
  assert.equal(b.rows[0].aria, 'February: 45% opened, 90 of 200 delivered');

  // Nothing delivered yet this month is said, never shown as 0%.
  const early = monthsBand({ months: [...RAW.months.slice(0, 2), { month: '2026-04-01', delivered: 0, opened: 0 }] });
  assert.deepEqual(early.head, { k: 'Opened in April so far', value: '—', of: 'nothing delivered yet' });
  assert.equal(early.sentence, 'About 45% opened in February, 30% in March, nothing delivered in April.');
  assert.equal(early.rows[2].w, 0);
  assert.deepEqual(monthsBand({}), { rows: [], head: null, sentence: '' });
});

// ── 01 · Opens ──────────────────────────────────────────────────────────────

test('opens: every email together, then each one that sent on both sides of the split, biggest fall first', () => {
  const o = openRows(RAW);
  assert.equal(o.split, '2026-03-29');
  assert.equal(o.top, 0.8, 'no week above 80%, so the scale stops there');
  assert.deepEqual(o.each.map((r) => r.type), ['welcome_board', 'activate_nudge_1'],
    `What’s new had fewer than ${MIN_EACH_SIDE} delivered after the split, so it is not compared`);
  assert.equal(o.each[0].beforeRate, 0.6);
  near(o.each[0].afterRate, 10 / 34);
  assert.equal(o.each[0].halved, true, 'at or under half is halved');
  assert.equal(o.each[1].halved, false);
  // Every email, pooled from each one's own sides.
  assert.deepEqual(o.every.before, { delivered: 84, opened: 42 });
  assert.deepEqual(o.every.after, { delivered: 60, opened: 20 });
  assert.equal(o.every.halved, false);
  assert.deepEqual(o.every.weeks[0], { delivered: 24, opened: 11, sent: 24 });
  assert.equal(o.head, 'One of the two halved after Mar 29. The first nudge did not.');
  assert.equal(o.meta, 'two emails that sent across Mar 29');
  assert.equal(opensFoot(o),
    'Both send from the same address, and the first nudge did not halve, so the address alone does not explain the drop.');

  // One week above 80% and the scale runs to 100%.
  const hot = openRows({ ...RAW, types: [{ ...NUDGE, opened: [9, 3, 3, 4, 3, 3, 3, 1], delivered: [10, 8, 8, 8, 8, 8, 8, 2] }] });
  assert.equal(hot.top, 1);

  // No split day: nothing is compared, and nothing is said about halving.
  const flat = openRows({ ...RAW, split: null });
  assert.deepEqual([flat.each, flat.head, flat.meta], [[], '', '']);
  assert.equal(flat.every.before, null);
});

test('the halving sentence counts in words, and names the ones that did not', () => {
  const half = (type) => ({ ...WELCOME, type, before: { delivered: 40, opened: 20 }, after: { delivered: 20, opened: 4 } });
  const kept = (type) => ({ ...NUDGE, type, before: { delivered: 40, opened: 20 }, after: { delivered: 20, opened: 9 } });
  const say = (types) => openRows({ ...RAW, types }).head;
  assert.equal(say([half('welcome_board')]), 'The welcome halved after Mar 29.');
  assert.equal(say([kept('welcome_board')]), 'The welcome did not halve after Mar 29.');
  assert.equal(say([half('welcome_board'), half('activate_nudge_1')]), 'Both halved after Mar 29.');
  assert.equal(say([kept('welcome_board'), kept('activate_nudge_1')]), 'Neither halved after Mar 29.');
  assert.equal(say([half('welcome_board'), half('activate_nudge_1'), half('board_waiting')]), 'All three halved after Mar 29.');
  assert.equal(say([kept('welcome_board'), kept('activate_nudge_1'), kept('board_waiting')]), 'None of the three halved after Mar 29.');
  // The two that did not fell by the same amount, so the page's own order breaks the tie.
  assert.equal(say([half('welcome_board'), half('activate_nudge_2'), kept('board_waiting'), kept('activate_nudge_1')]),
    'Two of the four halved after Mar 29. The first nudge and Your cluster is waiting did not.');
  // The footnote only speaks when some halved and some did not.
  const foot = (types) => opensFoot(openRows({ ...RAW, types }));
  assert.equal(foot([half('welcome_board'), half('activate_nudge_1')]), '');
  assert.equal(foot([kept('welcome_board'), kept('activate_nudge_1')]), '');
  assert.equal(foot([half('welcome_board')]), '');
  assert.equal(foot([half('welcome_board'), half('activate_nudge_2'), kept('activate_nudge_1')]),
    'All three send from the same address, and the first nudge did not halve, so the address alone does not explain the drop.');
  // An email from another address in the comparison, and the address could be why.
  assert.equal(foot([half('welcome_board'), kept('product_update')]), '');
  assert.equal(foot([half('welcome_board'), half('product_update'), kept('activate_nudge_1')]), '');
  assert.equal(openRows({ ...RAW, types: [] }).meta, 'no email sent on both sides of Mar 29');
});

test('a row of opens: dots, a line through the weeks that had deliveries, the two averages', () => {
  const o = openRows(RAW);
  const g = openGeometry(o.each[0], CAL, { top: o.top, split: o.split });
  assert.equal(g.dots.length, 8);
  assert.deepEqual(g.dots[0], { i: 0, x: 88.1, y: 21.5, thin: false });
  assert.equal(g.dots[7].thin, true, `under ${THIN_WEEK} delivered is drawn hollow`);
  assert.equal(g.paths.length, 1);
  assert.deepEqual(g.means.map((m) => [m.key, m.x1, m.x2, m.y, m.label.t]), [
    ['before', 38, 451.5, 21.5, '60%'],
    ['after', 451.5, 896, 42.1, '29%'],
  ]);
  assert.deepEqual(g.means[0].label, { lx: 50.2, ly: 29.9, t: '60%' });

  // A week with nothing delivered breaks the line; a lone dot has no line.
  const gappy = {
    weeks: [{ delivered: 0, opened: 0, sent: 0 }, { delivered: 20, opened: 10, sent: 20 }, { delivered: 5, opened: 1, sent: 5 },
      { delivered: 0, opened: 0, sent: 3 }, { delivered: 12, opened: 6, sent: 12 }, ...Array(3).fill({ delivered: 0, opened: 0, sent: 0 })],
    beforeRate: null, afterRate: null,
  };
  const gg = openGeometry(gappy, CAL, {});
  assert.deepEqual(gg.dots.map((d) => [d.i, d.thin]), [[1, false], [2, true], [4, false]]);
  assert.equal(gg.paths.length, 1);
  assert.deepEqual(gg.means, []);
});

test('the opens reading and hover card', () => {
  const o = openRows(RAW);
  assert.deepEqual(openReading(o.each[0]), { value: '60% → 29%', when: '40 then 34 delivered' });
  assert.deepEqual(openReading({ weeks: [{ delivered: 10, opened: 4 }, { delivered: 10, opened: 2 }] }), { value: '30%', when: '20 delivered' });
  const tip = openTip(o.each[0], CAL, 0);
  assert.deepEqual([tip.title, tip.value, tip.of, tip.side], ['week of Mar 2 · Welcome', '60%', '6 of 10 opened', 'start']);
  assert.equal(openTip(o.each[0], CAL, 7).title, 'this week so far · Welcome');
  const news = { ...o.every, name: 'What’s new', weeks: [{ delivered: 0, opened: 0, sent: 4 }, { delivered: 0, opened: 0, sent: 0 }] };
  assert.equal(openTip(news, CAL, 0).value, 'none delivered');
  assert.equal(openTip(news, CAL, 1).value, 'none sent');
  assert.equal(openTip(news, CAL, 9), null);
});

// ── 02 · Sends ──────────────────────────────────────────────────────────────

test('how an email has been sending, over the complete weeks since its first', () => {
  const pace = (v) => sendPace(v, CAL);
  assert.equal(pace([3, 3, 3, 3, 3, 3, 3, 1]), 'every week');
  assert.equal(pace([0, 0, 3, 3, 3, 3, 3, 0]), 'every week', 'the weeks before its first do not count');
  assert.equal(pace([3, 3, 0, 3, 3, 3, 3, 0]), 'every week but one');
  assert.equal(pace([3, 0, 3, 0, 3, 3, 3, 0]), 'in 5 of 7 weeks');
  assert.equal(pace([3, 3, 0, 0, 0, 3, 3, 2]), 'again since the week of Apr 6');
  assert.equal(pace([3, 3, 3, 3, 3, 0, 0, 2]), 'again this week');
  assert.equal(pace([3, 3, 3, 3, 3, 0, 0, 0]), '', 'stopped: nothing to say about its pace');
  assert.equal(pace([0, 0, 0, 0, 0, 0, 0, 4]), 'from this week');
  assert.equal(pace(zeros()), '');
});

test('sends: sending now, then paused or stopped, each with its sentence', () => {
  const groups = sendGroups(RAW);
  assert.deepEqual(groups.map((g) => [g.key, g.name, g.rows.map((r) => r.type)]), [
    ['now', 'Sending now', ['welcome_board', 'activate_nudge_1']],
    ['stopped', 'Paused or stopped', ['whats_new']],
  ]);
  assert.equal(groups[0].head, 'The welcome and the first nudge every week.');
  assert.equal(groups[1].head, 'None of these has gone out this week or last.');
  const nudge = groups[0].rows[1];
  assert.deepEqual([nudge.total, nudge.madeTotal, nudge.heldTotal, nudge.heldMadeTotal, nudge.max], [58, 2, 4, 1, 10]);
  assert.equal(groups[0].rows[0].max, 10);
  assert.equal(nudge.lastSent, '2026-04-21');

  // Different paces are said separately, in the page's order.
  const mixed = sendGroups({ ...RAW, types: [{ ...NUDGE, sent: [8, 8, 0, 8, 8, 8, 8, 2] }, WELCOME] });
  assert.equal(mixed[0].head, 'The welcome every week; the first nudge every week but one.');
  // Nothing in the stopped group, no group for it.
  assert.deepEqual(sendGroups({ ...RAW, types: [WELCOME] }).map((g) => g.key), ['now']);
});

test('the words beside a row of sends, and its hover card', () => {
  const [now, stopped] = sendGroups(RAW);
  const nudge = now.rows[1];
  assert.deepEqual(sendReading(nudge, CAL), {
    value: '58',
    unit: 'sent · 4 held back',
    when: '2 made something in 3 days',
    held: 'held back: 1 made something',
    last: 'this week so far 2',
  });
  const news = sendReading(stopped.rows[0], CAL);
  assert.deepEqual([news.unit, news.held, news.last], ['sent', null, 'last sent Mar 14']);

  const tip = sendTip(nudge, CAL, 5);
  assert.deepEqual([tip.title, tip.value, tip.of], ['week of Apr 6 · First nudge', '8', 'sent']);
  assert.deepEqual(tip.lines, ['0 made something within 3 days', '2 held back · 1 made something']);
  assert.deepEqual(sendTip(nudge, CAL, 7).lines, ['0 made something within 3 days', '1 held back · 0 made something', '2 still inside their 3 days']);
  assert.equal(sendTip(stopped.rows[0], CAL, 5).value, 'none');
  assert.equal(sendTip(nudge, CAL, 8), null);
});

test('a row of sends: grey sent, the green foot of who made something, held back on top, this week hollow', () => {
  const nudge = sendGroups(RAW)[0].rows[1];
  const g = sendGeometry(nudge, CAL);
  const tones = (i) => g.bars.filter((b) => b.key.slice(1) === String(i)).map((b) => b.tone);
  assert.deepEqual(tones(0), ['sent']);
  assert.deepEqual(tones(1), ['sent', 'made']);
  assert.deepEqual(tones(5), ['sent', 'held']);
  assert.deepEqual(tones(7), ['part', 'held'], 'this week so far is hollow');
  assert.ok(g.bars.every((b) => typeof b.d === 'string' && b.d.startsWith('M')));
});

// ── 03 · Welcomes ───────────────────────────────────────────────────────────

test('welcomes per 100 new accounts: settled weeks, the usual, and the stall', () => {
  const s = welcomeSeries(RAW, Date.parse('2026-04-22T00:00:00Z'));
  assert.equal(s.start, 1, 'the weeks before the first welcome are not read');
  assert.deepEqual(s.weeks.map((w) => w.settled), [true, true, true, true, true, true, false, false],
    `a week settles ${WELCOME_WAIT_DAYS} days after it ends`);
  near(s.usual, 0.7, 'the median of the settled weeks since the first welcome');
  assert.equal(s.stall.wk, '2026-03-23');
  assert.deepEqual(s.reading, { value: '0', unit: 'in the week of Mar 23', when: 'usually about 70 per 100' });
  // Without a clock, the read's own day is the clock.
  assert.deepEqual(welcomeSeries(RAW).weeks.map((w) => w.settled), s.weeks.map((w) => w.settled));

  // No week under half the usual: no stall, and the latest settled week is the reading.
  const steady = welcomeSeries({ ...RAW, welcomed: [0, 7, 6, 7, 7, 8, 2, 0] });
  assert.equal(steady.stall, null);
  assert.equal(steady.reading.unit, 'in the week of Apr 6');
  // Before any week settles there is no usual to compare with.
  const young = welcomeSeries({ ...RAW, types: [{ ...WELCOME, first_sent: '2026-04-14T00:00:00Z' }] });
  assert.equal(young.usual, null);
  assert.deepEqual(young.reading, { value: '—', unit: '', when: 'not enough settled weeks yet' });
});

test('the welcome chart, its card and the line under it', () => {
  const s = welcomeSeries(RAW);
  const g = welcomeGeometry(s, CAL);
  assert.deepEqual(g.bars.map((b) => [b.key, b.tone]), [
    ['2026-03-09', 'bar'], ['2026-03-16', 'bar'], ['2026-03-23', 'zero'], ['2026-03-30', 'bar'],
    ['2026-04-06', 'bar'], ['2026-04-13', 'part'], ['2026-04-20', 'part'],
  ], 'a week still filling is hollow even with nobody welcomed yet; only a settled one is a stall');
  assert.deepEqual(g.ref, { y: 32.2, ly: 33.5, label: 'usual, 70' });
  assert.deepEqual(g.stall, { lx: 45.9, ly: 81.3, label: '0 of 10' });

  const tip = welcomeTip(s, CAL, 6);
  assert.deepEqual([tip.title, tip.value, tip.of], ['signed up the week of Apr 13', '25', 'per 100']);
  assert.deepEqual(tip.lines, ['2 of 8 got a welcome', `still filling: the welcome can go out up to ${WELCOME_WAIT_DAYS} days after sign-up`]);
  assert.equal(welcomeTip(s, CAL, 7).title, 'signed up this week so far');
  assert.equal(welcomeTip(s, CAL, 0), null, 'before the first welcome there is nothing to read');

  const gap = [{ day: '2026-03-21', until: '2026-03-26', kind: 'alert', types: ['welcome_board'], label: 'No welcome emails' }];
  assert.deepEqual(welcomeFoot(s, gap), {
    strong: 'The week of Mar 23: 0 of 10 new accounts got a welcome',
    rest: '. No welcome went out Mar 21 to 26; sending resumed Mar 27.',
  });
  assert.equal(welcomeFoot(s, []).rest, '.', 'no recorded gap, no claim about one');
  const steady = welcomeSeries({ ...RAW, welcomed: [0, 7, 6, 7, 7, 8, 2, 0] });
  assert.deepEqual(welcomeFoot(steady, gap), { strong: '', rest: 'No settled sign-up week since Mar 9 fell below half the usual.' });
});

// ── What changed ────────────────────────────────────────────────────────────

const CHANGES = [
  { day: '2026-02-20', kind: 'stop', types: ['reengage_1'], label: 'Before the weeks in view' },
  { day: '2026-03-21', until: '2026-03-26', kind: 'alert', types: ['welcome_board'], label: 'No welcome emails', figure: 'welcome_gap' },
  { day: '2026-03-29', kind: 'alert', split: true, label: 'Mail went to spam', figure: 'split' },
  { day: '2026-03-10', kind: 'stop', types: ['whats_new'], label: 'What’s new: last send', sub: 'by hand' },
  { day: '2026-04-06', kind: 'first', types: ['activate_nudge_1'], label: 'A group held back', figure: 'held' },
  { day: '2026-04-25', kind: 'first', label: 'Not yet, and not a reading' },
  { day: '2026-04-27', kind: 'due', short: 'inbox read', label: 'Inbox read', sub: 'is it back?' },
];

function listFor(raw, changes = CHANGES) {
  const opens = openRows(raw);
  const sends = sendGroups(raw);
  const welcome = welcomeSeries(raw);
  return changesList(raw, { changes, opens, sends, welcome });
}

test('what changed: the weeks in view oldest first, then what is due, each figure from the read', () => {
  const l = listFor(RAW);
  assert.deepEqual(l.items.map((it) => [it.d, it.label, it.sub, it.next]), [
    ['Mar 10', 'What’s new: last send', 'by hand', false],
    ['Mar 21', 'No welcome emails, Mar 21 to 26', '0 of 10 new accounts in the week of Mar 23', false],
    ['Mar 29', 'Mail went to spam', 'opens halved for 1 of the 2 emails that sent across it', false],
    ['Apr 6', 'A group held back', '4 held back so far', false],
    ['Apr 27', 'Inbox read', 'is it back?', true],
  ]);
  assert.equal(l.meta, '4 since Mar 2, and one due');
  assert.deepEqual(l.next, { d: 'Apr 27', text: 'inbox read, in 5 days' });
  assert.equal(listFor({ ...RAW, today: '2026-04-26' }).next.text, 'inbox read, tomorrow');
  // On its own day a reading is still due: it says today, rather than dropping into the past.
  const day = listFor({ ...RAW, today: '2026-04-27' });
  assert.equal(day.next.text, 'inbox read, today');
  assert.equal(day.meta, '5 since Mar 2, and one due');
  assert.equal(day.items.filter((it) => it.next).length, 1);
  assert.deepEqual(changesList({}), { items: [], meta: '', next: null });
});

test('a figure the read cannot say is left out, never guessed', () => {
  const o = openRows(RAW);
  const sends = sendGroups(RAW);
  const welcome = welcomeSeries(RAW);
  const byFigure = (f) => CHANGES.find((c) => c.figure === f);
  assert.equal(changeFigure(byFigure('split'), { opens: { each: [] } }), null);
  assert.equal(changeFigure(byFigure('split'), { opens: { each: o.each.map((r) => ({ ...r, halved: false })) } }),
    'none of the 2 emails that sent across it halved its opens');
  assert.equal(changeFigure(byFigure('held'), { sends: sendGroups({ ...RAW, types: [WELCOME] }) }), null);
  assert.equal(changeFigure(byFigure('held'), { sends }), '4 held back so far');
  assert.equal(changeFigure(byFigure('welcome_gap'), { welcome: { ...welcome, stall: null } }), null);
  assert.equal(changeFigure({ ...byFigure('welcome_gap'), day: '2026-04-01', until: '2026-04-03' }, { welcome }), null,
    'a gap that does not touch the stalled week says nothing about it');
  assert.equal(changeFigure({ label: 'no figure' }, { opens: o, sends, welcome }), null);
});

test('the dated lines on a row: every email’s, then its own, glyphs on a group’s first row and on its own', () => {
  const l = listFor(RAW);
  const at = (marks) => marks.map((m) => [m.key.slice(0, 10), m.kind, m.glyph]);
  const all = rowMarks(l.items, CAL, null, { first: true });
  assert.deepEqual(at(all.marks), [['2026-03-29', 'alert', true]], 'the every-email row draws only what was about every email');
  const welcome = rowMarks(l.items, CAL, 'welcome_board', { first: true });
  assert.deepEqual(at(welcome.marks), [['2026-03-21', 'alert', true], ['2026-03-29', 'alert', true]]);
  assert.deepEqual(welcome.bands.map((b) => [b.x, b.w, b.lx]), [[327.8, 92.8, 41.6]], 'the gap is shaded across its days');
  const news = rowMarks(l.items, CAL, 'whats_new', { first: false });
  assert.deepEqual(at(news.marks), [['2026-03-10', 'stop', true], ['2026-03-29', 'alert', false]],
    'under the first row a shared line has no glyph; a row’s own still does');
  assert.ok(![...all.marks, ...welcome.marks, ...news.marks].some((m) => m.key.startsWith('2026-04-27')), 'what is due draws no line');
});

// ── 04 · Detail ─────────────────────────────────────────────────────────────

test('sends that never arrived, most first, with why and the last week', () => {
  const l = lostRows(RAW);
  assert.deepEqual(l.rows.map((r) => [r.name, r.reason, r.n, r.last]), [
    ['Welcome', 'failed on our side', 3, 'week of Mar 16'],
    ['First nudge', 'bounced', 2, 'week of Apr 6'],
    ['What’s new', 'no delivery report after 3 days', 2, 'week of Mar 2'],
  ]);
  assert.equal(l.count, '7 since Mar 2');
  assert.equal(l.rows[0].max, 3);
  assert.equal(lostRows({ ...RAW, lost: [] }).count, 'none since Mar 2');
});

test('every line under test: by email, subject before body, in arm order, and whether it still runs', () => {
  const a = armRows(RAW);
  assert.deepEqual(a.rows.map((r) => [r.name, r.factor, r.arm, r.ran, r.live]), [
    ['Welcome', 'subject', 's1', 'Mar 3 to 20', false],
    ['First nudge', 'subject', 's2', 'since Mar 2', true],
    ['First nudge', 'subject', 's10', 'since Mar 9', true],
    ['First nudge', 'body', 'b1', 'since Mar 2', true],
  ]);
  assert.equal(a.count, '4 lines across 2 emails');
  const [w, , , b1] = a.rows;
  assert.deepEqual(w.opened, { r: null, n: 0 }, 'nothing delivered: no rate, rather than 0%');
  assert.deepEqual(w.back, { r: 0, n: 0 });
  near(b1.opened.r, 8 / 19);
  near(b1.back.r, 3 / 20, 'back in a day is per send');
  assert.equal(armRows({ ...RAW, arms: RAW.arms.slice(3) }).count, '1 line across 1 email');
  assert.equal(armRows({ ...RAW, arms: [] }).count, 'none in view');
});

test('opens by mailbox, the rest last, and a small line of each one’s weeks', () => {
  const m = mailboxRows(RAW);
  assert.deepEqual(m.rows.map((r) => [r.name, r.delivered, pctText(r.rate), pctText(r.before), pctText(r.after)]), [
    ['Gmail', 101, '44%', '50%', '34%'],
    ['iCloud', 29, '76%', '75%', '77%'],
    ['Everything else', 14, '36%', '50%', '17%'],
  ]);
  assert.equal(m.count, 'from Mar 2');
  const s = sparkPath([{ delivered: 0, opened: 0 }, { delivered: 10, opened: 5 }, { delivered: 5, opened: 5 }, { delivered: 0, opened: 0 }, { delivered: 20, opened: 10 }]);
  assert.equal(s.d, 'M36,11L60,2L108,11');
  assert.deepEqual(s.dots.map((d) => [d.i, d.thin]), [[1, false], [2, true], [4, false]]);
  assert.deepEqual(sparkPath([{ delivered: 4, opened: 1 }]).d, '', 'one point is not a line');
});

// ── The record of what changed ──────────────────────────────────────────────

test('the record holds words and days only, about emails the page knows', () => {
  const kinds = new Set(CHANGE_KINDS.map((k) => k.kind));
  const types = new Set(EMAILS.map((e) => e.type));
  const DAYS = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}(?: to \d{1,2})?\b/g;
  for (const c of EMAIL_CHANGES) {
    assert.match(c.day, /^\d{4}-\d{2}-\d{2}$/, `${c.label}: a UTC day`);
    assert.ok(kinds.has(c.kind), `${c.label}: a kind the page draws`);
    assert.ok(c.label, 'every entry says what happened');
    for (const t of c.types || []) assert.ok(types.has(t), `${c.label}: ${t} is an email the page lists`);
    if (c.until) assert.ok(c.until >= c.day, `${c.label}: ends after it starts`);
    if (c.figure) assert.ok(['welcome_gap', 'split', 'held'].includes(c.figure), `${c.label}: a figure the page can work out`);
    if (c.kind === 'due') assert.ok(c.short, `${c.label}: a due entry has a short name for the band`);
    // A count, a rate or a threshold is worked out from the read, never typed here.
    // "3 unopened" is the rule itself (0359), not a measurement of it.
    for (const words of [c.label, c.sub, c.short].filter(Boolean)) {
      const left = words.replace(DAYS, '').replace('3 unopened', '');
      assert.doesNotMatch(left, /[\d%]/, `"${words}" carries no number`);
    }
  }
  const splits = EMAIL_CHANGES.filter((c) => c.split);
  assert.equal(splits.length, 1, 'one day the opens are compared across');
  assert.equal(SPLIT_DAY, splits[0].day);
  assert.ok(EMAIL_CHANGES.some((c) => c.figure === 'welcome_gap' && c.until && c.types.includes('welcome_board')),
    'the welcome gap is a span on the welcome, which is how the welcome foot finds it');
});

test('each kind of change draws its own shape', () => {
  const shapes = CHANGE_KINDS.map((k) => glyphFor(MARK_KIND[k.kind]));
  assert.ok(shapes.every((g) => Object.values(GLYPH).includes(g)));
  assert.equal(new Set(shapes).size, shapes.length, 'no two kinds share a glyph');
  assert.equal(glyphFor('due'), '○');
});
