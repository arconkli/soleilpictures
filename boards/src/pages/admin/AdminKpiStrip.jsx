// AdminKpiStrip — the hero "is the business healthy?" row at the top of the
// Analytics tab. Eight KPIs in themed, adjacent pairs (acquisition·activation,
// monetization, engagement, revenue), each with a period-over-period delta
// badge and — where a daily series exists — a sparkline.
//
// Data sources:
//   • rate / count metrics + their deltas  ← admin_kpi_summary {current, previous}
//   • MRR / ARPU value                      ← admin_stats (live)
//   • MRR / ARPU prior + MRR/active/signups sparklines ← admin_metrics_history
//   • cards sparkline                       ← admin_cards_per_day
//
// metrics_daily has no backfill, so the history series is sparse early on —
// every delta returns "no badge" when its prior datapoint is missing rather
// than rendering a false ▲ or a NaN.

import { ResponsiveContainer, LineChart, Line } from 'recharts';
import { formatCount, formatCompact, formatPct, formatMoney } from '../../lib/adminFormat.js';

const SOLEIL = '#ffa500';
const GREEN  = '#50c878';

const num = (x) => (x == null || (typeof x === 'number' && Number.isNaN(x)) ? null : Number(x));

// The history row at or just before (latest day − days): the window's start
// value for an over-the-window delta. null when the series doesn't reach back
// that far (cold start) → caller renders no delta badge.
function edgeValue(history, days, key) {
  if (!history || history.length === 0) return null;
  const lastDay = history[history.length - 1]?.day;
  if (!lastDay) return null;
  const cutoff = new Date(lastDay);
  cutoff.setDate(cutoff.getDate() - days);
  let edge = null;
  for (const row of history) {
    if (new Date(row.day) <= cutoff) edge = row; else break;  // asc by day
  }
  return edge ? num(edge[key]) : null;
}

// kind: 'count' | 'money' | 'rate'. Returns null (no badge) when either side is
// unknown. Counts/money → relative %, rates → percentage-points. All current
// KPIs are "up is good", so dir maps straight to the colour class.
function deltaInfo(cur, prev, kind) {
  if (cur == null || prev == null) return null;
  const diff = cur - prev;
  if (kind === 'rate') {
    const dir = Math.abs(diff) < 0.0005 ? 'flat' : diff > 0 ? 'up' : 'down';
    const pp = (diff * 100).toFixed(1);
    return { dir, text: `${diff >= 0 ? '+' : ''}${pp}pp` };
  }
  if (prev === 0) {
    if (cur === 0) return null;
    return { dir: 'up', text: 'new' };
  }
  const pct = (diff / prev) * 100;
  const dir = diff === 0 ? 'flat' : diff > 0 ? 'up' : 'down';
  return { dir, text: `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%` };
}

function DeltaBadge({ delta }) {
  if (!delta) return null;
  const arrow = delta.dir === 'up' ? '▲' : delta.dir === 'down' ? '▼' : '·';
  return <span className={`admin-stat-delta is-${delta.dir}`}>{arrow} {delta.text}</span>;
}

function Spark({ data, color }) {
  if (!data || data.length < 2) return null;
  return (
    <div className="admin-stat-spark">
      <ResponsiveContainer width="100%" height={30}>
        <LineChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function KpiCard({ label, value, sub, delta, spark, accent }) {
  return (
    <div className={`admin-stat-card ${accent ? 'is-accent' : ''}`}>
      <div className="admin-stat-head">
        <div className="admin-stat-label">{label}</div>
        <DeltaBadge delta={delta} />
      </div>
      <div className="admin-stat-value">{value == null ? '—' : value}</div>
      {sub && <div className="admin-stat-sub">{sub}</div>}
      {spark}
    </div>
  );
}

export function AdminKpiStrip({ kpi, history = [], stats, perDay = [], days = 30 }) {
  const hasAny = !!kpi || !!stats || history.length > 0;
  if (!hasAny) return null;

  const cur  = kpi?.current  || {};
  const prev = kpi?.previous || {};

  // Sparkline series (sparse-safe; Spark hides itself under 2 points).
  const mrrSpark    = history.map((h) => ({ v: (num(h.mrr_cents) || 0) / 100 }));
  const activeSpark = history.map((h) => ({ v: num(h.active_users) || 0 }));
  const cardsSpark  = (perDay || []).map((r) => ({ v: num(r.cards) || 0 }));

  // Revenue (live value, history-derived prior).
  const paid     = num(stats?.tier_counts?.paid);
  const mrrCents = num(stats?.mrr_cents);
  const arpuNow  = mrrCents != null && paid ? mrrCents / paid : null;
  const mrrPrev  = edgeValue(history, days, 'mrr_cents');
  const paidPrev = edgeValue(history, days, 'paid_users');
  const arpuPrev = mrrPrev != null && paidPrev ? mrrPrev / paidPrev : null;

  const cards = [
    // Acquisition & activation
    {
      label: 'Signups',
      value: cur.signups != null ? formatCount(cur.signups) : null,
      sub: `new · last ${days}d`,
      delta: deltaInfo(num(cur.signups), num(prev.signups), 'count'),
    },
    {
      label: 'Activation rate',
      value: cur.activation_rate != null ? formatPct(cur.activation_rate) : null,
      sub: cur.signups != null ? `${formatCount(cur.activated || 0)} of ${formatCount(cur.signups)} made a card` : 'signup → first card',
      delta: deltaInfo(num(cur.activation_rate), num(prev.activation_rate), 'rate'),
    },
    // Monetization
    {
      label: 'Demo → paid',
      value: cur.demo_to_paid_rate != null ? formatPct(cur.demo_to_paid_rate) : null,
      sub: cur.demo_base != null ? `${formatCount(cur.converted || 0)} of ${formatCount(cur.demo_base)} converted` : 'in-window cohort',
      delta: deltaInfo(num(cur.demo_to_paid_rate), num(prev.demo_to_paid_rate), 'rate'),
    },
    {
      label: 'Checkout success',
      value: cur.checkout_success_rate != null ? formatPct(cur.checkout_success_rate) : null,
      sub: cur.checkout_open != null ? `${formatCount(cur.checkout_success || 0)} of ${formatCount(cur.checkout_open)} sessions` : 'opened → completed',
      delta: deltaInfo(num(cur.checkout_success_rate), num(prev.checkout_success_rate), 'rate'),
    },
    // Engagement
    {
      label: 'Active users',
      value: cur.wau != null ? formatCount(cur.wau) : null,
      sub: 'active · last 7d',
      delta: deltaInfo(num(cur.wau), num(prev.wau), 'count'),
      spark: <Spark data={activeSpark} color={GREEN} />,
    },
    {
      label: 'Cards created',
      value: cur.cards_created != null ? formatCompact(cur.cards_created) : null,
      sub: `last ${days}d`,
      delta: deltaInfo(num(cur.cards_created), num(prev.cards_created), 'count'),
      spark: <Spark data={cardsSpark} color={SOLEIL} />,
    },
    // Revenue
    {
      label: 'MRR',
      value: mrrCents != null ? formatMoney(mrrCents) : null,
      sub: paid != null ? `${formatCount(paid)} paying` : 'monthly recurring',
      delta: deltaInfo(mrrCents, mrrPrev, 'money'),
      spark: <Spark data={mrrSpark} color={SOLEIL} />,
      accent: true,
    },
    {
      label: 'ARPU',
      value: arpuNow != null ? formatMoney(arpuNow) : null,
      sub: 'per paying user',
      delta: deltaInfo(arpuNow, arpuPrev, 'money'),
    },
  ];

  return (
    <section>
      <h2 className="admin-section-title">Business health</h2>
      <div className="admin-section-sub">
        Headline metrics for the selected window, with change vs the prior {days} days.
      </div>
      <div className="admin-stat-grid">
        {cards.map((c) => (
          <KpiCard key={c.label} {...c} />
        ))}
      </div>
    </section>
  );
}
