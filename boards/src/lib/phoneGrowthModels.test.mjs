// phoneGrowthModels.test.mjs — the Growth and Search pages' models.
//
//   node --test src/lib/phoneGrowthModels.test.mjs
//
// Every input is invented. What this guards: the 12 / 26 week cut; null and
// unmeasured weeks stay gaps; the RPC's open / settling flags pass through; the
// day-one figure draws complete weeks only and names small weeks by counts; the
// return figure's small groups show counts; the retention curve takes the 'all'
// segment, drops day 0 and small days; per-day place is impression-weighted with
// gaps; the crawler list is re-sorted by number; the AI sums; and empty / null
// inputs never produce NaN, undefined or Infinity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchModel } from './phoneInsights.js';
import {
  cutWeeks, growthTiles, growthFigures, heatFigure, returnFigure, retentionFigure,
  searchFigures, topPagesRows, homeFigure, aiFigure, crawlerFigure, RETURN_SINCE,
} from './phoneGrowthModels.js';

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const mon = (i) => iso(Date.UTC(2026, 0, 5 + 7 * i)); // Jan 5 2026 is a Monday
const day = (last, back) => iso(Date.parse(`${last}T00:00:00Z`) - back * 86400000);

function growth(n, f = () => ({})) {
  return Array.from({ length: n }, (_, i) => ({
    week_start: mon(i), complete: i < n - 1, settling: i === n - 2,
    signups: 10 + i, cards: 100 + i, work_users: 5 + i, work_measurable: true, work_floor: mon(2),
    active_users: 20 + i, active_measurable: true, new_active: 8 + i, returning_active: 12,
    day_one_n: 20 + i, day_one_activated: 8, day_one_complete: i < n - 2,
    ...f(i, n),
  }));
}

function strings(x, out = []) {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) x.forEach((y) => strings(y, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((y) => strings(y, out));
  return out;
}
const clean = (x) => strings(x).every((s) => !/NaN|undefined|Infinity/.test(s));

// ── the cut ──────────────────────────────────────────────────────────────────

test('cutWeeks takes the newest 12 or 26, oldest first, and skips bad rows', () => {
  const rows = growth(26);
  assert.equal(cutWeeks(rows, '12w').length, 12);
  assert.equal(cutWeeks(rows, '12w')[0].week_start, mon(14));
  assert.equal(cutWeeks(rows, '12w').at(-1).week_start, mon(25));
  assert.equal(cutWeeks(rows, '26w').length, 26);
  assert.equal(cutWeeks(growth(5), '26w').length, 5);
  assert.deepEqual(cutWeeks([null, { week_start: 'x' }], '12w'), []);
  assert.deepEqual(cutWeeks(null, '12w'), []);
});

test('growthTiles: lifetime numbers and signups since the first shown week', () => {
  const rows = growth(26);
  const t = growthTiles({ users: 1200, cards: 15000, clusters_made: 900 }, rows);
  assert.deepEqual(t.map((x) => x.value).slice(0, 3), ['1,200', '15,000', '900']);
  const sum = cutWeeks(rows, '12w').reduce((s, r) => s + r.signups, 0);
  assert.equal(t[3].value, sum.toLocaleString('en-US'));
  assert.equal(t[3].label, 'signups since Apr 13');
  const none = growthTiles(null, undefined);
  assert.deepEqual(none.map((x) => x.value), ['—', '—', '—', '—']);
  assert.ok(clean(none));
});

// ── weekly figures ───────────────────────────────────────────────────────────

test('growthFigures: 12 and 26 weeks, flags passed through, null weeks are gaps', () => {
  const rows = growth(26, (i) => (i === 20 ? { signups: null, work_users: null, work_measurable: false } : {}));
  const f12 = growthFigures(rows, null, '12w');
  const f26 = growthFigures(rows, null, '26w');
  assert.equal(f12.signups.pts.length, 12);
  assert.equal(f26.signups.pts.length, 26);
  assert.equal(f12.signups.pts.at(-1).state, 'open');
  assert.equal(f12.signups.pts.at(-2).state, 'settling');
  assert.equal(f12.signups.pts[0].state, 'done');
  assert.equal(f12.signups.pts[20 - 14].v, null);
  assert.equal(f12.work.pts[20 - 14].v, null);
  assert.equal(f12.cards.pts.length, 12);
  assert.equal(f12.signups.readout, null); // no kpi
  assert.ok(clean(f12));
});

test('growth peak note names the biggest finished week, never the open one', () => {
  const rows = growth(12, (i, n) => (i === n - 1 ? { signups: 999 } : i === 5 ? { signups: 77 } : {}));
  const f = growthFigures(rows, null, '12w');
  assert.equal(f.signups.notes.length, 1);
  assert.equal(f.signups.notes[0].i, 5);
  assert.equal(f.signups.notes[0].lines[0], '77 signups');
});

test('readouts come from the kpi, last 7 days against the 7 before', () => {
  const kpi = { current: { signups: 30, wau: 50, work_users: 12, cards_created: 400 }, previous: { signups: 20, wau: 50, work_users: 10, cards_created: 300 } };
  const f = growthFigures(growth(12), kpi, '12w');
  assert.equal(f.signups.readout.value, '30');
  assert.equal(f.signups.readout.delta.text, '▲ 50%');
  assert.equal(f.active.readout.delta.text, 'same');
  assert.equal(f.cards.readout.label, 'last 7 days');
});

test('work caption says where the measure starts only when weeks are unmeasured', () => {
  const rows = growth(12, (i) => (i < 2 ? { work_users: null, work_measurable: false } : {}));
  assert.match(growthFigures(rows, null).work.caption, /Not measured before Jan 19/);
  assert.doesNotMatch(growthFigures(growth(12), null).work.caption, /Not measured/);
});

test('active people: new and came back stack; an unmeasured week is a gap', () => {
  const rows = growth(12, (i) => (i === 3 ? { active_users: null, active_measurable: false, new_active: null, returning_active: null } : {}));
  const a = growthFigures(rows, null).active;
  assert.equal(a.rows.length, 12);
  assert.equal(a.rows[3].a, null);
  assert.equal(a.rows[3].b, null);
  assert.equal(a.rows[0].a, 8);
  assert.equal(a.rows[0].b, 12);
  assert.equal(a.rows.at(-1).state, 'open');
  assert.equal(a.legend.length, 2);
});

test('day one: complete weeks only, a small week is not drawn but named by counts', () => {
  const rows = growth(12, (i) => (i === 4 ? { day_one_n: 9, day_one_activated: 4 } : {}));
  const s = growthFigures(rows, null).start;
  assert.ok(s.pts.every((p) => p.state === 'done'));
  assert.equal(s.pts.length, 10); // the open and the not-yet-complete week are left off
  const small = s.pts.find((p) => p.label.includes('4 of 9'));
  assert.ok(small);
  assert.equal(small.v, null);
  assert.match(s.caption, /fewer than 15/);
  assert.equal(s.readout.label.startsWith('newest full week'), true);
  assert.match(s.readout.value, /^\d+%$/);
  assert.ok(clean(s));
});

test('day one: a small newest week reads as counts', () => {
  const rows = growth(12, (i, n) => (i === n - 3 ? { day_one_n: 12, day_one_activated: 9 } : {}));
  const s = growthFigures(rows, null).start;
  assert.equal(s.readout.value, '9 of 12');
  assert.equal(s.readout.delta, undefined);
});

test('empty and null growth give null figures, not NaN', () => {
  for (const g of [undefined, null, []]) {
    const f = growthFigures(g, null);
    assert.deepEqual(f, { signups: null, active: null, work: null, cards: null, start: null });
  }
});

// ── heat ─────────────────────────────────────────────────────────────────────

test('heatFigure names the busiest hour; no rows gives null', () => {
  const rows = [{ dow: 2, hour: 14, actors: 9 }, { dow: 3, hour: 9, actors: 4 }];
  const h = heatFigure(rows);
  assert.equal(h.cells.length, 2);
  assert.match(h.dek, /Busiest: Tuesday at 2 pm, 9 different people in that hour\./);
  assert.equal(heatFigure([]), null);
  assert.equal(heatFigure(null), null);
});

// ── coming back ──────────────────────────────────────────────────────────────

const ret = (dim, n, returned) => ({ dim, n, returned, pct: n ? returned / n : null });

test('returnFigure: small groups show counts, large ones percentages, with sizes', () => {
  const rows = [
    ret('all', 400, 120),
    ret('band:0', 200, 30), ret('band:1-2', 100, 30), ret('band:3-5', 60, 24), ret('band:6-12', 30, 15), ret('band:13+', 10, 6),
    ret('device:desktop', 300, 100), ret('device:mobile', 90, 20), ret('device:tablet', 8, 3),
    ret('source:google', 120, 36), ret('source:reddit', 12, 7),
  ];
  const f = returnFigure(rows, RETURN_SINCE);
  assert.equal(f.readout.value, '30%');
  assert.match(f.readout.label, /400 people who joined since Aug 17/);
  assert.deepEqual(f.bands.map((b) => b.key), ['0', '1-2', '3-5', '6-12']);
  assert.deepEqual(f.tooFew, ['13+ cards: 6 of 10']);
  assert.equal(f.bands[0].sub, '200 people');
  const tab = f.devices.find((d) => d.key === 'tablet');
  assert.equal(tab.text, '3 of 8');
  assert.equal(tab.w, 0);
  assert.equal(tab.sub, '');
  assert.equal(f.sources.find((d) => d.key === 'reddit').sub, '');
  assert.equal(f.devices.find((d) => d.key === 'desktop').sub, '300 people');
  assert.equal(f.devices.find((d) => d.key === 'desktop').text, '33%');
  assert.equal(f.sources.find((d) => d.key === 'reddit').text, '7 of 12');
  assert.ok(f.yMax >= 0.1 && f.yMax <= 1.5);
  assert.ok(f.devices.every((d) => d.w >= 0 && d.w <= 100));
  assert.ok(clean(f));
});

test('returnFigure: a small overall group is a count; empty rows are quiet', () => {
  assert.equal(returnFigure([ret('all', 9, 4)], RETURN_SINCE).readout.value, '4 of 9');
  const e = returnFigure([], RETURN_SINCE);
  assert.equal(e.readout, null);
  assert.deepEqual(e.devices, []);
  assert.ok(clean(e));
  assert.ok(clean(returnFigure(null, RETURN_SINCE)));
});

// ── retention curve ──────────────────────────────────────────────────────────

test('retentionFigure: the all segment, day 0 dropped, small days not drawn', () => {
  const rows = [];
  for (let d = 0; d <= 8; d++) {
    rows.push({ segment: 'all', day_offset: d, eligible: d === 8 ? 10 : 100 - d, active: d === 0 ? 100 : 30 - d, active_pct: 0.3 });
    rows.push({ segment: 'paid', day_offset: d, eligible: 20, active: 20, active_pct: 1 });
  }
  const r = retentionFigure(rows);
  assert.equal(r.pts.length, 8);
  assert.equal(r.pts[0].day, 1);
  assert.equal(r.pts[0].v, 29 / 99);
  assert.equal(r.pts[0].label, 'Day 1 · 29 of 99');
  assert.equal(r.pts.at(-1).v, null);
  assert.match(r.pts.at(-1).label, /too few/);
  assert.equal(r.hidden, 1);
  assert.deepEqual(r.xl.map((t) => t.text), ['Day 1', 'Day 7']);
  assert.equal(r.readout.value, '29%');
  assert.match(r.caption, /up to day 8/);
  assert.ok(clean(r));
});

test('retentionFigure: nothing usable gives null', () => {
  assert.equal(retentionFigure([]), null);
  assert.equal(retentionFigure(null), null);
  assert.equal(retentionFigure([{ segment: 'all', day_offset: 0, eligible: 50, active: 50 }]), null);
});

// ── search ───────────────────────────────────────────────────────────────────

const LAST = '2026-10-31';
function rowsFor(n, f) {
  const rows = [];
  for (let k = 0; k < n; k++) {
    const d = day(LAST, n - 1 - k);
    const x = f(k);
    if (x === null) continue;
    for (const r of x) rows.push({ day: d, ...r });
  }
  return rows;
}

test('searchFigures: ranges, place weighted by times shown, gaps for empty days', () => {
  const rows = rowsFor(40, (k) => {
    if (k === 30) return null; // no row at all that day
    if (k === 31) return [{ path: '/a', clicks: 0, impressions: 0, position: 5 }]; // no times shown
    return [
      { path: '/a', clicks: 2, impressions: 90, position: 10 },
      { path: '/b', clicks: 1, impressions: 10, position: 20 },
      { path: '/', clicks: 5, impressions: 50, position: 1 },
    ];
  });
  const m = searchModel(rows);
  const f28 = searchFigures(m, '28d');
  const fAll = searchFigures(m, 'all');
  assert.equal(f28.views.chart.bars.length, 28);
  assert.equal(fAll.views.chart.bars.length, 40);
  assert.equal(f28.place.pts.length, 28);
  assert.equal(fAll.place.pts.length, 40);
  // (10*90 + 20*10) / 100 = 11, not the plain mean 15; the home page is out
  assert.equal(fAll.place.pts[0].v, 11);
  assert.equal(fAll.place.pts[30].v, null);
  assert.equal(fAll.place.pts[31].v, null);
  assert.equal(fAll.place.pts[0].state, 'done');
  assert.equal(f28.place.yMax % 4, 0);
  assert.ok(f28.place.yMax >= 11);
  // the 28-day axis labels are day names; the long one hands months to the chart
  assert.ok(Array.isArray(f28.views.xl));
  assert.equal(fAll.views.xl, 'month');
  assert.equal(f28.clicks.chart.vrule, null);
  assert.ok(clean(f28));
});

test('searchFigures: views/clicks readouts follow the model, and a short history falls back quietly', () => {
  const rows = rowsFor(20, () => [{ path: '/a', clicks: 4, impressions: 100, position: 8 }]);
  const f = searchFigures(searchModel(rows), '28d');
  assert.equal(f.views.readout.value, '100');
  assert.match(f.views.readout.label, /^a day, last 7 days, level with 100$/);
  assert.equal(f.clicks.readout.delta.text, 'same');
  assert.equal(f.place.readout.value, '8.0');
  assert.match(f.place.readout.label, /from 8\.0 the 7 before/);

  // 9 a day against 8.86 reads as 9 against 9 in whole numbers: the clicks dek and the views label take a decimal
  const near = searchFigures(searchModel(rowsFor(28, (k) => [{ path: '/a', clicks: k === 20 ? 9 : 10, impressions: k === 20 ? 97 : 100, position: 8 }])), '28d');
  assert.equal(near.clicks.dek, 'About 10.0 a day in the last 7 days, against 9.9 the 7 before.');
  assert.equal(near.views.readout.value, '100');
  assert.match(near.views.readout.label, /^a day, last 7 days, up from 99\.6$/);
  assert.equal(f.clicks.dek, 'About 4 a day in the last 7 days, against 4 the 7 before.');

  const short = searchFigures(searchModel(rowsFor(5, () => [{ path: '/a', clicks: 1, impressions: 10, position: 3 }])), '28d');
  assert.equal(short.views.readout, null);
  assert.equal(short.views.chart.refs.length, 0);
  assert.ok(Array.isArray(short.views.xl));
  assert.ok(clean(short));

  for (const m of [searchModel([]), searchModel(null)]) {
    assert.deepEqual(searchFigures(m, '28d'), { views: null, clicks: null, place: null });
    assert.deepEqual(topPagesRows(m), []);
    assert.equal(homeFigure(m), null);
  }
});

test('topPagesRows: bars against the biggest, strings carry no NaN', () => {
  const rows = rowsFor(28, () => [
    { path: '/a', clicks: 4, impressions: 100, position: 8 },
    { path: '/b', clicks: 2, impressions: 50, position: 12.34 },
    { path: '/c', clicks: 0, impressions: 0, position: null },
  ]);
  const t = topPagesRows(searchModel(rows));
  assert.equal(t[0].path, '/a');
  assert.equal(t[0].clicks, '112');
  assert.equal(t[0].w, 100);
  assert.equal(t[1].w, 50);
  assert.equal(t[1].sub, '1,400 shown · place 12.3');
  assert.equal(t.at(-1).sub, '0 shown · place —');
  assert.ok(clean(t));
});

test('homeFigure: clicked when shown, counted on its own, counts when under 15', () => {
  const rows = rowsFor(28, () => [
    { path: '/a', clicks: 4, impressions: 100, position: 8 },
    { path: '/', clicks: 10, impressions: 100, position: 1.4 },
  ]);
  const h = homeFigure(searchModel(rows));
  assert.equal(h.readout.value, '10.0%');
  assert.equal(h.readout.label, 'clicked: 280 of 2,800 times shown');
  assert.equal(h.w, 10);
  assert.match(h.caption, /Average place 1\.4/);

  const few = homeFigure(searchModel(rowsFor(14, (k) => [{ path: '/a', clicks: 1, impressions: 10, position: 3 }, ...(k === 13 ? [{ path: '/', clicks: 1, impressions: 5, position: 1 }] : [])])));
  assert.equal(few.readout.value, '1 of 5');

  const nohome = homeFigure(searchModel(rowsFor(14, () => [{ path: '/a', clicks: 1, impressions: 10, position: 3 }])));
  assert.equal(nohome.readout.value, '—');
  assert.equal(nohome.w, 0);
  assert.ok(clean([h, few, nohome]));
});

// ── AI assistants and crawlers ───────────────────────────────────────────────

test('aiFigure sums signups and activated across every row', () => {
  const a = aiFigure([
    { ref_host: 'a.example', landing_path: '/', signups: 9, activated: 5 },
    { ref_host: 'b.example', landing_path: '/x', signups: 7, activated: 3 },
    { ref_host: 'c.example', landing_path: '/y', signups: null, activated: undefined },
  ]);
  assert.equal(a.signups, 16);
  assert.equal(a.activated, 8);
  assert.equal(a.dek, '16 signups sent by AI assistants in 30 days; 8 made something.');
  assert.match(a.footnote, /team and unverified/);
  assert.equal(aiFigure([]).signups, 0);
  assert.match(aiFigure([]).dek, /^No signups/);
  assert.equal(aiFigure([{ signups: 1, activated: 0 }]).dek, '1 signup sent by AI assistants in 30 days; 0 made something.');
  assert.equal(aiFigure(null), null);
  assert.equal(aiFigure(undefined), null);
});

test('crawlerFigure re-sorts by number (the SQL sorts text), sums ai and search, leaves other out', () => {
  const by_bot = [
    { bot: 'Alpha', kind: 'ai', hits: 97 },
    { bot: 'Beta', kind: 'ai', hits: 9 },
    { bot: 'Gamma', kind: 'search', hits: 184 },
    { bot: 'Delta', kind: 'ai', hits: 212 },
    { bot: 'Epsilon', kind: 'other', hits: 5000 },
    { bot: 'Zeta', kind: 'search', hits: '36' },
    { bot: 'Eta', kind: 'ai', hits: 'many' },
  ];
  const c = crawlerFigure({ from: '2026-10-01', by_bot });
  assert.deepEqual(c.ai.items.map((i) => i.label), ['Delta', 'Alpha', 'Beta']);
  assert.equal(c.ai.total, 318);
  assert.deepEqual(c.search.items.map((i) => i.label), ['Gamma', 'Zeta']);
  assert.equal(c.search.total, 220);
  assert.ok(!JSON.stringify(c).includes('Epsilon'));
  assert.match(c.caption, /All AI crawlers: 318 visits\. Search engine crawlers: 220\./);
  assert.equal(crawlerFigure({ by_bot: [] }).ai.total, 0);
  assert.equal(crawlerFigure(null), null);
  assert.equal(crawlerFigure({}), null);
  assert.ok(clean(c));
});
