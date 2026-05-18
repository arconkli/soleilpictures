// AdminTopUsersList — two side-by-side ranked lists, Top 20 by card count
// for demo and for paid. Demo column hints "Upgrade-prone"; paid hints
// "Most engaged". Reads admin_top_users for each tier.

export function AdminTopUsersList({ topDemo, topPaid }) {
  return (
    <div className="admin-charts-row">
      <TopColumn
        title="Top 20 Demo by cards"
        sub="Upgrade-prone — your highest-activity demo users."
        rows={topDemo}
      />
      <TopColumn
        title="Top 20 Paid by cards"
        sub="Most engaged — your highest-activity paying customers."
        rows={topPaid}
      />
    </div>
  );
}

function TopColumn({ title, sub, rows }) {
  return (
    <section className="admin-chart-panel">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">{title}</h3>
        <span className="admin-chart-sub t-meta">{sub}</span>
      </header>
      {!rows || rows.length === 0 ? (
        <div className="admin-empty">No users yet.</div>
      ) : (
        <ol className="admin-top-list">
          {rows.map((r, i) => (
            <li key={r.user_id} className="admin-top-row">
              <span className="admin-top-rank">{i + 1}</span>
              <span className="admin-top-email">{r.email}</span>
              <span className={`admin-status admin-status-${r.tier}`}>{r.tier}</span>
              <span className="admin-top-count">{Number(r.card_count || 0).toLocaleString()}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
