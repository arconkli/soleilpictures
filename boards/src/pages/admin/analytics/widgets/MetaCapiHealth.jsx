// MetaCapiHealth — Meta Conversions API (CAPI) delivery health, read from our
// first-party meta_capi_log via admin_meta_capi_health. Self-fetching (like
// AdminStorageSection) so SystemView stays declarative. Lets us confirm server
// -side conversions (CompleteRegistration, Lead, Purchase, InitiateCheckout)
// actually reached Meta from our own DB, not only Meta Events Manager.

import { supabase } from '../../../../lib/supabase.js';
import { useAdminData } from '../../useAdminData.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { formatCount, formatPct, relativeTime, fmtDateTime } from '../../../../lib/adminFormat.js';

export function MetaCapiHealth() {
  const q = useAdminData(async () => {
    const { data, error } = await supabase.rpc('admin_meta_capi_health', { p_days: 7 });
    if (error) throw error;
    return data || [];
  }, []);

  const rows = q.data || [];

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Meta CAPI delivery</h3>
        <span className="admin-chart-sub t-meta">server-side conversion sends · success/failure · last 7d</span>
      </header>
      <div className="admin-chart-body">
        <AdminAsync loading={q.loading} error={q.error} onRetry={q.refresh}
          skeleton={<AdminSkeleton variant="table" rows={4} />}>
          {rows.length === 0 ? (
            <div className="admin-empty">No CAPI sends logged in this window yet.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th className="num">Sends</th>
                  <th className="num">Success</th>
                  <th className="num">Failed</th>
                  <th>Last sent</th>
                  <th>Last error</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const failed = Number(r.failed) || 0;
                  return (
                    <tr key={r.event_name}>
                      <td>{r.event_name}</td>
                      <td className="admin-muted num">{formatCount(r.sends)}</td>
                      <td className="num">{formatPct(Number(r.success_pct) || 0)}</td>
                      <td className={`num ${failed > 0 ? 'is-loss' : 'admin-muted'}`}>{formatCount(failed)}</td>
                      <td className="admin-muted" title={r.last_sent ? fmtDateTime(r.last_sent) : ''}>
                        {r.last_sent ? relativeTime(r.last_sent) : '—'}
                      </td>
                      <td className="admin-muted" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={r.last_error || ''}>
                        {r.last_error || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </AdminAsync>
      </div>
    </section>
  );
}
