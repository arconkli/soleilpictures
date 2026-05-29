// AdminStatCard — small presentational card for an Overview/Storage KPI.
// label (uppercase) + value (big number) + sub-text. Falls back to an
// em-dash for null/undefined/NaN so a missing field never leaks "NaN" or
// an empty box to the operator.

export function AdminStatCard({ label, value, sub, accent = false, title }) {
  const display =
    value == null || (typeof value === 'number' && Number.isNaN(value)) ? '—' : value;
  return (
    <div className={`admin-stat-card ${accent ? 'is-accent' : ''}`} title={title}>
      <div className="admin-stat-label">{label}</div>
      <div className="admin-stat-value">{display}</div>
      {sub && <div className="admin-stat-sub">{sub}</div>}
    </div>
  );
}
