// ActivationFunnel — signed_up → first_X_at milestone counts as a horizontal
// bar (bars are honest at any N — a bar of 1 reads as 1). Extracted from the
// old AdminAnalyticsTab. Small-N: the % labels are only trustworthy off a
// reasonable cohort, so below the flag floor we show counts only and say so.

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList } from 'recharts';
import { formatCount, formatPct, MIN_RATE_FLAG } from '../../../../lib/adminFormat.js';
import { CHART } from '../../chartTheme.js';
import { PanelNote } from '../../SmallN.jsx';

const STEPS = [
  { key: 'signed_up',      label: 'Signed up' },
  { key: 'first_board',    label: 'Created board' },
  { key: 'first_card',     label: 'Created card' },
  { key: 'first_share',    label: 'Shared a board' },
  { key: 'first_backlink', label: 'Linked a doc' },
  { key: 'first_paid',     label: 'Became paid' },
];

export function ActivationFunnel({ data, days = 30 }) {
  if (!data) return null;
  const signed = Number(data.signed_up) || 0;
  const top = Math.max(1, signed);
  const showPct = signed >= MIN_RATE_FLAG;
  const chartData = STEPS.map((s) => ({
    name: s.label,
    count: Number(data[s.key] || 0),
    pct: Number(data[s.key] || 0) / top,
  }));

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Activation milestones</h3>
        <span className="admin-chart-sub t-meta">post-signup product milestones · n={formatCount(signed)} signed up · last {days}d</span>
      </header>
      <div className="admin-chart-body">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 6, right: 64, bottom: 6, left: 8 }}>
            <XAxis type="number" {...CHART.axis} allowDecimals={false} />
            <YAxis dataKey="name" type="category" {...CHART.axis} width={130} />
            <Tooltip {...CHART.tooltip}
              formatter={(v, _n, p) => [`${formatCount(v)}${showPct ? ` (${formatPct(p.payload.pct)})` : ''}`, 'users']} />
            <Bar dataKey="count" radius={[0, 3, 3, 0]} {...CHART.noAnim}>
              {chartData.map((_, i) => <Cell key={i} fill={CHART.soleil} fillOpacity={0.4 + 0.55 * (1 - i / chartData.length)} />)}
              <LabelList dataKey={showPct ? 'pct' : 'count'} position="right"
                formatter={(v) => (showPct ? formatPct(v) : formatCount(v))} fill="var(--ink-2)" fontSize={11} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {!showPct && (
          <PanelNote>Showing counts, not rates — cohort is below {MIN_RATE_FLAG} signups, so conversion percentages aren't yet meaningful.</PanelNote>
        )}
      </div>
    </section>
  );
}
