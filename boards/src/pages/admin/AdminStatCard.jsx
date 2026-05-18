// AdminStatCard — small presentational card for an Overview KPI.
// label (uppercase) + value (big number, optionally formatted) + sub-text.

export function AdminStatCard({ label, value, sub, accent = false }) {
  return (
    <div className={`admin-stat-card ${accent ? 'is-accent' : ''}`}>
      <div className="admin-stat-label">{label}</div>
      <div className="admin-stat-value">{value}</div>
      {sub && <div className="admin-stat-sub">{sub}</div>}
    </div>
  );
}
