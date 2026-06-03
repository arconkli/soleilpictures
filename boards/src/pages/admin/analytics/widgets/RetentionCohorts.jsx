// RetentionCohorts — weekly-cohort retention heatmap (hand-rolled table; no
// Recharts heatmap exists and the table is the right primitive). Extracted from
// the old AdminAnalyticsTab, with small-N gating: this is the worst offender at
// low volume, so we require ≥2 cohort weeks with at least one cohort of
// MIN_COHORT_SIZE before drawing it, clamp the day columns to the actual data
// span (no empty D0..D60 wall), and grey out cells from sub-floor cohorts.

import { MIN_COHORT_SIZE } from '../../../../lib/adminFormat.js';
import { ChartPlaceholder } from './SmallN.jsx';

export function RetentionCohorts({ rows = [] }) {
  const byWeek = new Map();
  let maxOffset = 0;
  for (const r of rows) {
    if (!byWeek.has(r.cohort_week)) byWeek.set(r.cohort_week, { size: Number(r.cohort_size) || 0, cells: {} });
    byWeek.get(r.cohort_week).cells[r.day_offset] = Number(r.active_pct) || 0;
    if (r.day_offset > maxOffset) maxOffset = r.day_offset;
  }
  const weeks = [...byWeek.keys()].sort().reverse();
  const bigEnough = weeks.filter((w) => byWeek.get(w).size >= MIN_COHORT_SIZE);

  const Panel = ({ children }) => (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Retention cohorts</h3>
        <span className="admin-chart-sub t-meta">% of each weekly cohort active by day-since-signup</span>
      </header>
      <div className="admin-chart-body" style={{ overflowX: 'auto' }}>{children}</div>
    </section>
  );

  // Gate: need ≥2 weekly cohorts AND at least one cohort of a trustworthy size.
  if (weeks.length < 2 || bigEnough.length === 0) {
    return (
      <Panel>
        <ChartPlaceholder
          title="Retention is still collecting"
          sub={`Needs ≥2 weekly cohorts of ≥${MIN_COHORT_SIZE} users. So far: ${weeks.length} cohort${weeks.length === 1 ? '' : 's'}, largest ${Math.max(0, ...weeks.map((w) => byWeek.get(w).size))} users.`}
        />
      </Panel>
    );
  }

  const cap = Math.min(60, maxOffset);                       // clamp to real span
  const offsets = Array.from({ length: cap + 1 }, (_, i) => i);

  return (
    <Panel>
      <table className="admin-cohort-table">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Cohort week</th>
            <th>N</th>
            {offsets.map((o) => <th key={o}>D{o}</th>)}
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => {
            const r = byWeek.get(w);
            const dim = r.size < MIN_COHORT_SIZE;               // grey out tiny cohorts
            return (
              <tr key={w} style={dim ? { opacity: 0.4 } : undefined} title={dim ? `Cohort of ${r.size} — too small to read into` : undefined}>
                <td className="admin-muted" style={{ whiteSpace: 'nowrap' }}>{w}</td>
                <td className="admin-muted">{r.size}</td>
                {offsets.map((o) => {
                  const pct = Math.max(0, Math.min(1, r.cells[o] || 0));
                  const bg = dim ? 'transparent' : `rgba(255,165,0,${pct})`;
                  const ink = !dim && pct > 0.5 ? '#0a0908' : 'var(--ink-1)';
                  return (
                    <td key={o} style={{ background: bg, color: ink, textAlign: 'center', minWidth: 32, fontVariantNumeric: 'tabular-nums' }}>
                      {pct > 0 ? `${Math.round(pct * 100)}` : ''}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
