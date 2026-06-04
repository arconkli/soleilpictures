// RetentionCurve — the pooled retention curve: % of signed-up users still active
// N days after signup, as three lines (overall / demo / paid). Reads
// admin_retention_curve rows { segment, day_offset, eligible, active, active_pct }.
//
// Honesty: denominators are "eligible" users (signed up ≥ that many days ago,
// within the tracked activity window — see the RPC's observable-window note). We
// clip the x-axis to the contiguous span where the overall denominator clears
// MIN_RATE_SHOW, only draw a tier line once that tier itself clears the floor,
// and gate to a placeholder below a drawable number of points — same discipline
// as RetentionCohorts.

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { formatPct, formatCount, TIER_COLORS, MIN_RATE_SHOW, MIN_POINTS } from '../../../../lib/adminFormat.js';
import { CHART } from '../../chartTheme.js';
import { PanelNote, ChartPlaceholder } from '../../SmallN.jsx';

const SOLEIL = '#ffa500';
const SEGMENTS = [
  { key: 'all',  label: 'All users', color: SOLEIL,           width: 2.5  },
  { key: 'demo', label: 'Demo',      color: TIER_COLORS.demo, width: 1.75 },
  { key: 'paid', label: 'Paid',      color: TIER_COLORS.paid, width: 1.75 },
];

function Panel({ children }) {
  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Retention curve</h3>
        <span className="admin-chart-sub t-meta">% of signed-up users still active N days after signup · by current tier</span>
      </header>
      <div className="admin-chart-body">{children}</div>
    </section>
  );
}

function CurveTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 12, padding: '8px 10px', color: 'var(--ink-1)' }}>
      <div style={{ marginBottom: 4, color: 'var(--ink-2)' }}>Day {label} since signup</div>
      {SEGMENTS.map((s) => {
        const pct = row[s.key];
        if (pct == null) return null;
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flex: '0 0 auto' }} />
            <span style={{ minWidth: 56 }}>{s.label}</span>
            <b>{formatPct(pct)}</b>
            <span className="admin-muted">n={formatCount(row[`n_${s.key}`] || 0)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function RetentionCurve({ rows = [] }) {
  // Pivot (segment, day_offset, …) → one row per day_offset with all/demo/paid.
  const byOffset = new Map();
  const maxElig = { all: 0, demo: 0, paid: 0 };
  for (const r of rows) {
    const d = Number(r.day_offset);
    if (!byOffset.has(d)) byOffset.set(d, { d });
    const o = byOffset.get(d);
    o[r.segment] = r.active_pct == null ? null : Number(r.active_pct);
    o[`n_${r.segment}`] = Number(r.eligible) || 0;
    if (r.segment in maxElig) maxElig[r.segment] = Math.max(maxElig[r.segment], Number(r.eligible) || 0);
  }

  // Clip to the contiguous span from D0 where the overall denominator is trustworthy.
  // Observable-window eligibility is ~monotonic in tenure (older offsets are reached
  // by fewer users), so breaking at the first sub-floor offset keeps a clean prefix.
  const ordered = [...byOffset.values()].sort((a, b) => a.d - b.d);
  const data = [];
  for (const o of ordered) {
    if ((o.n_all || 0) >= MIN_RATE_SHOW) data.push(o); else break;
  }

  // Honesty floor: don't draw a "curve" through fewer than MIN_POINTS trustworthy days.
  if (data.length < MIN_POINTS) {
    return (
      <Panel>
        <ChartPlaceholder
          title="Retention curve is still collecting"
          sub={`Needs ≥${MIN_POINTS} days each reached by ≥${MIN_RATE_SHOW} users. So far: ${data.length} (largest cohort ${maxElig.all} user${maxElig.all === 1 ? '' : 's'}).`}
        />
      </Panel>
    );
  }

  // Only draw a tier line once that tier itself clears the suppression floor.
  const shown = SEGMENTS.filter((s) => s.key === 'all' || maxElig[s.key] >= MIN_RATE_SHOW);
  const hidden = SEGMENTS.filter((s) => s.key !== 'all' && maxElig[s.key] < MIN_RATE_SHOW).map((s) => s.label);

  return (
    <Panel>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
          <CartesianGrid {...CHART.grid} />
          <XAxis dataKey="d" {...CHART.axis} tickFormatter={(v) => `D${v}`} interval="preserveStartEnd" />
          <YAxis {...CHART.axis} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} width={40} />
          <Tooltip content={<CurveTooltip />} cursor={{ stroke: 'var(--line-2)' }} />
          <Legend wrapperStyle={{ fontSize: 11, color: 'var(--ink-2)' }} iconType="plainline" iconSize={14} />
          {shown.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
              stroke={s.color} strokeWidth={s.width} dot={{ r: 2 }} connectNulls {...CHART.noAnim} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <PanelNote>
        Active = opened the app that day. A pooled snapshot, not a fixed-cohort survival curve: each
        day pools every user old enough to have reached it within the tracked window. Split by current
        tier — users who upgraded count as paid throughout{hidden.length ? ` · ${hidden.join(' & ')} hidden until ≥${MIN_RATE_SHOW} users` : ''} · directional at low volume.
      </PanelNote>
    </Panel>
  );
}
