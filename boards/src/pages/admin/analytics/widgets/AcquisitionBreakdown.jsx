// AcquisitionBreakdown — first-touch source → signups → paid conversion table.
// Extracted from the old AdminAnalyticsTab. Small-N: the per-source conversion
// rate is suppressed/flagged via RateCell so a "100%" off one signup can't
// masquerade as a great channel.

import { formatCount } from '../../../../lib/adminFormat.js';
import { RateCell } from './SmallN.jsx';

export function AcquisitionBreakdown({ rows = [], days = 30 }) {
  if (!rows || rows.length === 0) {
    return (
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Acquisition source</h3>
        </header>
        <div className="admin-empty">No attributed signups in this window yet.</div>
      </section>
    );
  }
  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Acquisition source</h3>
        <span className="admin-chart-sub t-meta">first-touch · conversion = signups → paid · last {days}d</span>
      </header>
      <div className="admin-chart-body">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Source</th>
              <th className="num">Signups</th>
              <th className="num">Paid</th>
              <th className="num">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source}>
                <td className="admin-email">{r.source}</td>
                <td className="admin-muted num">{formatCount(r.signups)}</td>
                <td className="admin-muted num">{formatCount(r.converted)}</td>
                <td className="num"><RateCell numer={r.converted} denom={r.signups} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
