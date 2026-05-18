// AdminTierCompareTable — per-tier averages + totals for cards/boards.
// Read from admin_tier_usage_compare().

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
            <th style={{ textAlign: 'right' }}>Users</th>
            <th style={{ textAlign: 'right' }}>Avg cards / user</th>
            <th style={{ textAlign: 'right' }}>Avg boards / user</th>
            <th style={{ textAlign: 'right' }}>Total cards</th>
            <th style={{ textAlign: 'right' }}>Total boards</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tier}>
              <td>
                <span className={`admin-status admin-status-${r.tier}`}>{r.tier}</span>
              </td>
              <td style={{ textAlign: 'right' }}>{Number(r.users || 0).toLocaleString()}</td>
              <td style={{ textAlign: 'right' }}>{Number(r.avg_cards || 0).toLocaleString()}</td>
              <td style={{ textAlign: 'right' }}>{Number(r.avg_boards || 0).toLocaleString()}</td>
              <td style={{ textAlign: 'right' }} className="admin-muted">{Number(r.total_cards || 0).toLocaleString()}</td>
              <td style={{ textAlign: 'right' }} className="admin-muted">{Number(r.total_boards || 0).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
