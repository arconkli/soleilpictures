// RetentionByExperiment — the pooled retention curve split by A/B arm for one
// experiment (boards/src/lib/experiments.js). Reads admin_retention_by_experiment
// { arm, day_offset, eligible, active, active_pct }. Same observable-window
// honesty as RetentionBySource: clip to the contiguous prefix where some arm
// clears the floor, only draw an arm once it itself clears MIN_RATE_SHOW, and
// gate to a placeholder below MIN_POINTS days.
//
// At early-stage volume arms will be sparse — that's expected; the widget shows
// the "still collecting" placeholder until cohorts mature rather than a fake line.

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { formatPct, MIN_RATE_SHOW, MIN_POINTS } from '../../../../lib/adminFormat.js';
import { CHART } from '../../chartTheme.js';
import { PanelNote, ChartPlaceholder } from '../../SmallN.jsx';

// Ordered palette reused for whatever arm ids the experiment defines (A/B/...).
const PALETTE = ['#ffa500', '#5b8def', '#43c59e', '#c678dd'];

function Panel({ expKey, children }) {
  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Retention by experiment arm</h3>
        <span className="admin-chart-sub t-meta">% active N days after signup · split by arm · {expKey}</span>
      </header>
      <div className="admin-chart-body">{children}</div>
    </section>
  );
}

export function RetentionByExperiment({ expKey = '', rows = [] }) {
  if (!rows.length) return null; // experiment not enrolled / nobody stamped yet
  const byOffset = new Map();
  const maxElig = {};
  const arms = [...new Set(rows.map((r) => r.arm))].sort();
  const colorFor = Object.fromEntries(arms.map((a, i) => [a, PALETTE[i % PALETTE.length]]));
  for (const r of rows) {
    const d = Number(r.day_offset);
    if (!byOffset.has(d)) byOffset.set(d, { d });
    const o = byOffset.get(d);
    o[r.arm] = r.active_pct == null ? null : Number(r.active_pct);
    o[`n_${r.arm}`] = Number(r.eligible) || 0;
    maxElig[r.arm] = Math.max(maxElig[r.arm] || 0, Number(r.eligible) || 0);
  }

  const ordered = [...byOffset.values()].sort((a, b) => a.d - b.d);
  const data = [];
  for (const o of ordered) {
    if (arms.some((a) => (o[`n_${a}`] || 0) >= MIN_RATE_SHOW)) data.push(o); else break;
  }

  if (data.length < MIN_POINTS) {
    return (
      <Panel expKey={expKey}>
        <ChartPlaceholder
          title="Per-arm retention is still collecting"
          sub={`Needs ≥${MIN_POINTS} days each reached by ≥${MIN_RATE_SHOW} enrolled users within a single arm.`}
        />
      </Panel>
    );
  }

  const shown = arms.filter((a) => (maxElig[a] || 0) >= MIN_RATE_SHOW);
  const hidden = arms.filter((a) => (maxElig[a] || 0) < MIN_RATE_SHOW);

  return (
    <Panel expKey={expKey}>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
          <CartesianGrid {...CHART.grid} />
          <XAxis dataKey="d" {...CHART.axis} tickFormatter={(v) => `D${v}`} interval="preserveStartEnd" />
          <YAxis {...CHART.axis} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} width={40} />
          <Tooltip {...CHART.tooltip} formatter={(v) => formatPct(v)} labelFormatter={(l) => `Day ${l} since signup`} />
          <Legend wrapperStyle={{ fontSize: 11, color: 'var(--ink-2)' }} iconType="plainline" iconSize={14} />
          {shown.map((a) => (
            <Line key={a} type="monotone" dataKey={a} name={`arm ${a}`} stroke={colorFor[a]}
              strokeWidth={2} dot={{ r: 2 }} connectNulls {...CHART.noAnim} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <PanelNote>
        Pooled snapshot with the same observable-window clamp as the retention curve, split by assigned arm
        (only enrolled new users){hidden.length ? ` · arm ${hidden.join(' & ')} hidden until ≥${MIN_RATE_SHOW} users` : ''} · directional at low volume.
      </PanelNote>
    </Panel>
  );
}
