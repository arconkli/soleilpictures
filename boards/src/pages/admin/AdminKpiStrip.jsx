// AdminKpiStrip — the hero "is the business healthy?" row at the top of the
// Analytics Overview. Eight KPIs, each with a period-over-period delta badge
// and — where a daily series exists — a sparkline.
//
// Data sources:
//   • rate / count metrics + their deltas  ← admin_kpi_summary {current, previous}
//   • MRR / ARPU value                      ← admin_stats (live)
//   • MRR / ARPU prior + MRR/active/signups sparklines ← admin_metrics_history
//   • cards sparkline                       ← admin_cards_per_day
//
// HONESTY (two-tier small-N rule): rates rest on tiny denominators at this
// scale, so a "100%" off n=1 would lie. A rate with denom ≥ 20 shows solid;
// 5–19 shows muted with an amber "directional · n=N" flag and NO delta; below 5
// is suppressed to "—" (the "x of N" sub still tells the honest story). Counts
// (signups, WAU, cards) are honest as raw numbers, so they're never gated. ARPU
// is a per-user average, so it's shown muted with its paying-user n until the
// payer count is trustworthy. Sparklines need ≥3 real points or they're hidden
// (metrics_daily is sparse — a 2-point line implies a trend that isn't there).

import { ResponsiveContainer, LineChart, Line } from 'recharts';
import { formatCount, formatCompact, formatPct, formatMoney, MIN_RATE_FLAG, MIN_RATE_SHOW, MIN_POINTS } from '../../lib/adminFormat.js';
import { NFlag } from './SmallN.jsx';
import { CHART } from './chartTheme.js';

const num = (x) => (x == null || (typeof x === 'number' && Number.isNaN(x)) ? null : Number(x));

// 'solid' (trust) | 'flag' (directional) | 'hide' (suppress) for a rate's denom.
function rateTier(denom) {
  const n = Number(denom) || 0;
  if (n < MIN_RATE_SHOW) return 'hide';
  if (n < MIN_RATE_FLAG) return 'flag';
  return 'solid';
}

function edgeValue(history, days, key) {
  if (!history || history.length === 0) return null;
  const lastDay = history[history.length - 1]?.day;
  if (!lastDay) return null;
  const cutoff = new Date(lastDay);
  cutoff.setDate(cutoff.getDate() - days);
  let edge = null;
  for (const row of history) {
    if (new Date(row.day) <= cutoff) edge = row; else break;
  }
  return edge ? num(edge[key]) : null;
}

function deltaInfo(cur, prev, kind) {
  if (cur == null || prev == null) return null;
  const diff = cur - prev;
  if (kind === 'rate') {
    const dir = Math.abs(diff) < 0.0005 ? 'flat' : diff > 0 ? 'up' : 'down';
    return { dir, text: `${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(1)}pp` };
  }
  if (prev === 0) { if (cur === 0) return null; return { dir: 'up', text: 'new' }; }
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
  // Raised floor: metrics_daily is sparse, and a 1–2 point line reads as a
  // trend. Below MIN_POINTS we show a muted "collecting" caption instead.
  const pts = (data || []).length;
  if (pts < MIN_POINTS) return <div className="admin-stat-spark-empty t-meta">collecting…</div>;
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

function KpiCard({ label, value, sub, delta, flagN, muted, spark, accent }) {
  return (
    <div className={`admin-stat-card ${accent ? 'is-accent' : ''} ${muted ? 'is-lown' : ''}`}>
      <div className="admin-stat-head">
        <div className="admin-stat-label">{label}</div>
        {delta ? <DeltaBadge delta={delta} /> : flagN != null ? <NFlag n={flagN} /> : null}
      </div>
      <div className="admin-stat-value">{value == null ? '—' : value}</div>
      {sub && <div className="admin-stat-sub">{sub}</div>}
      {spark}
    </div>
  );
}

export function AdminKpiStrip({ kpi, history = [], stats, perDay = [], days = 30, excludeInternal = true }) {
  const hasAny = !!kpi || !!stats || history.length > 0;
  if (!hasAny) return null;

  const cur  = kpi?.current  || {};
  const prev = kpi?.previous || {};

  const mrrSpark    = history.map((h) => ({ v: (num(h.mrr_cents) || 0) / 100 }));
  const activeSpark = history.map((h) => ({ v: num(h.active_users) || 0 }));
  const cardsSpark  = (perDay || []).map((r) => ({ v: num(r.cards) || 0 }));

  const paid     = num(stats?.tier_counts?.paid);
  const mrrCents = num(stats?.mrr_cents);
  const arpuNow  = mrrCents != null && paid ? mrrCents / paid : null;
  const mrrPrev  = edgeValue(history, days, 'mrr_cents');
  const paidPrev = edgeValue(history, days, 'paid_users');
  const arpuPrev = mrrPrev != null && paidPrev ? mrrPrev / paidPrev : null;

  // ── Rate cards, two-tier gated ───────────────────────────────────
  const rate = ({ label, rateKey, prevKey, numerKey, denomKey, denomLabel }) => {
    const denom = num(cur[denomKey]);
    const t = rateTier(denom);
    return {
      label,
      value: t === 'hide' || cur[rateKey] == null ? null : formatPct(cur[rateKey]),
      sub: denom != null ? `${formatCount(cur[numerKey] || 0)} of ${formatCount(denom)} ${denomLabel}` : '—',
      muted: t !== 'solid',
      flagN: t === 'flag' ? denom : null,
      delta: t === 'solid' ? deltaInfo(num(cur[rateKey]), num(prev[prevKey]), 'rate') : null,
    };
  };

  const arpuTier = rateTier(paid);

  const cards = [
    {
      label: 'Signups',
      value: cur.signups != null ? formatCount(cur.signups) : null,
      sub: `new · last ${days}d`,
      delta: deltaInfo(num(cur.signups), num(prev.signups), 'count'),
    },
    rate({ label: 'Activation rate', rateKey: 'activation_rate', prevKey: 'activation_rate', numerKey: 'activated', denomKey: 'signups', denomLabel: 'made a card' }),
    rate({ label: 'Demo → paid', rateKey: 'demo_to_paid_rate', prevKey: 'demo_to_paid_rate', numerKey: 'converted', denomKey: 'demo_base', denomLabel: 'converted' }),
    rate({ label: 'Checkout success', rateKey: 'checkout_success_rate', prevKey: 'checkout_success_rate', numerKey: 'checkout_success', denomKey: 'checkout_open', denomLabel: 'sessions' }),
    {
      label: 'Active users',
      value: cur.wau != null ? formatCount(cur.wau) : null,
      sub: 'active · last 7d',
      delta: deltaInfo(num(cur.wau), num(prev.wau), 'count'),
      spark: <Spark data={activeSpark} color={CHART.green} />,
    },
    {
      label: 'Cards created',
      value: cur.cards_created != null ? formatCompact(cur.cards_created) : null,
      sub: `last ${days}d`,
      delta: deltaInfo(num(cur.cards_created), num(prev.cards_created), 'count'),
      spark: <Spark data={cardsSpark} color={CHART.soleil} />,
    },
    {
      label: 'MRR',
      value: mrrCents != null ? formatMoney(mrrCents) : null,
      sub: paid != null ? `${formatCount(paid)} paying` : 'monthly recurring',
      delta: deltaInfo(mrrCents, mrrPrev, 'money'),
      spark: <Spark data={mrrSpark} color={CHART.soleil} />,
      accent: true,
    },
    {
      label: 'ARPU',
      value: arpuNow != null ? formatMoney(arpuNow) : null,
      sub: `per paying user · n=${formatCount(paid || 0)}`,
      muted: arpuTier !== 'solid',
      delta: arpuTier === 'solid' ? deltaInfo(arpuNow, arpuPrev, 'money') : null,
    },
  ];

  return (
    <section>
      <h2 className="admin-section-title">Business health</h2>
      <div className="admin-section-sub">
        Headline metrics for the selected window, with change vs the prior {days} days.
        {excludeInternal ? ' Internal/admin traffic excluded.' : ' Including internal/admin traffic.'}
      </div>
      <div className="admin-stat-grid">
        {cards.map((c) => <KpiCard key={c.label} {...c} />)}
      </div>
    </section>
  );
}
