// FeatureAdoption — which features do returning users use?
//
// The most directly decision-shaped chart in here, and therefore the easiest to
// misread. The caveat is rendered on the panel, not buried in a doc:
//
//   This is ASSOCIATION. People who were going to stick around anyway have more
//   opportunity to try everything, so a feature can show a large lift purely by
//   being used late in a long session. A high lift means INVESTIGATE — never
//   "ship more of this and they will stay".
//
// Small denominators are suppressed rather than rounded into a confident-looking
// percentage: with a handful of users, a lift of +50pp is two people.

import { formatCount, formatPct, MIN_RATE_SHOW, MIN_RATE_FLAG } from '../../../../lib/adminFormat.js';
import { PanelNote, NFlag } from '../../SmallN.jsx';

export function FeatureAdoption({ rows = [], days = 90 }) {
  const usable = rows.filter((r) => Number(r.users) > 0);

  return (
    <section className="admin-chart-panel">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Feature adoption &amp; return lift</h3>
        <span className="admin-chart-sub t-meta">
          last {days}d · return rate of a feature&rsquo;s users vs everyone who didn&rsquo;t use it
        </span>
      </header>

      <div className="admin-chart-body">
        {usable.length === 0 ? (
          <PanelNote>No feature usage recorded in this window.</PanelNote>
        ) : (
          <>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th style={{ textAlign: 'right' }}>Users</th>
                  <th style={{ textAlign: 'right' }}>Reach</th>
                  <th style={{ textAlign: 'right' }}>Returned</th>
                  <th style={{ textAlign: 'right' }}>Baseline</th>
                  <th style={{ textAlign: 'right' }}>Lift</th>
                </tr>
              </thead>
              <tbody>
                {usable.map((r) => {
                  const n = Number(r.users) || 0;
                  const show = n >= MIN_RATE_SHOW;
                  const lift = Number(r.lift_pct) || 0;
                  return (
                    <tr key={r.feature}>
                      <td>{r.feature.replace(/_/g, ' ')}</td>
                      <td style={{ textAlign: 'right' }}>
                        {formatCount(n)}
                        {show && n < MIN_RATE_FLAG ? <NFlag n={n} /> : null}
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatPct(Number(r.reach_pct) || 0)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {show ? formatPct(Number(r.returned_pct) || 0) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--ink-2)' }}>
                        {show ? formatPct(Number(r.baseline_pct) || 0) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {show ? `${lift >= 0 ? '+' : ''}${(lift * 100).toFixed(1)}pp` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <PanelNote>
              Association, not causation. Users who were going to stay have more chances to try
              everything, so a lift can be an effect of engagement rather than a cause of it.
              Treat a high number as something to investigate — ideally against a matched cohort —
              not as evidence that shipping more of it will retain anyone. Rows under{' '}
              {MIN_RATE_SHOW} users show no rate at all.
            </PanelNote>
          </>
        )}
      </div>
    </section>
  );
}
