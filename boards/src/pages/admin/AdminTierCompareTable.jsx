// AdminTierCompareTable — per-tier averages + totals for cards/boards.
// Read from admin_tier_usage_compare().

import { formatCount } from '../../lib/adminFormat.js';
import { TierPill } from './AdminPills.jsx';

export function AdminTierCompareTable({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <section className="admin-chart-panel">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Demo vs Paid usage</h3>
        </header>
        <div className="admin-empty">No data yet.</div>
      </section>
    );
  }

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Usage by tier</h3>
        <span className="admin-chart-sub t-meta">averages + totals across all time</span>
      </header>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Tier</th>
            <th className="num">Users</th>
            <th className="num">Avg cards / user</th>
            <th className="num">Avg boards / user</th>
            <th className="num">Total cards</th>
            <th className="num">Total boards</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tier}>
              <td><TierPill tier={r.tier} /></td>
              <td className="num">{formatCount(r.users)}</td>
              <td className="num">{formatCount(r.avg_cards)}</td>
              <td className="num">{formatCount(r.avg_boards)}</td>
              <td className="num admin-muted">{formatCount(r.total_cards)}</td>
              <td className="num admin-muted">{formatCount(r.total_boards)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
