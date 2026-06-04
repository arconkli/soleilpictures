// LifespanDistribution — how many days each user has actually been active (a
// "stickiness" view). Reads the admin_user_lifespan jsonb
// { total_users, median_active_days, p90_active_days, mean_active_days,
//   buckets:[{label, ord, users}] } and renders a median headline + histogram.
//
// Honesty: "active days observed so far" is right-censored — a user who signed
// up yesterday can't have many active days yet, and tracking only began recently
// — so this skews low and fills in over time. Gated below MIN_RATE_SHOW users.

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LabelList } from 'recharts';
import { formatCount, MIN_RATE_SHOW } from '../../../../lib/adminFormat.js';
import { CHART } from '../../chartTheme.js';
import { PanelNote, ChartPlaceholder } from '../../SmallN.jsx';

const SOLEIL = '#ffa500';
// Canonical bucket order, so a missing bucket still shows as a 0-height bar and
// the x-axis reads left→right by tenure regardless of which buckets are populated.
const BUCKETS = ['0–1', '2', '3–4', '5–7', '8–14', '15+'];

function Panel({ children }) {
  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Active days per user</h3>
        <span className="admin-chart-sub t-meta">how many distinct days each user has opened the app — a stickiness measure</span>
      </header>
      <div className="admin-chart-body">{children}</div>
    </section>
  );
}

export function LifespanDistribution({ data }) {
  const total = Number(data?.total_users) || 0;
  if (total < MIN_RATE_SHOW) {
    return (
      <Panel>
        <ChartPlaceholder
          title="Lifespan is still collecting"
          sub={`Needs ≥${MIN_RATE_SHOW} signed-up users. So far: ${total}.`}
        />
      </Panel>
    );
  }

  const counts = new Map((data?.buckets || []).map((b) => [b.label, Number(b.users) || 0]));
  const chartData = BUCKETS.map((label) => ({ label, users: counts.get(label) || 0 }));
  const median = data?.median_active_days ?? 0;
  const p90 = data?.p90_active_days ?? 0;
  const fmtDays = (n) => `${Number(n)} day${Number(n) === 1 ? '' : 's'}`;

  return (
    <Panel>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ font: '700 26px/1 var(--font-display, inherit)', color: 'var(--ink-0)' }}>{fmtDays(median)}</span>
        <span className="t-meta" style={{ color: 'var(--ink-3)' }}>
          median active days · p90 {fmtDays(p90)} · {formatCount(total)} users
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 12, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid {...CHART.grid} />
          <XAxis dataKey="label" {...CHART.axis} />
          <YAxis {...CHART.axis} allowDecimals={false} />
          <Tooltip {...CHART.tooltip} cursor={{ fill: 'rgba(255,165,0,.08)' }}
            formatter={(v) => [`${formatCount(v)} user${Number(v) === 1 ? '' : 's'}`, 'users']}
            labelFormatter={(l) => `${l} active day${l === '0–1' ? '' : 's'}`} />
          <Bar dataKey="users" fill={SOLEIL} radius={[3, 3, 0, 0]} {...CHART.noAnim}>
            <LabelList dataKey="users" position="top" formatter={(v) => (v > 0 ? formatCount(v) : '')} fill="var(--ink-2)" fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <PanelNote>
        Distinct active days observed so far — right-censored: recent signups and the recent start of
        tracking skew this low, and it grows as cohorts age. A stickiness measure (how often they come
        back), not time-until-churn. Compare to your own past snapshots.
      </PanelNote>
    </Panel>
  );
}
