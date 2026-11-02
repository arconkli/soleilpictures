// phonePanel.js — the admin phone panel's view model (pages/admin/phone/).
//
// Pure: every figure comes from the RPCs the desktop admin already reads
// (admin_kpi_summary, admin_weekly_series, admin_recent_signups,
// admin_active_now, admin_stats, admin_error_groups, the approvals and boards
// counts), under the Overview's defaults (team left out, verified only). This
// file only arranges them and words the comparisons; it never derives a new
// measure. The Posts half reads the TikTok page's days.json (via
// /api/admin/posts/) and its "At 72 h: …" note.

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// ── Today ───────────────────────────────────────────────────────────────────

// Local midnight of `now`.
export function startOfDay(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Signups since local midnight, from admin_recent_signups rows (newest first).
// `capped` when every row fetched is from today, so the count may be short.
export function signupsToday(rows, now = new Date()) {
  const from = startOfDay(now).getTime();
  const list = Array.isArray(rows) ? rows : [];
  const n = list.filter((r) => new Date(r.created_at).getTime() >= from).length;
  return { n, capped: list.length > 0 && n === list.length };
}

// A usual day's signups: the daily average over the last four complete weeks
// of admin_weekly_series (oldest first). null with fewer than two such weeks.
export function usualDay(weeks) {
  const done = (Array.isArray(weeks) ? weeks : []).filter((w) => w.complete && !w.settling && num(w.signups) != null);
  const last = done.slice(-4);
  if (last.length < 2) return null;
  const total = last.reduce((s, w) => s + Number(w.signups), 0);
  return Math.round(total / (last.length * 7));
}

// This week against last. kind 'count' → a percent; 'rate' (0..1) → points.
export function delta(cur, prev, kind = 'count') {
  const c = num(cur);
  const p = num(prev);
  if (c == null || p == null) return { text: '', dir: 'flat' };
  if (kind === 'rate') {
    const pts = Math.round((c - p) * 100);
    if (pts === 0) return { text: 'same', dir: 'flat' };
    return { text: `${pts > 0 ? '▲' : '▼'} ${Math.abs(pts)} pts`, dir: pts > 0 ? 'up' : 'down' };
  }
  if (c === p) return { text: 'same', dir: 'flat' };
  if (p === 0) return { text: `▲ ${c} new`, dir: 'up' };
  const pct = Math.round(((c - p) / p) * 100);
  if (pct === 0) return { text: 'same', dir: 'flat' };
  return { text: `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%`, dir: pct > 0 ? 'up' : 'down' };
}

// Polyline points for a small line chart of `values` in a w×h box. Returns
// { points, last: {x, y} } or null with fewer than two values.
export function sparkPoints(values, w = 70, h = 24, pad = 2) {
  const v = (Array.isArray(values) ? values : []).map(num).filter((x) => x != null);
  if (v.length < 2) return null;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  const pts = v.map((x, i) => {
    const px = pad + (i * (w - 2 * pad)) / (v.length - 1);
    const py = hi === lo ? h / 2 : pad + (1 - (x - lo) / span) * (h - 2 * pad);
    return [Math.round(px * 10) / 10, Math.round(py * 10) / 10];
  });
  return { points: pts.map((p) => p.join(',')).join(' '), last: { x: pts.at(-1)[0], y: pts.at(-1)[1] } };
}

export function formatCount(n) {
  const v = num(n);
  if (v == null) return '–';
  return Math.round(v).toLocaleString('en-US');
}

// The "This week vs last" rows. `series` is the weekly field charted (the last
// 12 weeks, this one included), or null when no weekly series counts it.
export const MEASURES = [
  { id: 'signups', label: 'Signups', sub: 'code entered', kind: 'count', series: 'signups',
    about: 'People who signed up and entered their code, the same count as the Overview.' },
  { id: 'activation_rate', label: 'Got started', sub: 'made something, day one', kind: 'rate', series: null,
    about: 'Of this week’s signups, the share who made their first card.' },
  { id: 'wau', label: 'Active people', sub: 'opened the app', kind: 'count', series: 'active_users',
    about: 'People who opened the app in the last 7 days.' },
  { id: 'work_users', label: 'Did real work', sub: 'added to a cluster', kind: 'count', series: 'work_users',
    about: 'People who added or changed something in a cluster in the last 7 days.' },
  { id: 'cards_created', label: 'Cards added', sub: '', kind: 'count', series: 'cards',
    about: 'Cards made in the last 7 days.' },
  { id: 'checkouts', label: 'Checkouts', sub: 'finished of started', kind: 'checkout', series: null,
    about: 'Checkouts finished, out of the checkouts opened, in the last 7 days.' },
];

export function measureRows(kpi, weeks) {
  const cur = kpi?.current || {};
  const prev = kpi?.previous || {};
  const wk = (Array.isArray(weeks) ? weeks : []).slice(-12);
  return MEASURES.map((m) => {
    let value;
    let d;
    if (m.kind === 'rate') {
      value = num(cur[m.id]) == null ? '–' : `${Math.round(cur[m.id] * 100)}%`;
      d = delta(cur[m.id], prev[m.id], 'rate');
    } else if (m.kind === 'checkout') {
      value = `${formatCount(cur.checkout_success)} of ${formatCount(cur.checkout_open)}`;
      d = delta(cur.checkout_success, prev.checkout_success);
    } else {
      value = formatCount(cur[m.id]);
      d = delta(cur[m.id], prev[m.id]);
    }
    const values = m.series ? wk.map((w) => w[m.series]) : [];
    // The line ends at the last complete week: a week so far always dips, and
    // would read as a fall. The sheet's bars still show it, labelled.
    const whole = m.series ? wk.filter((w) => w.complete).map((w) => w[m.series]) : [];
    return { ...m, value, delta: d, values, weeks: wk.map((w) => w.week_start), spark: m.series ? sparkPoints(whole) : null };
  });
}

// "12 min", "3 h", "2 d".
export function ago(ts, now = new Date()) {
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now.getTime() - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

export function initials(email) {
  const local = String(email || '').split('@')[0].replace(/[^A-Za-z0-9._-]/g, '');
  const parts = local.split(/[._-]+/).filter((p) => /^[A-Za-z]/.test(p));
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || local).slice(0, 2);
  return (s || '?').toUpperCase();
}

// One "Newest signups" row. `label` turns a channel token into its wording
// (the Users list's channelLabel).
export function signupRow(r, now = new Date(), label = (t) => t || 'Direct') {
  const made = num(r.clusters_made) > 0 ? 'made a cluster'
    : r.first_card_at ? 'made a card'
    : 'hasn’t made anything yet';
  return {
    id: r.user_id,
    initials: initials(r.email),
    name: r.email || 'someone',
    from: label(r.acquisition_source),
    made,
    started: !!r.first_card_at,
    when: ago(r.created_at, now),
  };
}

// ── Posts ───────────────────────────────────────────────────────────────────

// "At 72 h: #4 490 (0.6×), #7 1.3k (1.7×)." → [{n, views, ratio}], or null
// when the note doesn't read that way (the page then shows the note as is).
export function parseNote(note) {
  const m = /^\s*At\s+(\d+)\s*h:\s*(.+)$/i.exec(String(note || ''));
  if (!m) return null;
  const out = [];
  for (const part of m[2].split(',')) {
    const p = /#(\d+)\s+([\d.]+)\s*([km]?)\s*\(([\d.]+)\s*×\)/i.exec(part);
    if (!p) continue;
    const mult = p[3].toLowerCase() === 'k' ? 1e3 : p[3].toLowerCase() === 'm' ? 1e6 : 1;
    out.push({ n: Number(p[1]), views: Math.round(Number(p[2]) * mult), shown: `${p[2]}${p[3]}`, ratio: Number(p[4]) });
  }
  return out.length ? { hours: Number(m[1]), posts: out } : null;
}

// Bar widths (0..1) against the best of the list.
export function noteBars(parsed) {
  if (!parsed) return [];
  const max = Math.max(...parsed.posts.map((p) => p.views), 1);
  return parsed.posts.map((p) => ({ ...p, width: p.views / max, up: p.ratio >= 1 }));
}

// The local date as YYYY-MM-DD (the page names its days that way).
export function localDate(now = new Date()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Today's posts not yet marked posted: the Posts tab's badge.
export function unpostedCount(days, posted, now = new Date()) {
  const today = (Array.isArray(days) ? days : []).find((d) => d.date === localDate(now));
  if (!today) return 0;
  const done = new Set([...(posted || [])].map(Number));
  return (today.posts || []).filter((p) => !done.has(Number(p.n))).length;
}

// "Sunday, Nov 1" for a YYYY-MM-DD day.
export function dayLabel(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  if (!y || !m || !d) return String(date);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

// The proxied address of one slide.
export function slideUrl(date, file) {
  return `/api/admin/posts/${date}/${file}`;
}
