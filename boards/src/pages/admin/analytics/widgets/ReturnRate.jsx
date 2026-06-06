// ReturnRate — explicit D1/D7/D30 return rate, surfaced as three tiles so the
// number you actually want isn't buried in the retention curve's day bins.
// Reads admin_return_rate rows { day_offset, eligible, returned_on, on_pct, ... }.
//
// Honesty: a tile only shows a % when its "eligible" denominator clears the
// suppression floor — so D7/D30 stay blank ("—") until the cohort is old enough,
// rather than printing a fake 0% off the one user old enough to qualify.

import { formatCount, formatPct, MIN_RATE_SHOW } from '../../../../lib/adminFormat.js';
import { PanelNote } from '../../SmallN.jsx';

const LABELS = { 1: 'D1', 7: 'D7', 30: 'D30' };
const OFFSETS = [1, 7, 30];

export function ReturnRate({ rows = [] }) {
  const byOff = new Map(rows.map((r) => [Number(r.day_offset), r]));
  return (
    <section className="admin-chart-panel">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Return rate (D1 / D7 / D30)</h3>
        <span className="admin-chart-sub t-meta">% of signed-up users active on that day after signup · observable-window clamped</span>
      </header>
      <div className="admin-chart-body">
        <div style={{ display: 'flex', gap: 12 }}>
          {OFFSETS.map((d) => {
            const r = byOff.get(d);
            const elig = Number(r?.eligible) || 0;
            const ret = Number(r?.returned_on) || 0;
            const trustworthy = elig >= MIN_RATE_SHOW;
            return (
              <div key={d} style={{ flex: 1, border: '1px solid var(--line-2)', borderRadius: 8, padding: '12px 14px' }}>
                <div className="t-meta" style={{ color: 'var(--ink-2)' }}>{LABELS[d]} return</div>
                <div style={{ fontSize: 26, fontWeight: 600, color: trustworthy ? 'var(--ink-1)' : 'var(--ink-3)' }}>
                  {trustworthy ? formatPct(elig ? ret / elig : 0) : '—'}
                </div>
                <div className="t-meta" style={{ color: 'var(--ink-2)' }}>
                  {trustworthy
                    ? `${formatCount(ret)} of ${formatCount(elig)} eligible`
                    : `too few old enough (n=${formatCount(elig)})`}
                </div>
              </div>
            );
          })}
        </div>
        <PanelNote>
          Only users who signed up ≥N days ago (and within the tracked activity window) count toward Dn, so
          D7/D30 stay blank until the cohort matures. “Active” = opened the app that day.
        </PanelNote>
      </div>
    </section>
  );
}
