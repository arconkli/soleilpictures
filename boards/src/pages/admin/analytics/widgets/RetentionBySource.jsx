// RetentionBySource — the pooled retention curve, split by acquisition bucket
// (ad / referral / organic) derived from profiles.first_source. Tells us whether
// paid (ad) traffic retains worse than organic as Meta volume grows. Reads
// admin_retention_by_source { source, day_offset, eligible, active, active_pct }.
//
// Same observable-window honesty as RetentionCurve: clip to the contiguous prefix
// where some source clears the floor, only draw a source line once it itself
// clears MIN_RATE_SHOW, and gate to a placeholder below MIN_POINTS days.

import { formatPct, MIN_RATE_SHOW, MIN_POINTS } from '../../../../lib/adminFormat.js';
import { MultiTrend } from '../../viz/TrendLine.jsx';
import { VAR } from '../../viz/palette.js';
import { PanelNote, ChartPlaceholder } from '../../SmallN.jsx';

// Colour follows the SOURCE, not its position in the filtered list — a bucket
// dropping below the sample floor must not repaint the two that remain. `ad`
// was gold, which is the reserved accent.
const COLORS = { ad: VAR.cat[2], referral: VAR.cat[0], organic: VAR.cat[1] };

function Panel({ children }) {
  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Retention by acquisition source</h3>
        <span className="admin-chart-sub t-meta">% active N days after signup · ad vs referral vs organic</span>
      </header>
      <div className="admin-chart-body">{children}</div>
    </section>
  );
}

export function RetentionBySource({ rows = [] }) {
  const byOffset = new Map();
  const maxElig = {};
  const sources = [...new Set(rows.map((r) => r.source))];
  for (const r of rows) {
    const d = Number(r.day_offset);
    if (!byOffset.has(d)) byOffset.set(d, { d });
    const o = byOffset.get(d);
    o[r.source] = r.active_pct == null ? null : Number(r.active_pct);
    o[`n_${r.source}`] = Number(r.eligible) || 0;
    maxElig[r.source] = Math.max(maxElig[r.source] || 0, Number(r.eligible) || 0);
  }

  const ordered = [...byOffset.values()].sort((a, b) => a.d - b.d);
  const data = [];
  for (const o of ordered) {
    if (sources.some((s) => (o[`n_${s}`] || 0) >= MIN_RATE_SHOW)) data.push(o); else break;
  }

  if (data.length < MIN_POINTS) {
    return (
      <Panel>
        <ChartPlaceholder
          title="Retention-by-source is still collecting"
          sub={`Needs ≥${MIN_POINTS} days each reached by ≥${MIN_RATE_SHOW} users within a single source.`}
        />
      </Panel>
    );
  }

  const shown = sources.filter((s) => (maxElig[s] || 0) >= MIN_RATE_SHOW);
  const hidden = sources.filter((s) => (maxElig[s] || 0) < MIN_RATE_SHOW);

  return (
    <Panel>
      <MultiTrend
        labels={data.map((o) => `Day ${o.d}`)}
        domain={[0, 1]}
        height={220}
        formatValue={(v) => formatPct(v)}
        series={shown.map((s) => ({
          key: s,
          label: s,
          color: COLORS[s] || VAR.other,
          values: data.map((o) => (o[s] == null ? null : Number(o[s]))),
        }))}
      />
      <PanelNote>
        Pooled snapshot with the same observable-window clamp as the retention curve. Source bucket comes from
        first-touch (fbclid / utm / referrer){hidden.length ? ` · ${hidden.join(' & ')} hidden until ≥${MIN_RATE_SHOW} users` : ''} · directional at low volume.
      </PanelNote>
    </Panel>
  );
}
