// phoneGrowthModels.js — what the phone admin's Growth and Search pages need
// beyond phoneInsights.js. Pure: no React, DOM, supabase or import.meta.
//
// Everything takes the RAW rows the RPCs return and hands the page strings and
// chart props, so the JSX does no arithmetic. Same rules as phoneInsights: week
// dates are UTC Mondays; the RPCs' own complete / settling / day_one_complete /
// *_measurable flags are passed through, never recomputed; a null stays a gap
// (never zero); rates change in points and counts in percent; under SMALL_N (15)
// people a count is shown, not a percentage; a missing value is '—'.
//
// Exports
//   RANGE_COUNTS, RETURN_SINCE
//   cutWeeks(rows, range)             the newest 12 ('12w') or 26 ('26w') growth rows, oldest first
//   growthTiles(lifetime, growth)     4 x { value, label, sub? }
//   growthFigures(growth, kpi, range) { signups, active, work, cards, start }  (each null with no rows)
//                                     signups/work/cards: { pts, readout, notes, caption, label, dek, fmt }
//                                     active:             { rows: StackRow[], legend, readout, caption, label, dek }
//                                     start:              { pts, readout, caption, label, dek, fmt:'pct' }
//   heatFigure(rows)                  { cells, dek, label, caption } | null
//   returnFigure(rows, since)         { head, dek, caption, label, readout, bands, tooFew, devices, sources, yMax }
//   retentionFigure(rows)             { pts, xl, readout, dek, caption, label, fmt:'pct', hidden } | null
//   SEARCH_RANGES                     the two range ids
//   searchFigures(model, range)       { views, clicks, place } for the page's range
//   topPagesRows(model)               [{ key, path, clicks, views, w, sub }]
//   homeFigure(model)                 { readout, w, dek, caption } | null
//   aiFigure(rows)                    { signups, activated, dek, footnote } | null
//   crawlerFigure(data)               { ai: {total, items}, search: {total, items}, caption } | null
import {
  weekPoints, weekState, weekLabel, tileModels, startModel, returnModel, heatModel, searchChart,
} from './phoneInsights.js';
import { dayPair, delta, formatCount, RETURN_SINCE } from './phonePanel.js';
import { SMALL_N } from './growthSeries.js';

/** The cohort floor the Coming back figure asks for (defined in phonePanel.js). */
export { RETURN_SINCE };

export const RANGE_COUNTS = { '12w': 12, '26w': 26 };
export const SEARCH_RANGES = ['28d', 'all'];

// ── small helpers ────────────────────────────────────────────────────────────

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dl = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return '';
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
};
const nf = (v) => (num(v) == null ? '—' : formatCount(v));
const pc = (x) => (num(x) == null ? '—' : `${Math.round(x * 100)}%`);
const pc1 = (x) => (num(x) == null ? '—' : `${(x * 100).toFixed(1)}%`);
const sumOf = (a) => a.reduce((s, v) => s + (num(v) || 0), 0);
const peopleText = (n) => (n === 1 ? '1 person' : `${nf(n)} people`);
const validRow = (r) => !!r && /^\d{4}-\d{2}-\d{2}/.test(String(r.week_start ?? ''));

export function cutWeeks(rows, range = '12w') {
  const n = RANGE_COUNTS[range] || 12;
  return (Array.isArray(rows) ? rows : []).filter(validRow).slice(-n);
}

const WEEK_NOTE = 'Weeks run Monday to Sunday, UTC. Hollow: this week so far. Dashed: last week, still settling.';
const DRAG = ' Drag across the chart to read a week.';

// ── tiles ────────────────────────────────────────────────────────────────────

export function growthTiles(lifetime, growth) {
  const rows = cutWeeks(growth, '12w');
  const first = rows[0];
  const hasSignups = rows.some((r) => num(r.signups) != null);
  return [
    { value: nf(lifetime?.users), label: 'people, all time' },
    { value: nf(lifetime?.cards), label: 'cards' },
    { value: nf(lifetime?.clusters_made), label: 'clusters made' },
    {
      value: hasSignups ? nf(sumOf(rows.map((r) => r.signups))) : '—',
      label: first ? `signups since ${dl(first.week_start)}` : 'signups',
    },
  ];
}

// ── the weekly figures ───────────────────────────────────────────────────────

function readoutFor(kpi, growth, id) {
  if (!kpi) return null;
  const t = tileModels(kpi, growth, growth).find((x) => x.id === id);
  if (!t) return null;
  return { value: t.value, label: 'last 7 days', delta: t.delta };
}

function peakNote(pts) {
  let at = -1;
  pts.forEach((p, i) => { if (p.state !== 'open' && p.v != null && (at < 0 || p.v > pts[at].v)) at = i; });
  if (at < 0) return [];
  return [{ i: at, lines: [`${nf(pts[at].v)} ${pts[at].v === 1 ? 'signup' : 'signups'}`, `week of ${dl(pts[at].key)}`] }];
}

function weekly(rows, field, kpi, growth, id) {
  const pts = weekPoints(rows, field);
  return { pts, readout: readoutFor(kpi, growth, id), fmt: 'count' };
}

function lastDay(rows) {
  const last = rows.at(-1);
  return last ? dl(new Date(Date.parse(`${String(last.week_start).slice(0, 10)}T00:00:00Z`) + 6 * 86400000).toISOString()) : '';
}

export function growthFigures(growth, kpi, range = '12w') {
  const rows = cutWeeks(growth, range);
  if (!rows.length) return { signups: null, active: null, work: null, cards: null, start: null };
  const end = lastDay(rows);
  const span = `${rows.length} weeks to ${end}`;

  const signups = weekly(rows, 'signups', kpi, growth, 'signups');
  signups.notes = peakNote(signups.pts);
  signups.dek = 'People who entered their code, a week.';
  signups.caption = `${WEEK_NOTE}${DRAG}`;
  signups.label = `Signups a week, ${span}.`;

  const cards = weekly(rows, 'cards', kpi, growth, 'cards_created');
  cards.notes = [];
  cards.dek = 'Everything everyone made, a week.';
  cards.caption = 'Hollow: this week so far. Dashed: last week, still settling.';
  cards.label = `Cards added a week, ${span}.`;

  // Weeks the RPC marks as not measured are gaps (weekPoints applies the flag).
  const work = weekly(rows, 'work_users', kpi, growth, 'work_users');
  work.notes = [];
  work.dek = 'People who added something to a cluster, a week.';
  const floorRow = [...rows].reverse().find((r) => r.work_floor);
  const unmeasured = rows.some((r) => r.work_measurable === false);
  work.caption = unmeasured && floorRow
    ? `Not measured before ${dl(floorRow.work_floor)}; the line starts where the measure does.`
    : 'Hollow: this week so far. Dashed: last week, still settling.';
  work.label = `People doing real work a week, ${span}.`;

  const stack = rows.map((r) => {
    const state = weekState(r);
    const key = String(r.week_start).slice(0, 10);
    const measured = r.active_measurable !== false && num(r.new_active) != null;
    return {
      key, label: weekLabel(key, state), state,
      a: measured ? num(r.new_active) : null,
      b: measured ? (num(r.returning_active) ?? 0) : null,
    };
  });
  const active = {
    rows: stack,
    legend: [{ label: 'New that week' }, { label: 'Came back' }],
    readout: readoutFor(kpi, growth, 'wau'),
    dek: 'Who opened the app, new that week and back again.',
    caption: 'A week with no bar was not measured. Pale bar: this week so far.',
    label: `People who opened the app a week, new that week and came back, ${span}.`,
  };

  // Day one: complete weeks only; a week under 15 signups is named by its counts, not drawn.
  const s = startModel(growth);
  const inRange = new Set(rows.map((r) => String(r.week_start).slice(0, 10)));
  const byKey = new Map(rows.map((r) => [String(r.week_start).slice(0, 10), r]));
  const pts = s.pts.filter((p) => p.state === 'done' && inRange.has(p.key)).map((p) => {
    const r = byKey.get(p.key);
    const n = num(r?.day_one_n);
    const a = num(r?.day_one_activated);
    return p.small
      ? { ...p, v: null, label: `${p.label} · ${nf(a)} of ${nf(n)}, too few for a percentage` }
      : p;
  });
  let readout = null;
  if (s.newest) {
    readout = s.mode === 'counts'
      ? { value: `${s.newest.a} of ${s.newest.n}`, label: `newest full week, ${weekLabel(s.newest.weekStart, 'done')}` }
      : {
        value: pc(s.newest.rate),
        label: `newest full week, ${weekLabel(s.newest.weekStart, 'done')}`,
        delta: s.prev ? delta(s.newest.rate, s.prev.rate, 'rate') : undefined,
      };
  }
  const smallWeeks = pts.filter((p) => p.v == null).length;
  const start = {
    pts, readout, fmt: 'pct',
    dek: 'Share of each week’s signups who made something the day they joined.',
    caption: `A week counts once everyone in it has had a full first day, so the newest weeks are left off.${smallWeeks ? ' Weeks with fewer than 15 signups are not drawn; their counts show when you drag across.' : ''}`,
    label: s.label || `Share of each week’s signups who made something on their first day, ${span}.`,
  };
  return { signups, active, work, cards, start };
}

// ── when people are in the app ───────────────────────────────────────────────

export function heatFigure(rows) {
  const h = heatModel(rows);
  if (!h.cells.length) return null;
  return {
    cells: h.cells,
    label: h.label,
    dek: h.busiest
      ? `${h.text}, ${h.busiest.n === 1 ? '1 person' : `${nf(h.busiest.n)} different people`} in that hour.`
      : 'No activity recorded.',
    caption: 'Different people in each hour over the last 30 days, New York time. Tap a cell to read it.',
  };
}

// ── coming back within a week ────────────────────────────────────────────────

function rateRows(list, scale) {
  return list.map((g) => {
    const few = g.n != null && g.n < SMALL_N;
    return {
      key: g.key,
      label: g.label,
      text: g.n == null || g.returned == null ? '—' : few ? `${nf(g.returned)} of ${nf(g.n)}` : pc(g.v),
      sub: g.n == null || few ? '' : peopleText(g.n), // "1 of 8" already says the 8
      w: !few && g.v != null && scale > 0 ? Math.min(100, Math.round((g.v / scale) * 1000) / 10) : 0,
      few,
    };
  });
}

export function returnFigure(rows, since = RETURN_SINCE) {
  const m = returnModel(rows, since);
  const all = m.all;
  const sinceLabel = dl(since);
  const bandRows = m.items.filter((i) => i.n != null);
  const big = bandRows.filter((i) => i.n >= SMALL_N && i.v != null);
  const tooFew = bandRows.filter((i) => i.n < SMALL_N).map((i) => {
    const g = (rows || []).find((r) => r && r.dim === `band:${i.key}`);
    return `${i.label} cards: ${nf(g?.returned)} of ${nf(i.n)}`;
  });
  const rates = [...big.map((i) => i.v), ...m.devices.filter((d) => d.n >= SMALL_N).map((d) => d.v), ...m.sources.filter((d) => d.n >= SMALL_N).map((d) => d.v)]
    .filter((v) => v != null);
  const top = rates.length ? Math.max(...rates) : 0;
  const yMax = top > 0 ? Math.max(0.1, Math.ceil(top * 1.3 * 20) / 20) : 0.5;
  const scale = Math.max(0.1, yMax);
  let readout = null;
  if (all && all.n != null) {
    const few = all.n < SMALL_N;
    readout = few
      ? { value: `${nf(all.returned)} of ${nf(all.n)}`, label: `people who joined since ${sinceLabel} opened the app again within a week` }
      : { value: pc(all.v), label: `of ${peopleText(all.n)} who joined since ${sinceLabel} opened the app again within a week` };
  }
  return {
    head: m.head,
    dek: m.dek,
    caption: `${m.caption} Small figures: people counted. Groups under ${SMALL_N} people show counts, not percentages.`,
    label: m.label,
    readout,
    bands: big.map((i) => ({ key: i.key, label: i.label, sub: i.sub, v: i.v, on: i.on })),
    tooFew,
    devices: rateRows(m.devices, scale),
    sources: rateRows(m.sources, scale),
    yMax,
  };
}

// ── opened the app again on day N ────────────────────────────────────────────

const RETENTION_TICKS = [1, 7, 14, 21, 28];

export function retentionFigure(rows) {
  const all = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && (r.segment ?? 'all') === 'all' && num(r.day_offset) >= 1 && num(r.eligible) > 0)
    .sort((a, b) => num(a.day_offset) - num(b.day_offset));
  if (!all.length) return null;
  const pts = all.map((r) => {
    const d = num(r.day_offset);
    const e = num(r.eligible);
    const a = num(r.active) ?? 0;
    const few = e < SMALL_N;
    return {
      key: `day-${d}`,
      label: `Day ${d} · ${nf(a)} of ${nf(e)}${few ? ', too few for a percentage' : ''}`,
      v: few ? null : a / e,
      state: 'done',
      day: d,
    };
  });
  const xl = RETENTION_TICKS.map((d) => ({ i: pts.findIndex((p) => p.day === d), text: `Day ${d}` })).filter((t) => t.i >= 0);
  const first = all[0];
  const fe = num(first.eligible);
  const lastDayN = num(all.at(-1).day_offset);
  const hidden = pts.filter((p) => p.v == null).length;
  let readout = null;
  if (num(first.day_offset) === 1) {
    readout = fe >= SMALL_N
      ? { value: pc((num(first.active) ?? 0) / fe), label: `opened the app the day after signing up, of ${peopleText(fe)}` }
      : { value: `${nf(first.active)} of ${nf(fe)}`, label: 'opened the app the day after signing up' };
  }
  return {
    pts, xl, readout, fmt: 'pct', hidden,
    dek: 'Of everyone who has reached that day, the share who opened the app on it.',
    caption: `Each point is one day since signing up, up to day ${lastDayN}: the share of people who opened the app on that exact day. Everyone counts who signed up since app-open days began to be recorded and has had that many days; the group shrinks with each day.${hidden ? ` Days with fewer than ${SMALL_N} people are not drawn.` : ''}`,
    label: `Share who opened the app on day 1 to day ${lastDayN} after signing up.`,
  };
}

// ── Search ───────────────────────────────────────────────────────────────────

function xTicks(bars) {
  const n = bars.length;
  if (n < 2) return null;
  if (n > 28) return 'month';
  const at = [0, 7, 14, 21].filter((i) => i < n - 4);
  at.push(n - 1);
  return at.map((i) => ({ i, text: bars[i].label }));
}

const placeText = (p) => (num(p) == null ? '—' : num(p).toFixed(1));

export function searchFigures(model, range = '28d') {
  if (!model || !Array.isArray(model.days) || !model.days.length) return { views: null, clicks: null, place: null };
  const count = range === 'all' ? 'all' : 28;
  const day = model.lastLabel;

  // The last 7 days and the 7 before, a day each: whole numbers unless they
  // would read the same (dayPair).
  const vPair = model.ok ? dayPair(model.views.last, model.views.prev) : null;
  const cPair = model.ok ? dayPair(model.clicks.last, model.clicks.prev) : null;
  const vWord = model.ok ? (model.views.last > model.views.prev ? 'up from' : model.views.last < model.views.prev ? 'down from' : 'level with') : '';

  const vc = searchChart(model, count, 'views');
  const views = {
    chart: vc,
    xl: xTicks(vc.bars),
    readout: model.ok
      ? { value: nf(Math.round(model.views.last)), label: `a day, last 7 days, ${vWord} ${vPair[1]}` }
      : null,
    dek: model.sub || model.head || '',
    caption: `Not counting the home page, to ${day}. Google reports about 3 days late, so the outlined newest 3 days may still grow.${vc.refs.length ? ' Dashed lines: the average of the last 7 days and of the 7 before.' : ''}`,
    label: model.label,
  };

  const cc = searchChart(model, count, 'clicks');
  const clicks = {
    chart: { bars: cc.bars, refs: [], vrule: null },
    xl: xTicks(cc.bars),
    readout: model.ok
      ? { value: nf(Math.round(model.clicks.last)), label: 'a day, last 7 days', delta: delta(model.clicks.last, model.clicks.prev) }
      : null,
    dek: model.ok ? `About ${cPair[0]} a day in the last 7 days, against ${cPair[1]} the 7 before.` : '',
    caption: `Clicks, not counting the home page, to ${day}. Outlined: the newest 3 days.`,
    label: `Clicks from Google a day, to ${day}, home page left out.`,
  };

  const take = count === 'all' ? model.days.length : Math.min(28, model.days.length);
  const days = model.days.slice(model.days.length - take);
  const seen = days.map((d) => d.place).filter((v) => v != null);
  const max = seen.length ? Math.max(...seen) : 0;
  const pts = days.map((d) => ({ key: d.day, label: d.label, v: d.place, state: 'done' }));
  const place = {
    pts,
    xl: xTicks(pts.map((p) => ({ label: p.label }))),
    yMax: Math.max(4, Math.ceil(max / 4) * 4),
    readout: model.place.last != null
      ? {
        value: placeText(model.place.last),
        label: model.place.prev != null
          ? `average place, last 7 days, from ${placeText(model.place.prev)} the 7 before`
          : 'average place, last 7 days',
      }
      : null,
    dek: 'Place 1 is the top of the page, so the chart is upside down: higher is better.',
    caption: `Weighted by how often each page was shown, not counting the home page, to ${day}. A day with no times shown is a gap.`,
    label: `Average place in Google a day, to ${day}. Place 1 is the top, so higher on the chart is better.`,
  };
  return { views, clicks, place };
}

export function topPagesRows(model) {
  const list = Array.isArray(model?.topPages) ? model.topPages : [];
  const max = Math.max(0, ...list.map((p) => p.clicks || 0));
  return list.map((p) => ({
    key: p.path,
    path: p.path,
    clicks: nf(p.clicks),
    w: max > 0 ? Math.round(((p.clicks || 0) / max) * 1000) / 10 : 0,
    sub: `${nf(p.views)} shown · place ${placeText(p.place)}`,
  }));
}

export function homeFigure(model) {
  if (!model || !model.days?.length) return null;
  const h = model.home;
  if (!h || h.views == null) return null;
  const few = h.views < SMALL_N;
  return {
    readout: {
      value: h.views > 0 ? (few ? `${nf(h.clicks)} of ${nf(h.views)}` : pc1(h.ctr)) : '—',
      label: h.views > 0 ? `clicked: ${nf(h.clicks)} of ${nf(h.views)} times shown` : 'times shown: none',
    },
    w: h.views > 0 && h.ctr != null ? Math.min(100, Math.round(h.ctr * 1000) / 10) : 0,
    dek: 'People searching for the name. Kept out of every figure above.',
    caption: `Last 28 days to ${model.lastLabel}. A share of times shown, out of 100%. Average place ${placeText(h.place)}.`,
  };
}

// ── AI assistants and crawlers ───────────────────────────────────────────────

export function aiFigure(rows) {
  if (!Array.isArray(rows)) return null;
  const signups = sumOf(rows.map((r) => r?.signups));
  const activated = sumOf(rows.map((r) => r?.activated));
  return {
    signups,
    activated,
    dek: signups === 0
      ? 'No signups were sent by AI assistants in the last 30 days.'
      : `${nf(signups)} ${signups === 1 ? 'signup' : 'signups'} sent by AI assistants in 30 days; ${nf(activated)} made something.`,
    footnote: 'This count includes team and unverified accounts.',
  };
}

export function crawlerFigure(data) {
  const list = Array.isArray(data?.by_bot) ? data.by_bot : null;
  if (!list) return null;
  // The SQL sorts by the hits as TEXT ("9" before "10"); sort by the number.
  const rows = list
    .map((b) => ({ key: String(b?.bot ?? ''), label: String(b?.bot ?? ''), kind: b?.kind, n: num(b?.hits) }))
    .filter((b) => b.key && b.n != null)
    .sort((a, b) => b.n - a.n || (a.label < b.label ? -1 : 1));
  const of = (kind) => {
    const items = rows.filter((r) => r.kind === kind);
    return { total: sumOf(items.map((i) => i.n)), items: items.map(({ key, label, n }) => ({ key, label, n })) };
  };
  const ai = of('ai');
  const search = of('search');
  return {
    ai,
    search,
    caption: `Crawler visits in the last 30 days. All AI crawlers: ${nf(ai.total)} visits. Search engine crawlers: ${nf(search.total)}.`,
  };
}
