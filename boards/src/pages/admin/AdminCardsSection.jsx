// AdminCardsSection — three panels stacked:
//   1. Cards-per-day line (last 30 days)
//   2. Most-used card kinds (top 10, horizontal bar)
//   3. Kind × tier stacked bar (which tier uses which kinds)

import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  Cell,
} from 'recharts';

const TIER_COLORS = {
  admin:    '#ffa500',
  paid:     '#50c878',
  demo:     '#9aa0aa',
  waitlist: '#7a8090',
};
const SOLEIL = '#ffa500';

function shortDate(d) {
  const dt = new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

export function AdminCardsSection({ perDay, cardStats }) {
  const byKind = cardStats?.by_kind || {};
  const kindByTier = cardStats?.kind_by_tier || {};
  const total = cardStats?.total || 0;

  // Top 10 kinds overall, sorted desc
  const topKinds = Object.entries(byKind)
    .map(([k, n]) => ({ kind: k, count: Number(n) || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Same kinds, broken out by tier (for the stacked bar)
  const stacked = topKinds.map((k) => {
    const byT = kindByTier[k.kind] || {};
    return {
      kind: k.kind,
      admin:    Number(byT.admin)    || 0,
      paid:     Number(byT.paid)     || 0,
      demo:     Number(byT.demo)     || 0,
      waitlist: Number(byT.waitlist) || 0,
    };
  });

  return (
    <>
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Cards created · last 30 days</h3>
          <span className="admin-chart-sub t-meta">
            {(perDay || []).reduce((a, b) => a + (b.cards || 0), 0).toLocaleString()} cards added
          </span>
        </header>
        <div className="admin-chart-body">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={(perDay || []).map((r) => ({ ...r, label: shortDate(r.day) }))}
                       margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--line-1)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" stroke="var(--ink-3)" fontSize={10} interval="preserveStartEnd" tickLine={false} axisLine={false} />
              <YAxis stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--ink-1)' }}
                itemStyle={{ color: SOLEIL }}
              />
              <Line type="monotone" dataKey="cards" stroke={SOLEIL} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="admin-charts-row">

        {/* Top kinds horizontal bar */}
        <section className="admin-chart-panel">
          <header className="admin-chart-head">
            <h3 className="admin-chart-title">Most-used card kinds</h3>
            <span className="admin-chart-sub t-meta">
              {total.toLocaleString()} total
            </span>
          </header>
          <div className="admin-chart-body">
            <ResponsiveContainer width="100%" height={Math.max(220, topKinds.length * 28)}>
              <BarChart data={topKinds} layout="vertical"
                        margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--line-1)" strokeDasharray="2 4" horizontal={false} />
                <XAxis type="number" stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="kind" stroke="var(--ink-2)" fontSize={11} tickLine={false} axisLine={false} width={84} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,165,0,.08)' }}
                  contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="count" fill={SOLEIL} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Kind × tier stacked bar */}
        <section className="admin-chart-panel">
          <header className="admin-chart-head">
            <h3 className="admin-chart-title">Kind usage by tier</h3>
            <span className="admin-chart-sub t-meta">who uses what</span>
          </header>
          <div className="admin-chart-body">
            <ResponsiveContainer width="100%" height={Math.max(220, topKinds.length * 28)}>
              <BarChart data={stacked} layout="vertical"
                        margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--line-1)" strokeDasharray="2 4" horizontal={false} />
                <XAxis type="number" stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="kind" stroke="var(--ink-2)" fontSize={11} tickLine={false} axisLine={false} width={84} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,.04)' }}
                  contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--ink-2)' }} iconType="circle" iconSize={8} />
                <Bar dataKey="admin"    stackId="t" fill={TIER_COLORS.admin}    />
                <Bar dataKey="paid"     stackId="t" fill={TIER_COLORS.paid}     />
                <Bar dataKey="demo"     stackId="t" fill={TIER_COLORS.demo}     />
                <Bar dataKey="waitlist" stackId="t" fill={TIER_COLORS.waitlist} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

      </div>
    </>
  );
}
