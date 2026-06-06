// UserDormancy — per-user last-seen / days-dormant / resurrection roster, sorted
// most-dormant-first. The win-back candidate list the dashboard was missing:
// reads admin_user_dormancy { email, tier, signup, last_active_day, days_dormant,
// active_day_count, did_card, did_populated_board, resurrected }.

import { formatCount } from '../../../../lib/adminFormat.js';
import { TierPill } from '../../AdminPills.jsx';

const fmtDate = (d) => (d ? String(d).slice(0, 10) : '—');
const yn = (b) => (b ? '✓' : '—');

export function UserDormancy({ rows = [], limit = 50 }) {
  if (!rows.length) {
    return (
      <section className="admin-chart-panel">
        <header className="admin-chart-head"><h3 className="admin-chart-title">User dormancy</h3></header>
        <div className="admin-empty">No users yet.</div>
      </section>
    );
  }
  const shown = rows.slice(0, limit);
  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">User dormancy &amp; resurrection</h3>
        <span className="admin-chart-sub t-meta">per-user last-seen, most dormant first · the win-back candidate list</span>
      </header>
      <table className="admin-table">
        <thead>
          <tr>
            <th>User</th><th>Tier</th>
            <th className="num">Signed up</th><th className="num">Last active</th>
            <th className="num">Dormant</th><th className="num">Active days</th>
            <th className="num">Card</th><th className="num">Populated</th><th className="num">Back</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.user_id}>
              <td title={r.email}>{r.email}</td>
              <td><TierPill tier={r.tier} /></td>
              <td className="num admin-muted">{fmtDate(r.signup)}</td>
              <td className="num">{fmtDate(r.last_active_day)}</td>
              <td className="num">{r.days_dormant == null ? '—' : `${formatCount(r.days_dormant)}d`}</td>
              <td className="num">{formatCount(r.active_day_count)}</td>
              <td className="num">{yn(r.did_card)}</td>
              <td className="num">{yn(r.did_populated_board)}</td>
              <td className="num" title={r.resurrected ? 'Returned after a 7+ day gap' : ''}>{r.resurrected ? '↩' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && (
        <div className="admin-panel-note">Showing {limit} of {formatCount(rows.length)} — most dormant first.</div>
      )}
    </section>
  );
}
