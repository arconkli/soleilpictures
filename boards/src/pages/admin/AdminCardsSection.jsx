// AdminCardsSection — what is being made:
//   1. Cards per day
//   2. Most-used card kinds
//
// The third panel, a kind × tier stacked bar, is gone. It stacked four tier
// series when the platform has demo, admin and a single paid account — so two
// of the four bands were always zero-width and the third was a rounding error.
// AdminTierCompareTable was cut for the same reason; keeping its chart twin
// would have been inconsistent.
//
// Neither remaining panel is coloured. Cards per day is one series and kind
// usage is a ranked magnitude — colour would be decoration in both.

import { shortDate, formatCount, formatPct } from '../../lib/adminFormat.js';
import { TrendLine } from './viz/TrendLine.jsx';
import { BarRows } from './viz/BarRows.jsx';
import { VAR } from './viz/palette.js';

export function AdminCardsSection({ perDay, cardStats, days = 30 }) {
  const byKind = cardStats?.by_kind || {};
  const total = cardStats?.total || 0;

  const topKinds = Object.entries(byKind)
    .map(([kind, n]) => ({ key: kind, label: kind, value: Number(n) || 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const rows = perDay || [];
  const created = rows.reduce((a, b) => a + (Number(b.cards) || 0), 0);

  return (
    <>
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Cards created · last {days} days</h3>
          <span className="admin-chart-sub t-meta">{formatCount(created)} cards added</span>
        </header>
        <div className="admin-chart-body">
          <TrendLine
            points={rows.map((r) => ({ v: Number(r.cards) || 0, label: shortDate(r.day) }))}
            height={180}
            color={VAR.cat[0]}
            area
            formatValue={(v) => `${formatCount(v)} card${v === 1 ? '' : 's'}`}
          />
        </div>
      </section>

      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Most-used card kinds</h3>
          <span className="admin-chart-sub t-meta">{formatCount(total)} cards total</span>
        </header>
        <div className="admin-chart-body">
          <BarRows
            ramp
            rows={topKinds}
            formatValue={(v) => formatCount(v)}
            secondary={(r) => (total ? formatPct(r.value / total) : '—')}
            emptyLabel="No cards created in this window."
          />
        </div>
      </section>
    </>
  );
}
