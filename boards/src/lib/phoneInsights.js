// phoneInsights.js — the phone admin's "what does the data say" layer.
//
// Pure: no React, DOM, supabase or import.meta. Everything takes the RAW rows the
// RPCs return (admin_kpi_summary, admin_growth_series, admin_page_search_daily,
// admin_return_fixed_horizon, admin_sharing_overview, admin_acquisition_breakdown,
// admin_activity_heatmap, admin_recent_signups, ...) and returns what a chart or a
// sentence needs. Anything that depends on the time takes `now`. Week and day
// dates are UTC; only mastModel uses America/New_York. Missing data gives null or
// '', never 'NaN', 'undefined' or 'Infinity'. The week flags (complete, settling,
// day_one_complete) are the RPCs' own and are never recomputed here.
//
// Chart shapes (they feed phoneCharts.jsx verbatim; every chart also takes a
// `label` aria sentence and `fmt(v) -> string`; each model names its `fmt`):
//   WeekPoint { key 'YYYY-MM-DD' (UTC Monday), label, v: number|null, state: 'done'|'settling'|'open' }  rates are 0..1
//   Note      { i, lines: [string] | [string, string] }
//   Bar       { key, label, v: number|null, tone: 'now'|'before', open: boolean }
//   Ref       { v, i0, i1 }          VRule { i, lines }
//   StackRow  { key, label, a, b, state }        HeatCell { dow 1..7, hour 0..23, n, title }
//   RankItem  { key, label, n }                  LollipopItem { key, label, sub, v: 0..1|null, on }
//   Delta     phonePanel.delta() { text, dir }   Readout { value, label, delta? }
//
// Exports and return shapes
//   weekState(row)                      'open' | 'settling' | 'done'
//   weekLabel(weekStart, state)         'Oct 12 – 18' | 'Sep 28 – Oct 4', + ' · settling' / ' · so far'
//   weekPoints(rows, field | fn)        WeekPoint[]  (a null value stays null)
//   maskEmail(email)                    'abc…@domain.com' | 'someone'
//   mastModel(now)                      { date: 'Wednesday, November 4', clock: '9:00 AM' }  (New York)
//   leadModel(kpi, weeks)               H0 { value, prev, valueText, prevText, delta, clause, pts, notes: Note[], caption, label, fmt: 'count' }
//   todayModel({signups, weeks, active, stats, moneyPeople, now})
//                                       { signupsToday, capped, usual, pace: 0..1|null, active, paying, money: '$1,234 a month'|'' }
//                                       (paying is admin_money_people.paying, team left out, the count the Money page shows; money is stats.mrr_cents)
//   tileModels(kpi, weeks, growth)      6 x { id, label, sub, value, delta, vs, spark: {vals, pct, dashedFlat}|null, pending }
//   TILES_CAPTION                       the caption under the tiles
//   searchModel(rows)                   H1 { ok, lastDay, lastLabel, head, sub, caption, chart: {bars, refs, vrule}, label, fmt: 'count',
//                                            views/clicks/place: {last, prev}, ratio, jump, clicks7, days, tiles, topPages, pagesShown, home }
//   searchChart(model, count, field)    { bars, refs, vrule } for the last `count` days (or 'all'); field 'views' | 'clicks'
//   startModel(growth)                  H2 { mode: 'rate'|'counts'|null, head, dek, pts, homePts, caption, label, fmt: 'pct', newest, prev, extreme }
//   returnModel(rows, since)            H3 { head, dek, caption, items: LollipopItem[], yMax: 0.5|1, all, devices, sources, label, fmt: 'pct' }
//   shareModel(share, now)              H4 { head, sub, bars: Bar[], caption, label, fmt: 'count', openCount, fullWeeks }
//   sourcesModel(acq, label)            { items: RankItem[], total, googlePct, dek, max, label, fmt: 'count' }
//   heatModel(rows)                     { cells: HeatCell[], busiest: {dow, hour, n}|null, text, max, label }
//   newestRows(signups, now, label)     5 x { id, who, from, did, ago }
//   lookModel({boards, approvals, errors, moneyPeople})
//                                       rows { key, n, label, sub, go, warn }
//   indexModel({lifetime, search, stats, share, sources, errors, email})
//                                       7 x { id, label, text }   (search = searchModel(), sources = sourcesModel())
//   measureSheet(id, {weeks, growth, kpi}, range)
//                                       { title, sub, about, pts, caption, table: [{label, value, state}], tile, lines? }
import { dayPair, delta, formatCount, MEASURES, signupsToday, usualDay, ago } from './phonePanel.js';
import { SMALL_N } from './growthSeries.js';
import { BAND_ORDER } from './fixedHorizonRows.js';
import { routeLabel } from './shareRoutes.js';

// ── small helpers ────────────────────────────────────────────────────────────

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) || !Number.isFinite(Number(v)) ? null : Number(v));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const nf = (v) => (num(v) == null ? '' : formatCount(v));
const pc = (x) => (num(x) == null ? '' : `${Math.round(x * 100)}%`);
const plural = (n, one, many = `${one}s`) => `${nf(n)} ${n === 1 ? one : many}`;
const sum = (a) => a.reduce((s, v) => s + (num(v) || 0), 0);
// A multiple to one decimal, '.0' dropped: 3.0 -> '3', 2.46 -> '2.5'.
function multiple(x) {
  const s = x.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ''));
  if (!m) return null;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return [Number(m[1]), mo, Number(m[3])];
}
const dayMs = (s) => { const p = parseDay(s); return p ? Date.UTC(p[0], p[1] - 1, p[2]) : null; };
const addDays = (s, n) => { const t = dayMs(s); return t == null ? '' : new Date(t + n * DAY_MS).toISOString().slice(0, 10); };
const dl = (s) => { const p = parseDay(s); return p ? `${MONTHS[p[1] - 1]} ${p[2]}` : ''; };
const weeksBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / WEEK_MS);

// The weekly field a series reads, with the RPC's own "measurable" flag applied.
function seriesValue(row, field) {
  if (field === 'active_users' && row.active_measurable === false) return null;
  if (field === 'work_users' && row.work_measurable === false) return null;
  return row[field];
}

// ── 1. week basics ───────────────────────────────────────────────────────────

export function weekState(row) {
  if (!row || !row.complete) return 'open';
  return row.settling ? 'settling' : 'done';
}

export function weekLabel(weekStart, state) {
  const p = parseDay(weekStart);
  if (!p) return '';
  const end = parseDay(addDays(weekStart, 6));
  const tail = end[1] === p[1] ? String(end[2]) : `${MONTHS[end[1] - 1]} ${end[2]}`;
  const suffix = state === 'settling' ? ' · settling' : state === 'open' ? ' · so far' : '';
  return `${MONTHS[p[1] - 1]} ${p[2]} – ${tail}${suffix}`;
}

export function weekPoints(rows, field) {
  const get = typeof field === 'function' ? field : (r) => seriesValue(r, field);
  return (Array.isArray(rows) ? rows : []).filter((r) => r && parseDay(r.week_start)).map((r) => {
    const state = weekState(r);
    const key = String(r.week_start).slice(0, 10);
    return { key, label: weekLabel(key, state), v: num(get(r)), state };
  });
}

// ── 2. masked email ──────────────────────────────────────────────────────────

export function maskEmail(email) {
  const s = String(email ?? '').trim();
  const at = s.lastIndexOf('@');
  if (at < 1) return 'someone';
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const keep = local.length <= 3 ? local.slice(0, 1) : local.slice(0, 3);
  return `${keep}…@${domain}`;
}

// ── 3. masthead ──────────────────────────────────────────────────────────────

export function mastModel(now) {
  const t = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(t.getTime())) return { date: '', clock: '' };
  const tz = 'America/New_York';
  const date = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }).format(t);
  const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(t);
  return { date, clock: clock.replace(/[  ]/g, ' ') };
}

// ── 4. H0 lead ───────────────────────────────────────────────────────────────

const LEAD_CANDIDATES = [
  ['Active people', 'wau'],
  ['People doing real work', 'work_users'],
  ['Cards added', 'cards_created'],
];

export function leadModel(kpi, weeks) {
  const cur = kpi?.current || {};
  const prev = kpi?.previous || {};
  const value = num(cur.signups);
  const before = num(prev.signups);

  let clause = '';
  const cands = LEAD_CANDIDATES.map(([label, f]) => ({ label, c: num(cur[f]), p: num(prev[f]) }))
    .filter((x) => x.c != null && x.p != null && x.p >= 15)
    .map((x) => ({ ...x, pct: ((x.c - x.p) / x.p) * 100 }))
    .filter((x) => Math.abs(x.pct) >= 15)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  if (cands[0]) {
    const x = cands[0];
    clause = `${x.label} are ${x.pct > 0 ? 'up' : 'down'} ${Math.round(Math.abs(x.pct))}%: ${nf(x.c)} against ${nf(x.p)}.`;
  }

  const pts = weekPoints(Array.isArray(weeks) ? weeks.slice(-26) : [], 'signups');
  const notes = [];
  let peak = -1;
  pts.forEach((p, i) => { if (p.state !== 'open' && p.v != null && (peak < 0 || p.v > pts[peak].v)) peak = i; });
  const openAt = pts.findIndex((p) => p.state === 'open' && p.v != null);
  // A peak in the settling week sits right beside the open point; its note
  // would land on the "so far" note, so the open point's note stands alone.
  if (peak >= 0 && !(openAt >= 0 && openAt - peak <= 1)) notes.push({ i: peak, lines: [plural(pts[peak].v, 'signup'), `week of ${dl(pts[peak].key)}`] });
  if (openAt >= 0) notes.push({ i: openAt, lines: [`${nf(pts[openAt].v)} so far`, 'this week'] });

  const last = pts.at(-1);
  const end = last ? dl(addDays(last.key, 6)) : '';
  const caption = pts.length
    ? `Signups a week, ${pts.length} weeks to ${end}. Weeks run Monday to Sunday, UTC. Hollow dot: this week so far. Dashed: last week, still settling. Drag to read a week.`
    : '';
  const label = pts.length
    ? `Signups a week for the last ${pts.length} weeks, to ${end}.${peak >= 0 ? ` The most was ${nf(pts[peak].v)}, the week of ${dl(pts[peak].key)}.` : ''}`
    : '';
  return {
    value, prev: before, valueText: nf(value), prevText: nf(before),
    delta: delta(value, before), clause, pts, notes, caption, label, fmt: 'count',
  };
}

// ── 5. the Today strip ───────────────────────────────────────────────────────

export function moneyText(stats) {
  const c = num(stats?.mrr_cents);
  return c == null ? '' : `$${Math.round(c / 100).toLocaleString('en-US')} a month`;
}

export function todayModel({ signups, weeks, active, stats, moneyPeople, now } = {}) {
  const t = signupsToday(signups, now);
  const usual = usualDay(weeks);
  return {
    signupsToday: t.n,
    capped: t.capped,
    usual,
    pace: usual != null && usual > 0 ? Math.min(1, t.n / usual) : null,
    active: num(active),
    paying: num(moneyPeople?.paying),
    money: moneyText(stats),
  };
}

// ── 6. the six tiles ─────────────────────────────────────────────────────────

export const TILES_CAPTION = 'Numbers: the last 7 days against the 7 before; Got started, its newest week whose signups have all had a full first day. Lines: the last 12 full weeks.';

const NO_DELTA = { text: '', dir: 'flat' };

// Day-one reading of admin_growth_series rows: the weeks whose first day every
// signup has had (the RPC's day_one_complete), and which of them are big enough
// to quote as a percent.
function dayOne(growth) {
  const rows = (Array.isArray(growth) ? growth : []).filter((r) => r && parseDay(r.week_start));
  const rate = (r) => {
    const n = num(r.day_one_n);
    const a = num(r.day_one_activated);
    return n != null && n > 0 && a != null ? a / n : null;
  };
  const complete = rows.filter((r) => r.day_one_complete);
  const newest = complete.at(-1) || null;
  const small = !!newest && !(num(newest.day_one_n) >= SMALL_N);
  const considered = complete.filter((r) => num(r.day_one_n) >= SMALL_N);
  const prev = !small && considered.length >= 2 ? considered.at(-2) : null;
  return { rows, complete, newest, small, considered, prev, rate };
}

function activationTile(m, growth) {
  const base = { id: m.id, label: m.label, sub: m.sub, delta: NO_DELTA, vs: '', spark: null, pending: false };
  if (growth === undefined) return { ...base, value: '', pending: true };
  const d = dayOne(growth);
  if (!d.newest || num(d.newest.day_one_n) == null || !(num(d.newest.day_one_n) > 0)) return { ...base, value: '—' };
  const vals = d.complete.slice(-12).map(d.rate);
  const spark = { vals, pct: true, dashedFlat: false };
  const vs = `week of ${dl(d.newest.week_start)}`;
  if (d.small) {
    return { ...base, value: `${nf(d.newest.day_one_activated)} of ${nf(d.newest.day_one_n)}`, vs, spark };
  }
  return {
    ...base, value: pc(d.rate(d.newest)), vs, spark,
    delta: d.prev ? delta(d.rate(d.newest), d.rate(d.prev), 'rate') : NO_DELTA,
  };
}

function checkoutTile(m, kpi) {
  const cur = kpi?.current || {};
  const prev = kpi?.previous || {};
  const s = num(cur.checkout_success);
  const o = num(cur.checkout_open);
  const ps = num(prev.checkout_success);
  const po = num(prev.checkout_open);
  const base = { id: m.id, label: m.label, sub: m.sub, delta: NO_DELTA, vs: '', spark: null, pending: false };
  if (s == null || o == null) return { ...base, value: '—' };
  if (o === 0 && (po == null || po === 0)) {
    return { ...base, sub: 'none started', value: 'none', vs: 'last 14 days', spark: { vals: [], pct: false, dashedFlat: true } };
  }
  // The pill is the change in the share of opened checkouts that finished, in
  // points, since it sits beside a ratio. It is shown only when both windows
  // opened at least SMALL_N; otherwise the vs line carries both windows' counts.
  const change = ps != null && po != null && o >= SMALL_N && po >= SMALL_N ? delta(s / o, ps / po, 'rate') : NO_DELTA;
  if (o === 0) {
    return { ...base, value: 'none', vs: `${nf(ps)} of ${nf(po)} the 7 before`, delta: NO_DELTA };
  }
  return {
    ...base, value: `${nf(s)} of ${nf(o)}`, delta: change,
    vs: ps != null && po != null ? `vs ${nf(ps)} of ${nf(po)}` : '',
  };
}

export function tileModels(kpi, weeks, growth) {
  const cur = kpi?.current || {};
  const prev = kpi?.previous || {};
  const done = (Array.isArray(weeks) ? weeks : []).filter((w) => w && w.complete).slice(-12);
  return MEASURES.map((m) => {
    if (m.id === 'activation_rate') return activationTile(m, growth);
    if (m.id === 'checkouts') return checkoutTile(m, kpi);
    const c = num(cur[m.id]);
    const p = num(prev[m.id]);
    const vals = done.map((w) => num(seriesValue(w, m.series)));
    return {
      id: m.id, label: m.label, sub: m.sub,
      value: c == null ? '—' : formatCount(c),
      delta: delta(c, p),
      vs: p == null ? '' : `vs ${formatCount(p)}`,
      spark: vals.length ? { vals, pct: false, dashedFlat: false } : null,
      pending: false,
    };
  });
}

// ── 7. H1 Search ─────────────────────────────────────────────────────────────

const mean = (a) => { const v = a.filter((x) => x != null); return v.length ? sum(v) / v.length : null; };

function wsum(entries, side = 'main') {
  let c = 0; let i = 0; let pw = 0; let pi = 0; let n = 0;
  for (const e of entries) {
    if (!e.present) continue;
    const s = side === 'home' ? e.homeRaw : e.raw;
    c += s.c; i += s.i; pw += s.pw; pi += s.pi; n += 1;
  }
  return { c, i, place: pi > 0 ? pw / pi : null, n };
}

function placeSentence(last, prev) {
  if (last == null || prev == null) return '';
  const a = last.toFixed(1);
  const b = prev.toFixed(1);
  if (a === b) return `Place held at ${a}`;
  return last < prev ? `Place moved up from ${b} to ${a}` : `Place slipped from ${b} to ${a}`;
}

export function searchChart(model, count = 28, field = 'views') {
  const days = model?.days || [];
  const N = days.length;
  const take = count === 'all' ? N : Math.min(count, N);
  const bars = days.slice(N - take).map((d, k) => {
    const fromEnd = take - 1 - k;
    return { key: d.day, label: d.label, v: d[field], tone: fromEnd < 7 ? 'now' : 'before', open: fromEnd < 3 };
  });
  const n = bars.length;
  let refs = [];
  if (field === 'views' && model?.ok && n >= 14) {
    refs = [
      { v: model.views.prev, i0: n - 14, i1: n - 8 },
      { v: model.views.last, i0: n - 7, i1: n - 1 },
    ];
  }
  let vrule = null;
  if (model?.ok && model.jump) {
    const at = model.jump.i - (N - n);
    if (at >= 0 && at < n) vrule = { i: at, lines: [`${dl(model.jump.day)}: views jump`] };
  }
  return { bars, refs, vrule };
}

const EMPTY_SEARCH = {
  ok: false, lastDay: null, lastLabel: '', head: '', sub: '', caption: '', label: '', fmt: 'count',
  chart: { bars: [], refs: [], vrule: null },
  views: { last: null, prev: null }, clicks: { last: null, prev: null }, place: { last: null, prev: null },
  ratio: null, jump: null, clicks7: null, days: [], tiles: [], topPages: [], pagesShown: 0,
  home: { clicks: null, views: null, ctr: null, place: null },
};

export function searchModel(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const byDay = new Map();
  for (const r of list) {
    const day = String(r?.day ?? '').slice(0, 10);
    if (!parseDay(day)) continue;
    const e = byDay.get(day) || { raw: { c: 0, i: 0, pw: 0, pi: 0 }, homeRaw: { c: 0, i: 0, pw: 0, pi: 0 } };
    const s = r.path === '/' ? e.homeRaw : e.raw;
    const imp = num(r.impressions) || 0;
    const pos = num(r.position);
    s.c += num(r.clicks) || 0;
    s.i += imp;
    // Place is impression-weighted; a row with no position carries no weight.
    if (pos != null && imp > 0) { s.pw += pos * imp; s.pi += imp; }
    byDay.set(day, e);
  }
  if (!byDay.size) return { ...EMPTY_SEARCH };

  const keys = [...byDay.keys()].sort();
  const first = keys[0];
  const lastDay = keys.at(-1);
  const span = Math.min(800, Math.round((dayMs(lastDay) - dayMs(first)) / DAY_MS) + 1);
  const days = [];
  for (let k = 0; k < span; k += 1) {
    const day = addDays(first, k);
    const e = byDay.get(day);
    if (!e) {
      days.push({ day, label: dl(day), present: false, raw: null, homeRaw: null, clicks: null, views: null, place: null, home: { clicks: null, views: null } });
    } else {
      days.push({
        day, label: dl(day), present: true, raw: e.raw, homeRaw: e.homeRaw,
        clicks: e.raw.c, views: e.raw.i, place: e.raw.pi > 0 ? e.raw.pw / e.raw.pi : null,
        home: { clicks: e.homeRaw.c, views: e.homeRaw.i },
      });
    }
  }
  const N = days.length;
  const lastLabel = dl(lastDay);
  const w7 = days.slice(Math.max(0, N - 7));
  const p7 = days.slice(Math.max(0, N - 14), Math.max(0, N - 7));
  const present14 = N >= 14 && days.slice(N - 14).every((d) => d.present);

  const viewsLast = mean(w7.map((d) => d.views));
  const viewsPrev = mean(p7.map((d) => d.views));
  const clicksLast = mean(w7.map((d) => d.clicks));
  const clicksPrev = mean(p7.map((d) => d.clicks));
  const placeLast = wsum(w7).place;
  const placePrev = wsum(p7).place;
  const ok = present14 && viewsLast != null && viewsPrev != null && viewsPrev > 0;
  const ratio = ok ? viewsLast / viewsPrev : null;

  // The day in the newest 14 with the largest rise over the day before, if it is
  // at least 1.5x the mean of the 7 days before it.
  let jump = null;
  if (ok) {
    let bestRise = 0;
    for (let i = N - 14; i < N; i += 1) {
      if (i < 7 || days[i].views == null || days[i - 1].views == null) continue;
      const base = mean(days.slice(i - 7, i).map((d) => d.views));
      const rise = days[i].views - days[i - 1].views;
      if (base != null && base > 0 && days[i].views >= 1.5 * base && rise > bestRise) {
        bestRise = rise;
        jump = { day: days[i].day, i, views: days[i].views };
      }
    }
  }

  let head = '';
  let sub = '';
  let caption = '';
  const shown = `Times a page of ours was shown in Google, a day, not counting the home page, to ${lastLabel}.`;
  if (ok) {
    if (ratio >= 1.5) head = `Google shows our pages ${multiple(ratio)}× as often`;
    else if (ratio <= 0.67) head = `Google shows our pages ${Math.round((1 - ratio) * 100)}% less often`;
    else head = `Google shows our pages about ${nf(Math.round(viewsLast))} times a day`;

    const viewsUp = viewsLast >= 1.15 * viewsPrev;
    const change = clicksPrev > 0 ? clicksLast / clicksPrev - 1 : clicksLast > 0 ? Infinity : 0;
    let clicksClause;
    if (viewsUp && change < 0.15 && change > -0.15) clicksClause = 'Clicks have not followed yet';
    else if (change === Infinity) clicksClause = 'Clicks are up from none';
    else if (Math.abs(change) >= 0.15) clicksClause = `Clicks are ${change > 0 ? 'up' : 'down'} ${Math.round(Math.abs(change) * 100)}%`;
    else clicksClause = `Clicks held at about ${nf(Math.round(clicksLast))} a day`;
    // A day each, last 7 days against the 7 before: whole numbers unless they would read the same.
    const [vNow, vBefore] = dayPair(viewsLast, viewsPrev);
    const [cNow, cBefore] = dayPair(clicksLast, clicksPrev);
    const viewsWord = viewsLast > viewsPrev ? 'up from' : viewsLast < viewsPrev ? 'down from' : 'level with';
    sub = `${vNow} views a day in the last 7 days, ${viewsWord} ${vBefore} the 7 before. ${clicksClause}.`;

    const place = placeSentence(placeLast, placePrev);
    const clicks = `clicks ${cNow} a day against ${cBefore}`;
    caption = `${shown} Dashed lines: the average of the last 7 days and of the 7 before. Outlined: the newest 3 days, which Google may still add to. ${place ? `${place}; ${clicks}` : `${clicks[0].toUpperCase()}${clicks.slice(1)}`}.`;
  } else {
    if (viewsLast != null) head = `Google showed our pages about ${nf(Math.round(viewsLast))} times a day`;
    caption = `${shown} Outlined: the newest 3 days, which Google may still add to.`;
  }

  // Page figures: the last 28 days to lastDay, home page on its own.
  const w28 = days.slice(Math.max(0, N - 28));
  const t28 = wsum(w28);
  const h28 = wsum(w28, 'home');
  const from28 = w28[0].day;
  const perPath = new Map();
  for (const r of list) {
    if (r?.path === '/' || !r?.path) continue;
    const day = String(r.day ?? '').slice(0, 10);
    if (!(day >= from28 && day <= lastDay)) continue;
    const e = perPath.get(r.path) || { c: 0, i: 0, pw: 0, pi: 0 };
    const imp = num(r.impressions) || 0;
    const pos = num(r.position);
    e.c += num(r.clicks) || 0;
    e.i += imp;
    if (pos != null && imp > 0) { e.pw += pos * imp; e.pi += imp; }
    perPath.set(r.path, e);
  }
  const pages = [...perPath.entries()].map(([path, e]) => ({ path, clicks: e.c, views: e.i, place: e.pi > 0 ? e.pw / e.pi : null }));
  pages.sort((a, b) => b.clicks - a.clicks || b.views - a.views || (a.path < b.path ? -1 : 1));
  const tiles = [
    { id: 'clicks', label: 'clicks, 28 days', value: nf(t28.c) },
    { id: 'views', label: 'times shown', value: nf(t28.i) },
    { id: 'ctr', label: 'clicked when shown', value: t28.i > 0 ? `${((t28.c / t28.i) * 100).toFixed(1)}%` : '—' },
    { id: 'place', label: 'average place', value: t28.place == null ? '—' : t28.place.toFixed(1) },
  ];

  const model = {
    ok, lastDay, lastLabel, head, sub, caption, fmt: 'count',
    views: { last: viewsLast, prev: viewsPrev }, clicks: { last: clicksLast, prev: clicksPrev }, place: { last: placeLast, prev: placePrev },
    ratio, jump, clicks7: sum(w7.map((d) => d.clicks)),
    days: days.map(({ raw, homeRaw, ...d }) => d),
    tiles, topPages: pages.slice(0, 10), pagesShown: pages.filter((p) => p.views > 0).length,
    home: { clicks: h28.c, views: h28.i, ctr: h28.i > 0 ? h28.c / h28.i : null, place: h28.place },
  };
  model.chart = searchChart(model, 28, 'views');
  model.label = head ? `${head}. Times shown in Google a day, 28 days to ${lastLabel}, home page left out.` : '';
  return model;
}

// ── 8. H2 Getting started ────────────────────────────────────────────────────

// The extreme clause for the newest considered week, or ''.
function extremeClause(considered, rate) {
  const cur = considered.at(-1);
  const prev = considered.at(-2);
  if (!cur || !prev) return '';
  const x = rate(cur);
  const p = rate(prev);
  if (x == null || p == null || x === p) return '';
  const low = x < p;
  const word = low ? 'lowest' : 'highest';
  for (let i = considered.length - 2; i >= 0; i -= 1) {
    const r = rate(considered[i]);
    if (r != null && (low ? r <= x : r >= x)) {
      return weeksBetween(considered[i].week_start, cur.week_start) >= 6
        ? `the ${word} since the week of ${dl(considered[i].week_start)}` : '';
    }
  }
  const span = weeksBetween(considered[0].week_start, cur.week_start) + 1;
  return span >= 6 ? `the ${word} in ${span} weeks` : '';
}

export function startModel(growth) {
  const d = dayOne(growth);
  const pts = d.rows.map((r) => {
    const n = num(r.day_one_n);
    const state = r.day_one_complete ? 'done' : 'open';
    const key = String(r.week_start).slice(0, 10);
    return { key, label: weekLabel(key, state), v: n != null && n >= 1 ? d.rate(r) : null, state, small: !(n >= SMALL_N) };
  });
  const homePts = d.complete.slice(-12).map((r) => {
    const key = String(r.week_start).slice(0, 10);
    return { key, label: weekLabel(key, 'done'), v: d.rate(r), state: 'done', small: !(num(r.day_one_n) >= SMALL_N) };
  });
  const caption = homePts.length
    ? `Share of each week’s signups who made something on their first day, the last ${homePts.length} full weeks.`
    : '';
  const base = { mode: null, head: '', dek: '', pts, homePts, caption, label: '', fmt: 'pct', newest: null, prev: null, extreme: '' };
  const n = d.newest && num(d.newest.day_one_n);
  if (!d.newest || !(n > 0)) return base;

  const a = num(d.newest.day_one_activated) ?? 0;
  const who = weekLabel(d.newest.week_start, 'done');
  const newest = { weekStart: String(d.newest.week_start).slice(0, 10), a, n, rate: d.rate(d.newest) };
  if (d.small) {
    return {
      ...base, mode: 'counts', newest,
      head: `${a} of ${n} made something on day one`,
      dek: `The ${n === 1 ? 'person' : `${n} people`} who signed up ${who}. Too few for a percentage.`,
      label: `${a} of ${n} people who signed up ${who} made something on day one.`,
    };
  }
  const rate = d.rate(d.newest);
  const extreme = extremeClause(d.considered, d.rate);
  let dek = '';
  let prev = null;
  if (d.prev) {
    const pr = d.rate(d.prev);
    prev = { weekStart: String(d.prev.week_start).slice(0, 10), a: num(d.prev.day_one_activated), n: num(d.prev.day_one_n), rate: pr };
    const when = weeksBetween(d.prev.week_start, d.newest.week_start) === 1 ? 'the week before' : `the week of ${dl(d.prev.week_start)}`;
    const dir = Math.round(rate * 100) === Math.round(pr * 100) ? 'level with' : rate < pr ? 'down from' : 'up from';
    dek = `${a} of the ${n} people who signed up ${who}, ${dir} ${pc(pr)} ${when}.`;
  } else {
    dek = `${a} of the ${n} people who signed up ${who}.`;
  }
  return {
    ...base, mode: 'rate', newest, prev, extreme, dek,
    head: `${pc(rate)} made something on day one${extreme ? `, ${extreme}` : ''}`,
    label: `Share of each week’s signups who made something on their first day. Newest full week, ${who}: ${pc(rate)}.`,
  };
}

// ── 9. H3 Coming back ────────────────────────────────────────────────────────

const BAND_LABELS = { '0': 'none', '1-2': '1–2', '3-5': '3–5', '6-12': '6–12', '13+': '13+' };
const DEVICE_LABELS = { desktop: 'Computer', mobile: 'Phone', tablet: 'Tablet', unknown: 'Unknown' };
const SOURCE_LABELS = { chatgpt: 'ChatGPT', share: 'Shared link', seo: 'SEO pages', google: 'Google', reddit: 'Reddit', direct: 'Direct', other: 'Other' };

const peopleText = (n) => (n == null ? '' : n === 1 ? '1 person' : `${nf(n)} people`);


export function returnModel(rows, since) {
  const byDim = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.dim !== 'string') continue;
    const n = num(r.n);
    const returned = num(r.returned);
    byDim.set(r.dim, { n, returned, v: n != null && n > 0 && returned != null ? returned / n : null });
  }
  const group = (prefix, labels) => [...byDim.entries()]
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, x]) => { const key = k.slice(prefix.length); return { key, label: labels[key] ?? key, ...x }; })
    .sort((a, b) => (b.v ?? -1) - (a.v ?? -1));

  const items = BAND_ORDER.map((k) => {
    const x = byDim.get(`band:${k}`);
    return { key: k, label: BAND_LABELS[k] ?? k, sub: peopleText(x?.n ?? null), v: x?.v ?? null, on: k === '13+', n: x?.n ?? null };
  });
  const top = byDim.get('band:13+');
  const none = byDim.get('band:0');
  const all = byDim.get('all') || null;
  const ratio = top && none && top.n >= SMALL_N && none.n >= SMALL_N && top.v != null && none.v != null && none.v > 0 ? top.v / none.v : null;

  let head = '';
  let dek = '';
  if (ratio != null && ratio >= 1.5) {
    head = `People who add 13 or more cards on day one come back ${multiple(ratio)}× as often`;
    dek = `${pc(top.v)} of them open the app again within a week, against ${pc(none.v)} of people who add none.`;
  } else if (all && all.v != null) {
    head = `${pc(all.v)} of new people open the app again within a week`;
    dek = `Of ${peopleText(all.n)}.`;
  }
  const sinceLabel = dl(since);
  // The lollipop axis: 0 to 50%, or to 100% when a group goes past half.
  const yMax = items.some((i) => i.v != null && i.v > 0.5) ? 1 : 0.5;
  const caption = `Cards added on day one, left to right, and the share who opened the app again within 7 days.${sinceLabel ? ` People who joined since ${sinceLabel}.` : ''}`;
  return {
    head, dek, caption, items, ratio, all, yMax,
    devices: group('device:', DEVICE_LABELS),
    sources: group('source:', SOURCE_LABELS),
    label: head ? `${head}. Share who opened the app again within 7 days, by cards added on day one.` : '',
    fmt: 'pct',
  };
}

// ── 10. H4 Sharing ───────────────────────────────────────────────────────────

export function shareModel(share, now) {
  const weekly = Array.isArray(share?.weekly) ? share.weekly.filter((w) => w && parseDay(w.week)) : [];
  const empty = { head: '', sub: '', bars: [], caption: '', label: '', fmt: 'count', openCount: null, fullWeeks: 0 };
  if (!weekly.length) {
    const t = num(share?.totals?.signed_up);
    return t == null ? empty : { ...empty, head: `${plural(t, 'signup')} from shares in the last 30 days` };
  }
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const open = weekly.at(-1);
  let full = weekly.slice(0, -1);
  const firstPartial = Number.isFinite(t) && weekly.length > 1 && dayMs(weekly[0].week) < t - 30 * DAY_MS;
  if (firstPartial) full = full.slice(1);

  const o = num(open.signed_up);
  const fullMax = full.length ? Math.max(...full.map((w) => num(w.signed_up) || 0)) : null;
  const total = num(share?.totals?.signed_up);
  let head = '';
  if (o != null && o >= 1 && full.length && o > fullMax) {
    head = `${plural(o, 'signup')} from shares this week so far, more than any of the ${full.length} full weeks before it`;
  } else if (total != null) {
    head = `${plural(total, 'signup')} from shares in the last 30 days`;
  }

  let best = null;
  for (const r of Array.isArray(share?.routes) ? share.routes : []) {
    const n = num(r?.signed_up);
    if (n != null && n > 0 && (!best || n > best.n)) best = { route: r.route, n };
  }
  const sub = best ? `${routeLabel(best.route)} brought the most in 30 days: ${nf(best.n)}` : '';

  const shownWeeks = firstPartial ? weekly.slice(1) : weekly;
  const bars = shownWeeks.map((w, i) => {
    const isOpen = i === shownWeeks.length - 1;
    const key = String(w.week).slice(0, 10);
    return {
      key, label: weekLabel(key, isOpen ? 'open' : 'done'), v: num(w.signed_up), tone: 'now', open: isOpen,
    };
  });
  return {
    head, sub, bars, fmt: 'count', openCount: o, fullWeeks: full.length,
    caption: `Signups through shared links, a week, last ${bars.length} weeks. Hollow bar and *: this week so far.`,
    label: head ? `${head}. Signups from shares by week, the newest week not finished.` : '',
  };
}

// ── 11. H5 Sources ───────────────────────────────────────────────────────────

export function sourcesModel(acq, label = (t) => t) {
  const rows = (Array.isArray(acq) ? acq : [])
    .filter((r) => r && num(r.signups) != null)
    .map((r) => ({ source: r.source, n: num(r.signups) }))
    .sort((a, b) => b.n - a.n || (String(a.source) < String(b.source) ? -1 : 1));
  const total = sum(rows.map((r) => r.n));
  const items = rows.slice(0, 7).map((r) => ({ key: String(r.source ?? ''), label: label(r.source) || 'Direct', n: r.n }));
  const rest = rows.slice(7);
  if (rest.length) items.push({ key: '_rest', label: `${rest.length} smaller sources`, n: sum(rest.map((r) => r.n)) });
  const google = rows.find((r) => r.source === 'google');
  const googlePct = google && total > 0 ? google.n / total : null;
  let dek = '';
  if (total > 0) {
    dek = googlePct != null
      ? `Google sent ${pc(googlePct)} of ${nf(total)} signups in the last 30 days.`
      : `${nf(total)} signups in the last 30 days.`;
  }
  return {
    items, total, googlePct, dek, max: rows[0]?.n ?? 0, fmt: 'count',
    label: total > 0 ? `Where ${nf(total)} signups came from in the last 30 days, the biggest sources first.` : '',
  };
}

// ── 12. H6 When people use it ────────────────────────────────────────────────

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const hour12 = (h) => ({ n: h % 12 === 0 ? 12 : h % 12, ap: h % 24 < 12 ? 'am' : 'pm' });
const hourText = (h) => { const x = hour12(h); return `${x.n} ${x.ap}`; };
function hourRange(h) {
  const a = hour12(h);
  const b = hour12((h + 1) % 24);
  return a.ap === b.ap ? `${a.n}–${b.n} ${a.ap}` : `${a.n} ${a.ap}–${b.n} ${b.ap}`;
}

export function heatModel(rows) {
  const cells = (Array.isArray(rows) ? rows : [])
    .map((r) => ({ dow: num(r?.dow), hour: num(r?.hour), n: num(r?.actors) }))
    .filter((c) => c.dow >= 1 && c.dow <= 7 && c.hour >= 0 && c.hour <= 23 && c.n != null)
    .sort((a, b) => a.dow - b.dow || a.hour - b.hour)
    .map((c) => ({
      ...c,
      title: `${c.n === 1 ? '1 person' : `${nf(c.n)} different people`}, ${DAY_NAMES[c.dow - 1]}s ${hourRange(c.hour)}, last 30 days`,
    }));
  let busiest = null;
  for (const c of cells) if (c.n > 0 && (!busiest || c.n > busiest.n)) busiest = { dow: c.dow, hour: c.hour, n: c.n };
  const text = busiest ? `Busiest: ${DAY_NAMES[busiest.dow - 1]} at ${hourText(busiest.hour)}` : '';
  return {
    cells, busiest, text, max: busiest?.n ?? 0,
    label: busiest ? `People in the app by weekday and hour, last 30 days, New York time. ${text}.` : '',
  };
}

// ── 13. newest signups ───────────────────────────────────────────────────────

export function newestRows(signups, now, label = (t) => t || 'Direct') {
  return (Array.isArray(signups) ? signups : []).slice(0, 5).map((r) => ({
    id: r.user_id ?? null,
    who: maskEmail(r.email),
    from: label(r.acquisition_source),
    did: num(r.clusters_made) > 0 ? 'made a cluster' : r.first_card_at ? 'made a card' : 'nothing yet',
    ago: ago(r.created_at, now),
  }));
}

// ── 14. Look at ──────────────────────────────────────────────────────────────

export function lookModel({ boards, approvals, errors, moneyPeople } = {}) {
  const rows = [];
  const b = num(boards);
  if (b != null) rows.push({ key: 'boards', n: b, label: b === 1 ? 'Board waiting for your OK' : 'Boards waiting for your OK', sub: '', go: 'boards', warn: false });
  const a = num(approvals);
  if (a != null && a > 0) rows.push({ key: 'approvals', n: a, label: a === 1 ? 'Public cluster to approve' : 'Public clusters to approve', sub: '', go: 'approvals', warn: false });
  const e = num(errors?.totals?.new);
  if (e != null) {
    const crash = num(errors?.totals?.crash_people);
    // The RPC's "people" on a crash are browser sessions.
    const sub = crash != null && crash > 0 ? `${crash} ${crash === 1 ? 'browser hit' : 'browsers hit'} a crash` : '';
    rows.push({ key: 'errors', n: e, label: e === 1 ? 'New problem in the last 2 days' : 'New problems in the last 2 days', sub, go: 'problems', warn: e > 0 });
  }
  const near = moneyPeople?.near_cap;
  const here = num(near?.active_7d);
  if (here != null) {
    const all = num(near.people);
    rows.push({ key: 'near_cap', n: here, label: 'Near the card limit and here in the last 7 days', sub: all != null ? `of ${nf(all)} near it in all` : '', go: 'money', warn: false });
  }
  return rows;
}

// ── 15. Inside index ─────────────────────────────────────────────────────────

export function indexModel({ lifetime, search, stats, share, sources, errors, email } = {}) {
  const users = num(lifetime?.users);
  const clicks7 = num(search?.clicks7);
  const shares = num(share?.totals?.shares);
  const fresh = num(errors?.totals?.new);
  const sent = Array.isArray(email) ? sum(email.map((r) => r?.sent)) : null;
  return [
    { id: 'growth', label: 'Growth', text: users == null ? '' : plural(users, 'person', 'people') },
    { id: 'search', label: 'Search', text: clicks7 == null ? '' : `${plural(clicks7, 'click')}, 7 days` },
    { id: 'money', label: 'Money', text: moneyText(stats) },
    { id: 'sharing', label: 'Sharing', text: shares == null ? '' : `${plural(shares, 'share')}, 30 days` },
    { id: 'sources', label: 'Sources', text: num(sources?.googlePct) == null ? '' : `Google ${pc(sources.googlePct)}` },
    { id: 'problems', label: 'Problems', text: fresh == null ? '' : `${nf(fresh)} new` },
    { id: 'emails', label: 'Emails', text: sent == null ? '' : `${nf(sent)} sent, 7 days` },
  ];
}

// ── 16. measure sheets ───────────────────────────────────────────────────────

export function measureSheet(id, { weeks, growth, kpi } = {}, range = '12w') {
  const m = MEASURES.find((x) => x.id === id);
  if (!m) return null;
  const count = range === '26w' ? 26 : 12;
  const tile = tileModels(kpi, weeks, growth).find((t) => t.id === id) || null;
  const head = { title: m.label, sub: m.sub, about: m.about, tile };

  if (id === 'checkouts') {
    const cur = kpi?.current || {};
    const prev = kpi?.previous || {};
    const lines = [];
    if (num(cur.checkout_success) != null && num(cur.checkout_open) != null) {
      lines.push(`${nf(cur.checkout_success)} of ${nf(cur.checkout_open)} checkouts finished, last 7 days`);
    }
    if (num(prev.checkout_success) != null && num(prev.checkout_open) != null) {
      lines.push(`${nf(prev.checkout_success)} of ${nf(prev.checkout_open)} the 7 before`);
    }
    return { ...head, pts: null, lines, caption: '', table: [] };
  }

  if (id === 'activation_rate') {
    const d = dayOne(growth);
    const s = startModel(growth);
    const pts = s.pts.filter((p) => p.state !== 'open').slice(-count);
    const table = d.complete.slice(-8).reverse().map((r) => {
      const n = num(r.day_one_n);
      const a = num(r.day_one_activated);
      const rate = d.rate(r);
      return {
        label: weekLabel(r.week_start, 'done'),
        value: n == null || n <= 0 || a == null ? '—' : n < SMALL_N ? `${a} of ${n}` : pc(rate),
        state: 'done',
      };
    });
    const note = d.newest
      ? `The big number is the week of ${dl(d.newest.week_start)} against the week before: a week counts once everyone in it has had a full first day.`
      : '';
    return {
      ...head, pts,
      caption: `Each point is a Monday-to-Sunday week, UTC. ${note}`.trim(),
      table,
    };
  }

  const rows = Array.isArray(weeks) && weeks.length ? weeks : Array.isArray(growth) ? growth : [];
  const pts = weekPoints(rows.slice(-count), m.series);
  const table = weekPoints(rows.filter((r) => r && r.complete), m.series).slice(-8).reverse().map((p) => ({
    label: p.label, value: p.v == null ? '—' : formatCount(p.v), state: p.state,
  }));
  const prevText = num(kpi?.previous?.[id]) == null ? '' : ` (${formatCount(kpi.previous[id])})`;
  return {
    ...head, pts,
    caption: `Each point is a Monday-to-Sunday week, UTC. The hollow point is this week so far; a dashed step is a week still settling. The big number is the last 7 days against the 7 before${prevText}.`,
    table,
  };
}
