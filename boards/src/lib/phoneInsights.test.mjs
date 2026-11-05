// phoneInsights.test.mjs — the phone admin's highlight rules (phoneInsights.js).
//
//   node --test src/lib/phoneInsights.test.mjs
//
// What this guards (every input is invented; the clock is a fixed `now`):
//   * week flags come from the RPC (weekState), labels span months, a null week
//     stays a gap in weekPoints;
//   * H0 clause: only active people / real work / cards, >= 15% and a previous
//     figure >= 15, the largest move wins;
//   * H1 search: the three ratio bands, the three clicks clauses, the jump rule
//     (fires and does not), a missing day in the last 14 falls back, '/' is kept
//     out of every figure, place is impression-weighted;
//   * H2: the >= 6-weeks-back rule both ways, 'in N weeks', small-n counts;
//   * H3 thresholds and fallback, multiple formatting; H4 beats-all / fallback /
//     the partial first week left out; sources top 7 + rest, Google found by key;
//     heat busiest and ties; maskEmail edges; the three checkout tiles; the
//     pending Got started tile; the measure sheet's table;
//   * no model output string contains NaN, undefined or Infinity for empty input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weekState, weekLabel, weekPoints, maskEmail, mastModel, leadModel, todayModel, tileModels, TILES_CAPTION,
  searchModel, searchChart, startModel, returnModel, shareModel, sourcesModel, heatModel, newestRows,
  lookModel, indexModel, measureSheet,
} from './phoneInsights.js';

const NOW = new Date('2026-11-04T14:00:00Z'); // Wed Nov 4 2026, 9:00 AM in New York

// ── helpers ──────────────────────────────────────────────────────────────────

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const mon = (i) => iso(Date.UTC(2026, 4, 4 + 7 * i)); // May 4 2026 is a Monday
const day = (last, back) => iso(Date.parse(`${last}T00:00:00Z`) - back * 86400000);

// n weekly rows, oldest first: all done but the second-last (settling) and the last (open).
function weeks(n, f = () => ({})) {
  return Array.from({ length: n }, (_, i) => ({
    week_start: mon(i), complete: i < n - 1, settling: i === n - 2,
    signups: 10 + i, active_users: 20 + i, active_measurable: true, work_users: 5 + i, work_measurable: true, cards: 100 + i,
    ...f(i, n),
  }));
}

// Search rows ending at `last`: views[k] / clicks[k] for the k-th day from the oldest. A null entry leaves the day out.
function search(last, views, clicks, { pos = 10, home = [] } = {}) {
  const rows = [];
  views.forEach((v, k) => {
    if (v == null) return;
    const d = day(last, views.length - 1 - k);
    rows.push({ path: '/a', day: d, clicks: clicks[k], impressions: v, position: pos });
    if (home[k] != null) rows.push({ path: '/', day: d, clicks: home[k], impressions: home[k] * 20, position: 1 });
  });
  return rows;
}
const flat = (n, v) => Array.from({ length: n }, () => v);

function strings(x, out = []) {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) x.forEach((y) => strings(y, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((y) => strings(y, out));
  return out;
}

// ── week basics ──────────────────────────────────────────────────────────────

test('weekState follows the RPC flags only', () => {
  assert.equal(weekState({ complete: false, settling: true }), 'open');
  assert.equal(weekState({ complete: true, settling: true }), 'settling');
  assert.equal(weekState({ complete: true, settling: false }), 'done');
  assert.equal(weekState(null), 'open');
});

test('weekLabel spans a month and marks the state', () => {
  assert.equal(weekLabel('2026-10-12', 'done'), 'Oct 12 – 18');
  assert.equal(weekLabel('2026-09-28', 'done'), 'Sep 28 – Oct 4');
  assert.equal(weekLabel('2026-10-12', 'settling'), 'Oct 12 – 18 · settling');
  assert.equal(weekLabel('2026-10-12', 'open'), 'Oct 12 – 18 · so far');
  assert.equal(weekLabel('nope', 'done'), '');
});

test('weekPoints keeps a null week as a gap, not zero', () => {
  const rows = weeks(4, (i) => (i === 1 ? { active_users: null } : {}));
  const pts = weekPoints(rows, 'active_users');
  assert.equal(pts.length, 4);
  assert.equal(pts[1].v, null);
  assert.equal(pts[0].v, 20);
  assert.deepEqual(pts.map((p) => p.state), ['done', 'done', 'settling', 'open']);
  assert.equal(pts[3].label, `${weekLabel(mon(3), 'open')}`);
  assert.equal(weekPoints(rows, (r) => r.cards * 2)[0].v, 200);
  // an unmeasurable week is a gap too
  assert.equal(weekPoints([{ ...rows[0], active_measurable: false }], 'active_users')[0].v, null);
});

// ── masked email, masthead ───────────────────────────────────────────────────

test('maskEmail keeps 3 letters, one for short names, and never fails', () => {
  assert.equal(maskEmail('andrew@example.com'), 'and…@example.com');
  assert.equal(maskEmail('abc@example.com'), 'a…@example.com');
  assert.equal(maskEmail('x@example.com'), 'x…@example.com');
  assert.equal(maskEmail('abcd@example.com'), 'abc…@example.com');
  assert.equal(maskEmail(''), 'someone');
  assert.equal(maskEmail(null), 'someone');
  assert.equal(maskEmail('no-at-sign'), 'someone');
  assert.equal(maskEmail('@example.com'), 'someone');
});

test('mastModel reads New York time', () => {
  assert.deepEqual(mastModel(NOW), { date: 'Wednesday, November 4', clock: '9:00 AM' });
  assert.deepEqual(mastModel(new Date('nope')), { date: '', clock: '' });
});

// ── H0 ───────────────────────────────────────────────────────────────────────

test('leadModel picks the largest notable move and filters weak candidates', () => {
  const kpi = {
    current: { signups: 30, wau: 80, work_users: 30, cards_created: 100 },
    previous: { signups: 20, wau: 100, work_users: 20, cards_created: 100 },
  };
  const m = leadModel(kpi, weeks(5));
  // wau -20%, work +50%: work wins
  assert.equal(m.clause, 'People doing real work are up 50%: 30 against 20.');
  assert.equal(m.valueText, '30');
  assert.equal(m.delta.text, '▲ 50%');

  const down = leadModel({ current: { wau: 40 }, previous: { wau: 50 } }, []);
  assert.equal(down.clause, 'Active people are down 20%: 40 against 50.');

  // previous under 15: no clause; change under 15%: no clause
  assert.equal(leadModel({ current: { wau: 10 }, previous: { wau: 5 } }, []).clause, '');
  assert.equal(leadModel({ current: { cards_created: 110 }, previous: { cards_created: 100 } }, []).clause, '');
  // signups is never a candidate
  assert.equal(leadModel({ current: { signups: 90 }, previous: { signups: 20 } }, []).clause, '');
});

test('leadModel notes: peak among settled weeks, and the open point', () => {
  const rows = weeks(8, (i) => ({ signups: [5, 9, 30, 12, 8, 7, 11, 4][i] }));
  const m = leadModel({}, rows);
  assert.equal(m.pts.length, 8);
  assert.deepEqual(m.notes[0], { i: 2, lines: ['30 signups', `week of ${weekLabel(mon(2), 'done').split(' –')[0]}`] });
  assert.deepEqual(m.notes[1], { i: 7, lines: ['4 so far', 'this week'] });
  assert.match(m.caption, /^Signups a week, 8 weeks to /);
  // an open week higher than everything is not the peak
  const high = leadModel({}, weeks(6, (i) => ({ signups: [3, 4, 50, 5, 6, 99][i] })));
  assert.equal(high.notes[0].i, 2);
});

test('leadModel notes: a peak right beside the open point is left unannotated', () => {
  // the settling week is the peak (index 6, open at 7): one note only
  const m = leadModel({}, weeks(8, (i) => ({ signups: [5, 9, 12, 12, 8, 7, 40, 4][i], settling: i === 6 })));
  assert.equal(m.notes.length, 1);
  assert.equal(m.notes[0].i, 7);
  // two weeks apart is clear of it
  const far = leadModel({}, weeks(8, (i) => ({ signups: [5, 9, 12, 12, 8, 40, 7, 4][i] })));
  assert.deepEqual(far.notes.map((n) => n.i), [5, 7]);
});

// ── Today strip ──────────────────────────────────────────────────────────────

test('todayModel: pace, usual day, paying and money', () => {
  const ws = weeks(8, () => ({ signups: 70 })); // 4 complete weeks of 70 -> 10 a day
  const signups = [{ created_at: new Date(NOW.getTime() - 1000).toISOString() }];
  const m = todayModel({ signups, weeks: ws, active: 14, stats: { sub_counts: { active: 138 }, mrr_cents: 123456 }, moneyPeople: { paying: 136 }, now: NOW });
  assert.equal(m.usual, 10);
  assert.equal(m.active, 14);
  assert.equal(m.paying, 136); // admin_money_people.paying, not stats.sub_counts.active
  assert.equal(m.money, '$1,235 a month');
  assert.equal(m.pace, m.signupsToday / 10);
  const none = todayModel({ signups: [], weeks: [], active: null, stats: null, now: NOW });
  assert.equal(none.pace, null);
  assert.equal(none.money, '');
  assert.equal(none.paying, null);
  assert.equal(todayModel({ stats: { sub_counts: { active: 138 } }, now: NOW }).paying, null);
});

// ── tiles ────────────────────────────────────────────────────────────────────

const KPI = {
  current: { signups: 30, wau: 50, work_users: 20, cards_created: 200, checkout_success: 2, checkout_open: 5 },
  previous: { signups: 20, wau: 50, work_users: 25, cards_created: 100, checkout_success: 1, checkout_open: 4 },
};

function dayOneRows(acts, n = 20, tail = 2) {
  return acts.map((a, i) => ({
    week_start: mon(i), day_one_n: n, day_one_activated: a, day_one_complete: i < acts.length - tail,
    complete: i < acts.length - 1, settling: false,
  }));
}

test('tileModels: six tiles in MEASURES order, counts with 12-week sparks that skip the open week', () => {
  const ws = weeks(16);
  const t = tileModels(KPI, ws, dayOneRows([10, 11, 12, 13]));
  assert.deepEqual(t.map((x) => x.id), ['signups', 'activation_rate', 'wau', 'work_users', 'cards_created', 'checkouts']);
  const s = t[0];
  assert.equal(s.value, '30');
  assert.equal(s.delta.text, '▲ 50%');
  assert.equal(s.vs, 'vs 20');
  assert.equal(s.spark.vals.length, 12);
  assert.equal(s.spark.vals.at(-1), 10 + 14); // week 14 is the settling one; week 15 (open) is not charted
  assert.equal(s.spark.pct, false);
  assert.equal(t[2].spark.vals.at(-1), 20 + 14);
  assert.equal(t[3].delta.dir, 'down');
  assert.equal(TILES_CAPTION.startsWith('Numbers: the last 7 days against the 7 before;'), true);
});

test('tileModels: Got started follows H2, and is pending until growth loads', () => {
  // complete weeks 0..2 (tail 2): rates 50%, 60%, 70%
  const g = dayOneRows([10, 12, 14, 15, 16]);
  const tile = tileModels(KPI, [], g)[1];
  assert.equal(tile.value, '70%');
  assert.equal(tile.sub, 'made something on day one');
  assert.equal(tile.delta.text, '▲ 10 pts');
  assert.equal(tile.vs, `week of ${weekLabel(mon(2), 'done').split(' –')[0]}`);
  assert.deepEqual(tile.spark.vals, [0.5, 0.6, 0.7]);
  assert.equal(tile.spark.pct, true);
  assert.equal(tile.pending, false);

  const pending = tileModels(KPI, [], undefined)[1];
  assert.equal(pending.pending, true);
  assert.equal(pending.value, '');

  const failed = tileModels(KPI, [], null)[1];
  assert.equal(failed.pending, false);
  assert.equal(failed.value, '—');

  const small = tileModels(KPI, [], dayOneRows([10, 12, 9, 9, 9], 12))[1];
  assert.equal(small.value, '9 of 12');
  assert.equal(small.delta.text, '');
});

test('tileModels: the three checkout variants', () => {
  const k = (cs, co, ps, po) => ({ current: { checkout_success: cs, checkout_open: co }, previous: { checkout_success: ps, checkout_open: po } });
  const idle = tileModels(k(0, 0, 0, 0), [], [])[5];
  assert.equal(idle.value, 'none');
  assert.equal(idle.sub, 'none started');
  assert.equal(idle.vs, 'last 14 days');
  assert.deepEqual(idle.spark, { vals: [], pct: false, dashedFlat: true });

  const quiet = tileModels(k(0, 0, 3, 4), [], [])[5];
  assert.equal(quiet.value, 'none');
  assert.equal(quiet.vs, '3 of 4 the 7 before');
  assert.equal(quiet.spark, null);

  const busy = tileModels(k(2, 5, 1, 4), [], [])[5];
  assert.equal(busy.value, '2 of 5');
  assert.equal(busy.vs, 'vs 1 of 4');
  // 5 and 4 opened are a handful: the counts are in vs, no change pill.
  assert.equal(busy.delta.text, '');
  assert.equal(busy.spark, null);

  // The pill is the change in the share finished, in points: 30/60 = 50% against 20/50 = 40%.
  const big = tileModels(k(30, 60, 20, 50), [], [])[5];
  assert.equal(big.value, '30 of 60');
  assert.equal(big.vs, 'vs 20 of 50');
  assert.equal(big.delta.text, '▲ 10 pts');
  assert.equal(big.delta.dir, 'up');
});

test('tileModels: the checkout pill is points of the share finished, and needs both windows at SMALL_N opened', () => {
  const k = (cs, co, ps, po) => ({ current: { checkout_success: cs, checkout_open: co }, previous: { checkout_success: ps, checkout_open: po } });
  const pill = (...a) => tileModels(k(...a), [], [])[5].delta;
  // 41 of 64 against 33 of 58: 64% against 57%.
  assert.deepEqual(pill(41, 64, 33, 58), { text: '▲ 7 pts', dir: 'up' });
  // More finished than before, but a smaller share of what opened: down, not up.
  assert.deepEqual(pill(40, 100, 30, 50), { text: '▼ 20 pts', dir: 'down' });
  assert.deepEqual(pill(30, 60, 25, 50), { text: 'same', dir: 'flat' });
  // Either window under SMALL_N opened: no pill, the vs line has both counts.
  assert.equal(pill(10, 14, 5, 40).text, '');
  assert.equal(pill(20, 40, 5, 14).text, '');
  assert.equal(pill(15, 15, 10, 15).text, '▲ 33 pts');
  assert.equal(tileModels(k(20, 40, 5, 14), [], [])[5].vs, 'vs 5 of 14');
  // No previous window at all: no pill.
  assert.equal(pill(20, 40, null, null).text, '');
  assert.equal(pill(20, 40, 5, null).text, '');
  // None opened this week: never a pill, the vs line says the week before.
  const quiet = tileModels(k(0, 0, 30, 40), [], [])[5];
  assert.deepEqual(quiet.delta, { text: '', dir: 'flat' });
  assert.equal(quiet.vs, '30 of 40 the 7 before');
});

// ── H1 search ────────────────────────────────────────────────────────────────

const LAST = '2026-11-01';
// 28 days: the 7 before at `pv`, the 7 after at `lv`; clicks likewise.
function band(pv, lv, pc, lc, extra = {}) {
  const views = [...flat(21, pv), ...flat(7, lv)];
  const clicks = [...flat(21, pc), ...flat(7, lc)];
  return searchModel(search(LAST, views, clicks, extra));
}

test('searchModel head: all three ratio bands', () => {
  assert.equal(band(100, 250, 10, 10).head, 'Google shows our pages 2.5× as often');
  assert.equal(band(100, 50, 10, 10).head, 'Google shows our pages 50% less often');
  assert.equal(band(100, 120, 10, 10).head, 'Google shows our pages about 120 times a day');
  const m = band(100, 250, 10, 10);
  assert.equal(m.ok, true);
  assert.equal(m.lastDay, LAST);
  assert.equal(m.lastLabel, 'Nov 1');
  assert.match(m.sub, /^250 views a day in the last 7 days, up from 100 the 7 before\./);
});

test('searchModel sub: equal days say "level with"; near-equal days take a decimal so they never read the same', () => {
  assert.match(band(100, 100, 10, 10).sub, /^100 views a day in the last 7 days, level with 100 the 7 before\./);
  assert.match(band(100, 80, 10, 10).sub, /^80 views a day in the last 7 days, down from 100 the 7 before\./);
  // 9 a day against 8.86: both round to 9, so both show a decimal
  const views = [...flat(14, 9), 9, 9, 9, 9, 9, 9, 8, ...flat(7, 9)];
  const m = searchModel(search(LAST, views, [...flat(21, 10), ...flat(7, 12)]));
  assert.match(m.sub, /^9\.0 views a day in the last 7 days, up from 8\.9 the 7 before\./);
  assert.match(m.caption, /clicks 12 a day against 10\.$/);
  const near = searchModel(search(LAST, views, [...flat(14, 10), 10, 10, 10, 10, 10, 10, 9, ...flat(7, 10)]));
  assert.match(near.caption, /clicks 10\.0 a day against 9\.9\.$/);
});

test('searchModel sub: the three clicks clauses', () => {
  assert.match(band(100, 250, 10, 11).sub, /Clicks have not followed yet\.$/);
  assert.match(band(100, 100, 10, 20).sub, /Clicks are up 100%\.$/);
  assert.match(band(100, 100, 20, 10).sub, /Clicks are down 50%\.$/);
  assert.match(band(100, 105, 10, 10).sub, /Clicks held at about 10 a day\.$/);
  // views up by a lot and clicks up by a lot: plain "up", not "not followed"
  assert.match(band(100, 250, 10, 30).sub, /Clicks are up 200%\.$/);

  // views up and clicks clearly down: the drop is said, not hidden as "not followed"
  assert.match(band(100, 250, 20, 10).sub, /Clicks are down 50%\.$/);
  // a whole multiple drops its ".0"
  assert.equal(band(100, 200, 10, 10).head, 'Google shows our pages 2× as often');
});

test('searchModel caption names place, clicks and the date', () => {
  const m = band(100, 250, 10, 14, { pos: 8 });
  assert.match(m.caption, /^Times a page of ours was shown in Google, a day, not counting the home page, to Nov 1\./);
  assert.match(m.caption, /Place held at 8\.0; clicks 14 a day against 10\.$/);
  // place moving: 12 -> 9 is up
  const rows = [
    ...search(LAST, flat(21, 100), flat(21, 5), { pos: 12 }).filter((r) => r.day <= day(LAST, 7)),
    ...search(LAST, flat(7, 100), flat(7, 5), { pos: 9 }).filter((r) => r.day > day(LAST, 7)),
  ];
  const mv = searchModel(rows);
  assert.match(mv.caption, /Place moved up from 12\.0 to 9\.0;/);
  const slip = searchModel([
    ...search(LAST, flat(21, 100), flat(21, 5), { pos: 9 }).filter((r) => r.day <= day(LAST, 7)),
    ...search(LAST, flat(7, 100), flat(7, 5), { pos: 12 }).filter((r) => r.day > day(LAST, 7)),
  ]);
  assert.match(slip.caption, /Place slipped from 9\.0 to 12\.0;/);
});

test('searchModel chart: 28 bars, last 7 now, newest 3 open, two mean refs', () => {
  const m = band(100, 250, 10, 10);
  const { bars, refs } = m.chart;
  assert.equal(bars.length, 28);
  assert.deepEqual(bars.slice(0, 21).map((b) => b.tone), flat(21, 'before'));
  assert.deepEqual(bars.slice(21).map((b) => b.tone), flat(7, 'now'));
  assert.deepEqual(bars.map((b) => b.open), [...flat(25, false), ...flat(3, true)]);
  assert.deepEqual(refs, [{ v: 100, i0: 14, i1: 20 }, { v: 250, i0: 21, i1: 27 }]);
  assert.equal(bars.at(-1).key, LAST);
  // the page can ask for the whole range or another field
  assert.equal(searchChart(m, 'all').bars.length, 28);
  assert.equal(searchChart(m, 10, 'clicks').bars.length, 10);
  assert.equal(searchChart(m, 10, 'clicks').bars.at(-1).v, 10);
});

test('searchModel jump: fires on the day with the biggest rise at 1.5x the mean before it', () => {
  const views = flat(28, 100);
  views[25] = 400; // 3 days from the end
  const m = searchModel(search(LAST, views, flat(28, 5)));
  assert.equal(m.jump.day, day(LAST, 2));
  assert.deepEqual(m.chart.vrule, { i: 25, lines: ['Oct 30: views jump'] });
  // two spikes: the larger rise wins
  const two = flat(28, 100);
  two[20] = 300;
  two[26] = 500;
  assert.equal(searchModel(search(LAST, two, flat(28, 5))).jump.day, day(LAST, 1));
});

test('searchModel jump: does not fire below 1.5x or outside the newest 14', () => {
  const soft = flat(28, 100);
  soft[25] = 140;
  assert.equal(searchModel(search(LAST, soft, flat(28, 5))).jump, null);
  const old = flat(28, 100);
  old[5] = 900;
  const m = searchModel(search(LAST, old, flat(28, 5)));
  assert.equal(m.jump, null);
  assert.equal(m.chart.vrule, null);
});

test('searchModel: a missing day in the last 14 falls back to plain wording', () => {
  const views = flat(28, 100);
  views[22] = null;
  const m = searchModel(search(LAST, views, flat(28, 5)));
  assert.equal(m.ok, false);
  assert.equal(m.head, 'Google showed our pages about 100 times a day');
  assert.equal(m.sub, '');
  assert.equal(m.jump, null);
  assert.equal(m.chart.refs.length, 0);
  assert.equal(m.days[22].views, null); // a gap, not a zero
  assert.equal(m.days.length, 28);
  // a gap is kept out of the mean
  const spiky = flat(28, 100);
  spiky[22] = null;
  spiky[26] = 200;
  assert.equal(searchModel(search(LAST, spiky, flat(28, 5))).views.last, (100 * 5 + 200) / 6);
});

test('searchModel keeps the home page out of every figure and weights place by views', () => {
  const rows = [
    { path: '/', day: LAST, clicks: 500, impressions: 9000, position: 1 },
    { path: '/a', day: LAST, clicks: 2, impressions: 10, position: 4 },
    { path: '/b', day: LAST, clicks: 1, impressions: 30, position: 8 },
    { path: '/c', day: LAST, clicks: 0, impressions: 10, position: null },
  ];
  const m = searchModel(rows);
  assert.equal(m.days.at(-1).views, 50);
  assert.equal(m.days.at(-1).clicks, 3);
  assert.equal(m.days.at(-1).place, (4 * 10 + 8 * 30) / 40);
  assert.deepEqual(m.home, { clicks: 500, views: 9000, ctr: 500 / 9000, place: 1 });
  assert.deepEqual(m.tiles.map((t) => t.value), ['3', '50', '6.0%', '7.0']);
  assert.deepEqual(m.topPages.map((p) => p.path), ['/a', '/b', '/c']);
  assert.equal(m.topPages[1].place, 8);
  assert.equal(m.topPages[2].place, null);
  assert.equal(m.pagesShown, 3);
  assert.equal(m.clicks7, 3);
  // not enough days for the comparison
  assert.equal(m.ok, false);
});

test('searchModel with a day that only has home rows still counts the day as present', () => {
  const m = searchModel([
    { path: '/a', day: '2026-10-30', clicks: 1, impressions: 10, position: 3 },
    { path: '/', day: '2026-10-31', clicks: 1, impressions: 10, position: 1 },
  ]);
  assert.equal(m.days.length, 2);
  assert.equal(m.days[1].views, 0);
});

// ── H2 getting started ───────────────────────────────────────────────────────

// All weeks complete (tail 0). n = 20 per week, so a rate is act * 5 percent.
const acts = (a) => dayOneRows(a, 20, 0);

test('startModel: lowest since, only when the earlier week at or below is >= 6 weeks back', () => {
  // newest 9 (45%), before it 12 (60%); a week at 8 sits 9 weeks back
  const far = startModel(acts([8, 12, 12, 12, 12, 12, 12, 12, 12, 9]));
  assert.equal(far.mode, 'rate');
  assert.equal(far.head, `45% made something on day one, the lowest since the week of ${weekLabel(mon(0), 'done').split(' –')[0]}`);
  assert.equal(far.dek.startsWith(`9 of the 20 people who signed up ${weekLabel(mon(9), 'done')}, down from 60% the week before`), true);
  // the same, but the week at or below is only 4 weeks back: no extreme
  const near = startModel(acts([12, 12, 12, 12, 12, 8, 12, 12, 12, 9]));
  assert.equal(near.head, '45% made something on day one');
  assert.equal(near.extreme, '');
});

test('startModel: highest mirrors, and "in N weeks" needs 6', () => {
  const hi = startModel(acts([17, 8, 8, 8, 8, 8, 8, 8, 8, 12, 16]));
  assert.equal(hi.head, `80% made something on day one, the highest since the week of ${weekLabel(mon(0), 'done').split(' –')[0]}`);
  assert.match(hi.dek, /up from 60% the week before\.$/);
  const inN = startModel(acts([14, 15, 13, 12, 12, 11, 9]));
  assert.equal(inN.head, '45% made something on day one, the lowest in 7 weeks');
  const few = startModel(acts([14, 15, 13, 9]));
  assert.equal(few.head, '45% made something on day one');
  // equal: neither
  assert.equal(startModel(acts([8, 12, 12])).extreme, '');
});

test('startModel: under SMALL_N it speaks in counts and claims no extreme', () => {
  const m = startModel(dayOneRows([10, 12, 9], 12, 0).map((r, i) => (i < 2 ? { ...r, day_one_n: 20 } : r)));
  assert.equal(m.mode, 'counts');
  assert.equal(m.head, '9 of 12 made something on day one');
  assert.equal(m.extreme, '');
  assert.equal(m.pts.at(-1).small, true);
});

test('startModel: open weeks are open points; weeks with nobody are gaps', () => {
  const rows = dayOneRows([10, 12, 14, 5, 1], 20, 2);
  rows[1].day_one_n = 0;
  const m = startModel(rows);
  assert.equal(m.pts[1].v, null);
  assert.deepEqual(m.pts.map((p) => p.state), ['done', 'done', 'done', 'open', 'open']);
  assert.equal(m.homePts.length, 3);
  assert.equal(startModel([]).head, '');
  assert.equal(startModel(null).mode, null);
});

// ── H3 coming back ───────────────────────────────────────────────────────────

function ret(n13, r13, n0, r0) {
  return [
    { dim: 'all', n: 200, returned: 50, pct: 0.25 },
    { dim: 'band:0', n: n0, returned: r0, pct: 0 },
    { dim: 'band:1-2', n: 40, returned: 8, pct: 0 },
    { dim: 'band:3-5', n: 30, returned: 9, pct: 0 },
    { dim: 'band:6-12', n: 20, returned: 8, pct: 0 },
    { dim: 'band:13+', n: n13, returned: r13, pct: 0 },
    { dim: 'device:mobile', n: 90, returned: 18, pct: 0 },
    { dim: 'device:desktop', n: 100, returned: 40, pct: 0 },
    { dim: 'source:google', n: 60, returned: 12, pct: 0 },
  ];
}

test('returnModel: the multiple needs both groups >= 15 and a ratio >= 1.5', () => {
  const m = returnModel(ret(20, 12, 80, 8), '2026-08-17'); // 60% against 10%
  assert.equal(m.head, 'People who add 13 or more cards on day one come back 6× as often');
  assert.deepEqual(m.items.map((i) => i.label), ['none', '1–2', '3–5', '6–12', '13+']);
  assert.deepEqual(m.items.map((i) => i.on), [false, false, false, false, true]);
  assert.equal(m.items[0].sub, '80 people');
  assert.equal(m.items[4].v, 0.6);
  assert.equal(m.caption.endsWith('People who joined since Aug 17.'), true);
  // small group, or a weak ratio: the overall figure with its group size
  const small = returnModel(ret(14, 12, 80, 8), '2026-08-17');
  assert.equal(small.head, '25% of new people open the app again within a week');
  assert.equal(small.dek, 'Of 200 people.');
  assert.equal(returnModel(ret(20, 3, 80, 8), '2026-08-17').head.startsWith('25% of new people'), true);
});

test('returnModel: the lollipop axis grows to 100% only when a group passes half', () => {
  assert.equal(returnModel(ret(20, 12, 80, 8), '2026-08-17').yMax, 1); // 13+ at 60%
  assert.equal(returnModel(ret(20, 8, 80, 8), '2026-08-17').yMax, 0.5); // 13+ at 40%
  assert.equal(returnModel(null, null).yMax, 0.5);
});

test('returnModel: the multiple has one decimal with .0 dropped; pct is not trusted', () => {
  assert.equal(returnModel(ret(100, 30, 100, 10), null).head.includes('come back 3× as often'), true);
  assert.equal(returnModel(ret(100, 36, 100, 10), null).head.includes('come back 3.6× as often'), true);
  assert.equal(returnModel(ret(100, 12, 100, 5), null).head.includes('2.4×'), true);
  assert.equal(returnModel(ret(1000, 492, 1000, 200), null).head.includes('2.5×'), true);
  assert.equal(returnModel(ret(1000, 492, 1000, 200), null).caption.includes('since'), false);
});

test('returnModel exposes device and source rows for the Growth page', () => {
  const m = returnModel(ret(20, 12, 80, 8), '2026-08-17');
  assert.deepEqual(m.devices.map((d) => [d.key, d.label, d.v]), [['desktop', 'Computer', 0.4], ['mobile', 'Phone', 0.2]]);
  assert.deepEqual(m.sources.map((d) => d.label), ['Google']);
  assert.equal(returnModel([], null).head, '');
});

// ── H4 sharing ───────────────────────────────────────────────────────────────

function sharing(openN, firstN = 20) {
  return {
    totals: { signed_up: 31, shares: 80 },
    weekly: [
      { week: '2026-10-05', signed_up: firstN },
      { week: '2026-10-12', signed_up: 6 },
      { week: '2026-10-19', signed_up: 4 },
      { week: '2026-10-26', signed_up: 5 },
      { week: '2026-11-02', signed_up: openN },
    ],
    routes: [
      { route: 'view_link', shared: 50, signed_up: 3 },
      { route: 'edit_link', shared: 20, signed_up: 12 },
      { route: 'email_invite', shared: 10, signed_up: 12 },
    ],
  };
}

test('shareModel: beats every full week, with the partial first week left out', () => {
  const m = shareModel(sharing(9), NOW);
  assert.equal(m.head, '9 signups from shares this week so far, more than any of the 3 full weeks before it');
  assert.equal(m.fullWeeks, 3);
  assert.equal(m.sub, 'Edit link brought the most in 30 days: 12');
  // The partial first week is off the chart as well as out of the comparison.
  assert.equal(m.bars.length, 4);
  assert.equal(m.bars[0].key, '2026-10-12');
  assert.equal(m.bars.at(-1).open, true);
  assert.equal(m.bars.at(-1).label.endsWith(' · so far'), true);
  assert.equal(m.bars[0].open, false);
});

test('shareModel: falls back to the 30-day total', () => {
  assert.equal(shareModel(sharing(6), NOW).head, '31 signups from shares in the last 30 days'); // ties are not beating
  assert.equal(shareModel(sharing(0), NOW).head, '31 signups from shares in the last 30 days');
  assert.equal(shareModel({ totals: { signed_up: 1 }, weekly: [] }, NOW).head, '1 signup from shares in the last 30 days');
  assert.equal(shareModel(null, NOW).head, '');
});

// ── sources ──────────────────────────────────────────────────────────────────

test('sourcesModel: top 7 plus the rest, Google found by key', () => {
  const names = ['direct', 'reddit', 'google', 'chatgpt', 'bing', 'x', 'tiktok', 'youtube', 'perplexity'];
  const rows = names.map((s, i) => ({ source: s, signups: 100 - i * 10, converted: 0 })).reverse();
  const m = sourcesModel(rows, (t) => t.toUpperCase());
  assert.equal(m.items.length, 8);
  assert.equal(m.items[0].label, 'DIRECT');
  assert.deepEqual(m.items.at(-1), { key: '_rest', label: '2 smaller sources', n: 30 + 20 });
  assert.equal(m.total, 100 + 90 + 80 + 70 + 60 + 50 + 40 + 30 + 20);
  assert.equal(m.googlePct, 80 / m.total);
  assert.match(m.dek, /^Google sent 15% of 540 signups/);
  // no Google row: not borrowed from the top
  const none = sourcesModel([{ source: 'direct', signups: 5 }], (t) => t);
  assert.equal(none.googlePct, null);
  assert.equal(none.dek, '5 signups in the last 30 days.');
  assert.equal(sourcesModel([{ source: 'google', signups: 3 }], (t) => t).items.length, 1);
});

// ── heat ─────────────────────────────────────────────────────────────────────

test('heatModel: busiest cell, earliest on a tie, and the title wording', () => {
  const rows = [
    { dow: 1, hour: 9, events: 50, actors: 4 },
    { dow: 2, hour: 14, events: 90, actors: 7 },
    { dow: 5, hour: 14, events: 90, actors: 7 },
    { dow: 7, hour: 0, events: 1, actors: 1 },
    { dow: 3, hour: 11, events: 1, actors: 0 },
  ];
  const m = heatModel(rows);
  assert.deepEqual(m.busiest, { dow: 2, hour: 14, n: 7 });
  assert.equal(m.text, 'Busiest: Tuesday at 2 pm');
  const tue = m.cells.find((c) => c.dow === 2 && c.hour === 14);
  assert.equal(tue.title, '7 different people, Tuesdays 2–3 pm, last 30 days');
  assert.equal(m.cells.find((c) => c.dow === 3 && c.hour === 11).title, '0 different people, Wednesdays 11 am–12 pm, last 30 days');
  assert.equal(m.cells.find((c) => c.dow === 7).title, '1 person, Sundays 12–1 am, last 30 days');
  assert.equal(heatModel([]).text, '');
  assert.equal(heatModel([{ dow: 1, hour: 0, actors: 0 }]).busiest, null);
});

// ── newest, look, index ──────────────────────────────────────────────────────

test('newestRows: five masked rows with what they did', () => {
  const ago5 = new Date(NOW.getTime() - 5 * 60000).toISOString();
  const rows = Array.from({ length: 7 }, (_, i) => ({
    user_id: `u${i}`, email: `person${i}@example.com`, created_at: ago5, acquisition_source: 'google',
    clusters_made: i === 0 ? 2 : 0, first_card_at: i === 1 ? ago5 : null,
  }));
  const out = newestRows(rows, NOW, (t) => `via ${t}`);
  assert.equal(out.length, 5);
  assert.deepEqual(out[0], { id: 'u0', who: 'per…@example.com', from: 'via google', did: 'made a cluster', ago: '5 min' });
  assert.equal(out[1].did, 'made a card');
  assert.equal(out[2].did, 'nothing yet');
});

test('lookModel: approvals only above 0, crash browsers, near the card limit', () => {
  const full = lookModel({
    boards: 3, approvals: 2,
    errors: { totals: { new: 4, crash_people: 2 } },
    moneyPeople: { near_cap: { people: 9, active_7d: 5 } },
  });
  assert.deepEqual(full.map((r) => r.key), ['boards', 'approvals', 'errors', 'near_cap']);
  assert.equal(full[2].sub, '2 browsers hit a crash');
  assert.equal(full[2].warn, true);
  assert.equal(full[3].n, 5);
  assert.equal(full[3].sub, 'of 9 near it in all');
  const quiet = lookModel({ boards: 0, approvals: 0, errors: { totals: { new: 0, crash_people: 0 } }, moneyPeople: null });
  assert.deepEqual(quiet.map((r) => r.key), ['boards', 'errors']);
  assert.equal(quiet[1].sub, '');
  assert.deepEqual(lookModel({}), []);
});

test('indexModel: seven rows, blank text when the data is missing', () => {
  const search = band(100, 100, 10, 10);
  const rows = indexModel({
    lifetime: { users: 1234 }, search, stats: { mrr_cents: 50000 },
    share: { totals: { shares: 12 } }, sources: sourcesModel([{ source: 'google', signups: 3 }, { source: 'direct', signups: 1 }]),
    errors: { totals: { new: 2 } }, email: [{ sent: 10 }, { sent: 5 }],
  });
  assert.deepEqual(rows.map((r) => r.id), ['growth', 'search', 'money', 'sharing', 'sources', 'problems', 'emails']);
  assert.deepEqual(rows.map((r) => r.text), [
    '1,234 people', '70 clicks, 7 days', '$500 a month', '12 shares, 30 days', 'Google 75%', '2 new', '15 sent, 7 days',
  ]);
  assert.deepEqual(indexModel({}).map((r) => r.text), ['', '', '', '', '', '', '']);
});

// ── measure sheets ───────────────────────────────────────────────────────────

test('measureSheet: 8 newest done or settling weeks, settling marked, open week in the points', () => {
  const ws = weeks(30);
  const s = measureSheet('signups', { weeks: ws, kpi: KPI }, '12w');
  assert.equal(s.title, 'Signups');
  assert.equal(s.pts.length, 12);
  assert.equal(s.pts.at(-1).state, 'open');
  assert.equal(measureSheet('signups', { weeks: ws, kpi: KPI }, '26w').pts.length, 26);
  assert.equal(s.table.length, 8);
  assert.equal(s.table[0].state, 'settling');
  assert.equal(s.table[0].label, weekLabel(mon(28), 'settling'));
  assert.equal(s.table[0].value, String(10 + 28));
  assert.equal(s.table[1].state, 'done');
  assert.equal(s.tile.id, 'signups');
  assert.match(s.caption, /the 7 before \(20\)\.$/);
});

test('measureSheet: Got started uses the day-one weeks; checkouts has no series', () => {
  const g = dayOneRows([10, 12, 14, 15, 16, 18, 4, 5, 6, 7, 8, 9], 20, 2);
  const st = measureSheet('activation_rate', { growth: g, kpi: KPI }, '12w');
  assert.equal(st.pts.length, 10); // the 2 unfinished weeks are left off
  assert.ok(st.pts.every((p) => p.state !== 'open'));
  assert.ok(!st.caption.includes('hollow'));
  assert.equal(st.table.length, 8);
  assert.equal(st.table[0].value, '35%'); // 7/20, the newest day-one-complete week
  assert.equal(st.sub, 'made something on day one');
  const co = measureSheet('checkouts', { kpi: KPI }, '12w');
  assert.equal(co.pts, null);
  assert.deepEqual(co.lines, ['2 of 5 checkouts finished, last 7 days', '1 of 4 the 7 before']);
  assert.equal(co.tile.delta.text, '');
  // the sheet shows the same tile as the home row, so the same pill
  const bigCo = measureSheet('checkouts', { kpi: { current: { checkout_success: 41, checkout_open: 64 }, previous: { checkout_success: 33, checkout_open: 58 } } }, '12w');
  assert.equal(bigCo.tile.delta.text, '▲ 7 pts');
  assert.equal(measureSheet('nope', {}, '12w'), null);
});

// ── no NaN / undefined, ever ─────────────────────────────────────────────────

test('no model output contains NaN, undefined or Infinity for empty or null inputs', () => {
  const empties = [undefined, null, [], {}];
  const outs = [];
  for (const e of empties) {
    outs.push(
      leadModel(e, e), todayModel({ signups: e, weeks: e, active: e, stats: e, now: NOW }), tileModels(e, e, e),
      tileModels(e, e, []), searchModel(e), startModel(e), returnModel(e, e), shareModel(e, NOW),
      sourcesModel(e), heatModel(e), newestRows(e, NOW), lookModel({ boards: e, approvals: e, errors: e, moneyPeople: e }),
      indexModel({ lifetime: e, search: e, stats: e, share: e, sources: e, errors: e, email: e }),
      measureSheet('signups', { weeks: e, growth: e, kpi: e }), measureSheet('activation_rate', { weeks: e, growth: e, kpi: e }),
      measureSheet('checkouts', { weeks: e, growth: e, kpi: e }), weekPoints(e, 'signups'), mastModel(NOW),
    );
  }
  // rows full of nulls
  const holes = [{ week_start: mon(0), complete: true, signups: null, day_one_n: null, day_one_activated: null, day_one_complete: true }];
  outs.push(
    leadModel({ current: { wau: null }, previous: { wau: null } }, holes), tileModels({ current: {}, previous: {} }, holes, holes),
    startModel(holes), searchModel([{ path: '/a', day: LAST, clicks: null, impressions: null, position: null }]),
    returnModel([{ dim: 'band:0', n: 0, returned: 0 }, { dim: 'band:13+', n: 0, returned: 0 }, { dim: 'all', n: 0, returned: 0 }], null),
    shareModel({ weekly: [{ week: '2026-11-02', signed_up: null }], routes: [{ route: null, signed_up: null }] }, NOW),
    sourcesModel([{ source: 'google', signups: 0 }]), measureSheet('signups', { weeks: holes, kpi: { current: {}, previous: {} } }),
  );
  const bad = strings(outs).filter((s) => /NaN|undefined|Infinity/.test(s));
  assert.deepEqual(bad, []);
});
