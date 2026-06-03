// SystemView — infrastructure (storage footprint) plus a data-quality panel
// that states, out loud, the honesty rules in force: whether internal traffic
// is excluded, the small-N thresholds, and why some trend lines are sparse.

import { MIN_RATE_FLAG, MIN_RATE_SHOW, MIN_POINTS, MIN_COHORT_SIZE } from '../../../../lib/adminFormat.js';
import { AdminStorageSection } from '../../AdminStorageSection.jsx';
import { useAnalyticsFilters, useRegisterViewRuntime } from '../AnalyticsFiltersContext.jsx';

function DataQualityPanel({ excludeInternal }) {
  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Data quality &amp; honesty</h3>
        <span className="admin-chart-sub t-meta">how to read the numbers on these tabs</span>
      </header>
      <div className="admin-chart-body">
        <ul className="admin-dq-list">
          <li>
            <span className={`admin-dq-pill ${excludeInternal ? 'is-on' : 'is-off'}`}>
              {excludeInternal ? 'Internal traffic excluded' : 'Internal traffic included'}
            </span>
            Founder / admin / test accounts are {excludeInternal ? 'removed from' : 'counted in'} every product
            metric. Toggle this in the toolbar to compare.
          </li>
          <li>
            <strong>Rates are sample-size gated.</strong> A rate shows solid only at n ≥ {MIN_RATE_FLAG};
            from {MIN_RATE_SHOW}–{MIN_RATE_FLAG - 1} it's flagged <em>directional</em> (amber); below {MIN_RATE_SHOW}
            it's hidden — so a "100%" off one signup never reads as a trend.
          </li>
          <li>
            <strong>Charts need real data.</strong> Trend lines need ≥ {MIN_POINTS} daily points and retention
            needs ≥ 2 weekly cohorts of ≥ {MIN_COHORT_SIZE} users; otherwise a "collecting…" placeholder shows
            instead of a misleading flat line or empty grid.
          </li>
          <li>
            <strong>Why some sparklines are absent.</strong> KPI sparklines and deltas read from daily snapshots
            (<code>metrics_daily</code>), which has no backfill and starts sparse — they fill in as days accrue.
          </li>
        </ul>
      </div>
    </section>
  );
}

export function SystemView() {
  const f = useAnalyticsFilters();
  // System has no view-level fetch (storage self-fetches); wire the toolbar
  // refresh to the shared shell fetch so the button still does something.
  useRegisterViewRuntime({ refresh: f.refreshShell, lastUpdated: null, refreshing: false });

  return (
    <div>
      <h2 className="admin-section-title">Data quality</h2>
      <div className="admin-section-sub">The honesty contract for this dashboard.</div>
      <DataQualityPanel excludeInternal={f.excludeInternal} />

      <h2 className="admin-section-title">Infrastructure</h2>
      <div className="admin-section-sub">Storage footprint by tier and heaviest accounts.</div>
      <AdminStorageSection />
    </div>
  );
}
