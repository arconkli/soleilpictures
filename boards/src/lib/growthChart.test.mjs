// growthChart.test.mjs — node --test src/lib/growthChart.test.mjs
//
// The band's geometry, asked what it would draw. Each rule the module's header
// gives a reason for is a case here: the week so far is hollow and never
// joined, a gap is never bridged, a line is thin before its cut, a small or
// filling rate is a dot on its own, an unmeasured run is one hatch, and glyphs
// that would touch stack into lanes instead.
//
// Every count is synthetic; this repo is public.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrowth } from './growthSeries.js';
import {
  GLYPH_MIN_W, LANE, PAD_L, PAD_R, PLOT_H, SOFAR_MIN_W, barPath, chartGeometry, niceCeiling, shortNumber, weekAt,
} from './growthChart.js';

const DAY_MS = 86400000;
const plus = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

// Jun 1 (0) … Oct 12 (19, newest complete) and Oct 19 (20, the week so far).
const WEEKS = Array.from({ length: 21 }, (_, i) => plus('2026-06-01', 7 * i));
const L = 19;
const P = 20;

function row(week_start, i, over) {
  return {
    week_start,
    complete: i !== P,
    signups: 10,
    active_users: 20,
    active_measurable: true,
    work_users: 5,
    work_measurable: true,
    cards: 100,
    users_total: 100 + i,
    new_active: 8,
    returning_active: 12,
    clusters_made: 4,
    cards_total: 1000,
    day_one_n: 20,
    day_one_activated: 8,
    day_one_complete: i !== P,
    seconds_in_app: null,
    seconds_measurable: false,
    seconds_floor: '2026-10-20',
    ...over(i),
  };
}

const grow = (over = () => ({})) => buildGrowth(WEEKS.map((w, i) => row(w, i, over)), [], { today: '2026-10-20' });
const geoOf = (growth, measureKey, opts = {}) => chartGeometry({ growth, measureKey, i0: 0, i1: P, width: 740, ...opts });

// The x of a path's points, from its M/L commands.
const xs = (d) => [...d.matchAll(/[ML](-?[\d.]+),/g)].map((m) => Number(m[1]));

// ── Scale ─────────────────────────────────────────────────────────────────
test('a scale ceiling halves into a whole number', () => {
  assert.equal(niceCeiling(0), 2);
  assert.equal(niceCeiling(-4), 2);
  assert.equal(niceCeiling(7), 8);
  assert.equal(niceCeiling(10), 10);
  assert.equal(niceCeiling(11), 12);
  assert.equal(niceCeiling(87), 100);
  assert.equal(niceCeiling(100), 100);
  assert.equal(niceCeiling(1002), 1200);
  assert.equal(niceCeiling(5730), 6000);
});

test('scale labels are as short as the numbers allow', () => {
  assert.equal(shortNumber(1250), '1.25k');
  assert.equal(shortNumber(1000), '1k');
  assert.equal(shortNumber(600), '600');
  assert.equal(shortNumber(7.5), '7.5');
  assert.equal(shortNumber(0), '0');
});

test('a bar too short to see is not drawn at all', () => {
  assert.equal(barPath(10, 40, 8, 0.2, 3), '');
  assert.equal(barPath(10, 40, 0, 10, 3), '');
  assert.ok(barPath(10, 40, 8, 10, 3).startsWith('M10,50V'));
});

test('the plot is the width it is drawn at, less its scale column', () => {
  const geo = geoOf(grow(), 'signups');
  assert.equal(geo.x0, PAD_L);
  assert.equal(geo.x1, 740 - PAD_R);
  assert.equal(geo.yb - geo.y0, PLOT_H);
  assert.deepEqual(geo.grid.map((g) => g.label), ['0', '5', '10']);
});

// ── Bars ──────────────────────────────────────────────────────────────────
test('the week so far is a hollow bar; every other week a solid one', () => {
  const geo = geoOf(grow(), 'signups');
  assert.equal(geo.bars.length, 21);
  assert.deepEqual(geo.bars.filter((b) => b.part).map((b) => b.i), [P]);
  assert.ok(geo.pdiv > geo.x0 && geo.pdiv < geo.x1);
});

test('a zero week draws no bar, and a null week neither', () => {
  const geo = geoOf(grow((i) => (i === 3 ? { signups: 0 } : i === 4 ? { signups: null } : {})), 'signups');
  const drawn = geo.bars.map((b) => b.i);
  assert.ok(!drawn.includes(3) && !drawn.includes(4));
  assert.equal(drawn.length, 19);
});

test('weekly active stacks new on top of back, two pixels apart', () => {
  // back 12 + new 8 = 20, a ceiling of 20: back's top is round(yb - 28.8).
  const geo = geoOf(grow(), 'active');
  const back = geo.bars.find((b) => b.tone === 'back' && b.i === 5);
  const fresh = geo.bars.find((b) => b.tone === 'fresh' && b.i === 5);
  const yBack = Math.round(geo.yb - (12 / 20) * PLOT_H);
  assert.match(back.d, new RegExp(`V${yBack}H`));
  // The new-that-week bar stands on a baseline 2px above back's top.
  assert.ok(fresh.d.startsWith(`M${Number(back.d.match(/^M([\d.]+),/)[1])},${yBack - 2}V`));
});

// ── Lines ─────────────────────────────────────────────────────────────────
test('a line runs through complete weeks only, and the week so far is its own hollow point', () => {
  const geo = geoOf(grow(), 'accounts');
  const xP = geo.x0 + (P + 0.5) * geo.step;
  assert.equal(geo.lines.length, 1);
  assert.ok(!xs(geo.lines[0].d).some((x) => Math.abs(x - xP) < 0.2), 'the line reaches the week so far');
  const partial = geo.dots.filter((d) => d.kind === 'partial');
  assert.deepEqual(partial.map((d) => d.i), [P]);
  assert.deepEqual(geo.dots.filter((d) => d.kind === 'last').map((d) => d.i), [L]);
  assert.ok(geo.area.length > 0);
});

test('a gap is never bridged, and a reading alone between gaps gets a dot', () => {
  const geo = geoOf(grow((i) => (i === 6 || i === 8 ? { users_total: null } : {})), 'accounts');
  // 0-5, then 7 alone, then 9-19.
  assert.equal(geo.lines.length, 3);
  assert.deepEqual(geo.dots.filter((d) => d.kind === 'lone').map((d) => d.i), [7]);
});

test('before its cut a line is thin, and the two sides are never joined', () => {
  const geo = geoOf(grow(), 'work', { cutAt: 18 });
  assert.deepEqual(geo.lines.map((l) => l.thin), [true, false]);
  const [thin, full] = geo.lines.map((l) => xs(l.d));
  assert.ok(Math.max(...thin) < Math.min(...full));
  // The area under a stock line never covers its thin part; work has no area at all.
  assert.equal(geo.area, '');
});

// ── Rates ─────────────────────────────────────────────────────────────────
test('a cohort under fifteen is a small dot on its own; a filling one is hollow; the rest are joined', () => {
  const g = grow((i) => (i <= 2 ? { day_one_n: 9, day_one_activated: 3 } : i === L ? { day_one_complete: false } : {}));
  const geo = geoOf(g, 'd1');
  const kinds = (k) => geo.dots.filter((d) => d.kind === k).map((d) => d.i);
  assert.deepEqual(kinds('small'), [0, 1, 2]);
  assert.deepEqual(kinds('filling'), [L, P]);
  assert.equal(kinds('full').length, 16); // 3 … 18
  assert.ok(geo.dots.filter((d) => d.kind === 'small').every((d) => d.r <= 3));
  // One joined run, 3 … 18: nothing through a small or a filling dot.
  assert.equal(geo.lines.length, 1);
  const run = xs(geo.lines[0].d);
  assert.equal(run.length, 16);
  assert.equal(geo.max, 100);
});

test('a dot grows with its cohort, within bounds', () => {
  const g = grow((i) => (i === 5 ? { day_one_n: 400, day_one_activated: 100 } : {}));
  const geo = geoOf(g, 'd1');
  const r = (i) => geo.dots.find((d) => d.i === i).r;
  assert.equal(r(5), 6.5);
  assert.ok(r(5) > r(4));
  assert.ok(r(4) >= 2.5);
});

test('on a narrow chart no dot is wider than its week', () => {
  const g = grow((i) => (i === 5 ? { day_one_n: 400, day_one_activated: 100 } : {}));
  const geo = geoOf(g, 'd1', { width: 300 });
  // 21 weeks over 262px: 12.5px apart, so no dot past 0.42 of that.
  assert.ok(geo.dots.every((d) => 2 * d.r <= geo.step), `widest ${Math.max(...geo.dots.map((d) => d.r))} at ${geo.step}`);
});

// ── What was not measured ─────────────────────────────────────────────────
test('weeks nothing was counting are one hatch, and are drawn as nothing else', () => {
  const g = grow((i) => (i <= 2 ? { active_measurable: false } : {}));
  const geo = geoOf(g, 'active');
  assert.equal(geo.hatch.length, 1);
  assert.equal(geo.hatch[0].x, geo.x0);
  assert.ok(Math.abs(geo.hatch[0].w - 3 * geo.step) < 1e-9);
  assert.ok(geo.bars.every((b) => b.i > 2));
});

test('a chart with nothing measured says so in place of its marks', () => {
  const geo = geoOf(grow(), 'time', { message: 'Per-day time in app starts Oct 20' });
  assert.deepEqual(geo.hatch, [{ x: geo.x0, w: geo.x1 - geo.x0 }]);
  assert.equal(geo.message.text, 'Per-day time in app starts Oct 20');
  assert.equal(geo.bars.length, 0);
  assert.ok(geo.grid.every((g) => g.label === ''));
});

// ── Markers and their glyphs ──────────────────────────────────────────────
const mark = (id, at, kind = 'ship', extra = {}) => ({ id, at, kind, label: id, day: '2026-07-01', ...extra });

test('glyphs that would touch stack into lanes, and the chart grows to hold them', () => {
  const growth = grow();
  const marks = [mark('a', 5.2), mark('b', 5.4), mark('c', 12)];
  const alone = geoOf(growth, 'signups', { first: true, marks, glyphIds: new Set(['c']) });
  const stacked = geoOf(growth, 'signups', { first: true, marks, glyphIds: new Set(['a', 'b', 'c']) });
  assert.equal(alone.y0, 22);
  // Two lanes: 17 + 12 - 22 = 7px more.
  assert.equal(stacked.y0, 22 + 7);
  const lane = (id) => (stacked.y0 - 4 - stacked.glyphs.find((g) => g.id === id).y) / LANE;
  assert.equal(lane('a'), 0);
  assert.equal(lane('b'), 1);
  assert.equal(lane('c'), 0);
});

test('a definition break is a short tick, and a full rule too when it cuts', () => {
  const geo = geoOf(grow(), 'work', {
    marks: [mark('cut', 17.5, 'break', { cut: true }), mark('soft', 11.2, 'break', { cut: false }), mark('note', 8.1, 'note')],
  });
  const of = (id) => geo.marks.filter((m) => m.id === id);
  assert.deepEqual(of('cut').map((m) => m.tick), [true, false]);
  assert.deepEqual(of('soft').map((m) => m.tick), [true]);
  assert.deepEqual(of('note').map((m) => [m.tick, m.y1, m.y2]), [[false, geo.y0, geo.yb]]);
});

test('the marker pointed at is lit on its rule and its glyph', () => {
  const geo = geoOf(grow(), 'signups', { first: true, marks: [mark('a', 5.2), mark('b', 9.5)], glyphIds: new Set(['a', 'b']), active: 'b' });
  assert.deepEqual(geo.marks.filter((m) => m.on).map((m) => m.id), ['b']);
  assert.deepEqual(geo.glyphs.filter((g) => g.on).map((g) => g.id), ['b']);
});

test(`under ${GLYPH_MIN_W}px the glyphs go, and the rules stay`, () => {
  const geo = geoOf(grow(), 'signups', { width: GLYPH_MIN_W - 1, first: true, marks: [mark('a', 5.2), mark('b', 5.4)], glyphIds: new Set(['a', 'b']) });
  assert.equal(geo.glyphs.length, 0);
  // No glyphs, so no room kept above the plot for them either.
  assert.equal(geo.y0, 8);
  assert.equal(geo.marks.length, 2);
});

// ── The date axis ─────────────────────────────────────────────────────────
test('across the whole history the axis names months, and "so far" closes it', () => {
  const geo = geoOf(grow(), 'signups', { last: true });
  assert.deepEqual(geo.ticks.map((t) => t.label), ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'so far']);
  const sofar = geo.ticks.at(-1);
  assert.equal(sofar.x, geo.x1);
  assert.equal(sofar.end, true);
  assert.equal(geo.tickY, geo.yb + 6);
});

test(`under ${SOFAR_MIN_W}px "so far" leaves the axis, so the months keep it`, () => {
  const geo = geoOf(grow(), 'signups', { last: true, width: SOFAR_MIN_W - 1 });
  assert.deepEqual(geo.ticks.map((t) => t.label), ['Jun', 'Jul', 'Aug', 'Sep', 'Oct']);
});

test('across thirteen weeks the axis names every fourth week, counted back from the newest', () => {
  const geo = chartGeometry({ growth: grow(), measureKey: 'signups', i0: L - 12, i1: P, width: 740, last: true });
  assert.deepEqual(geo.ticks.map((t) => t.label), ['Jul 20', 'Aug 17', 'Sep 14', 'Oct 12', 'so far']);
});

test('only the last chart of a group draws dates', () => {
  assert.deepEqual(geoOf(grow(), 'signups').ticks, []);
});

// ── Pointing ──────────────────────────────────────────────────────────────
test('the week under the pointer, and nothing outside the plot', () => {
  const geo = geoOf(grow(), 'signups');
  assert.equal(weekAt(geo, geo.x0 - 1), null);
  assert.equal(weekAt(geo, geo.x0), 0);
  assert.equal(weekAt(geo, geo.x0 + geo.step * 3.5), 3);
  assert.equal(weekAt(geo, geo.x1), P);
  assert.equal(weekAt(geo, geo.x1 + 1), null);
  assert.equal(weekAt(null, 100), null);
});

test('the week pointed at is a band on every chart, and a dot on a line', () => {
  const growth = grow();
  const line = geoOf(growth, 'accounts', { hover: 4 });
  assert.ok(Math.abs(line.hoverBand.x - (line.x0 + 4 * line.step)) < 1e-9);
  // The hairline sits on a pixel centre in the middle of the week.
  assert.equal(line.hoverX, Math.round(line.x0 + 4.5 * line.step) + 0.5);
  assert.ok(line.hoverDot);
  const bars = geoOf(growth, 'signups', { hover: 4 });
  assert.ok(bars.hoverBand);
  assert.equal(bars.hoverDot, null);
  assert.equal(geoOf(growth, 'signups', { hover: 40 }).hoverBand, null);
  assert.equal(geoOf(growth, 'signups', { hover: 40 }).hoverX, null);
});
