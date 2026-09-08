// AdminAuditTab — who did what to whom, in the admin surface.
//
// Until 0312 the privileged admin RPCs left no trail: admin_export_user_data
// (a user's entire record) recorded nothing, and tier changes only trailed
// into analytics_events. This is a read over public.admin_audit_log via
// admin_audit_recent() — the six most sensitive functions write a row after
// their admin guard: export_user_data, set_tier, grant_paid_access,
// revoke_paid_access, set_account_quota_bytes, review_public_board.
// Retention 400 days (purge_old_admin_audit, daily).

import { useCallback, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { fmtDateTime, relativeTime } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar } from './AdminStates.jsx';

const LIMIT = 300;

export function AdminAuditTab() {
  const fetchAudit = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_audit_recent', { p_limit: LIMIT });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }, []);
  const { data, loading, error, refreshing, lastUpdated, refresh } =
    useAdminData(fetchAudit, [], { refetchOnFocus: true });
  const rows = data || [];
  const [open, setOpen] = useState(null);

  return (
    <div className="admin-section">
      <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated}>
        <span className="admin-filter-meta t-meta">
          Last {LIMIT} privileged actions · exports, tier changes, grants, quotas, approvals
        </span>
      </AdminToolbar>

      {error && <div className="admin-empty">Could not load the audit log: {String(error.message || error)}</div>}
      {loading && !rows.length && <div className="admin-empty">Loading…</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="admin-empty">No privileged actions recorded yet.</div>
      )}

      {rows.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Admin</th>
              <th>Action</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const hasPayload = r.payload && Object.keys(r.payload).length > 0;
              const isOpen = open === r.id;
              return (
                <tr key={r.id} className={hasPayload ? 'admin-row-clickable' : undefined}
                    onClick={hasPayload ? () => setOpen(isOpen ? null : r.id) : undefined}>
                  <td title={fmtDateTime(r.at)}>{relativeTime(r.at)}</td>
                  <td>{r.actor_email || r.actor || '—'}</td>
                  <td><code>{r.action}</code></td>
                  <td className="t-mono">{r.target || '—'}</td>
                  <td>
                    {hasPayload
                      ? (isOpen
                          ? <pre className="admin-pre">{JSON.stringify(r.payload, null, 2)}</pre>
                          : <span className="t-meta">{Object.keys(r.payload).join(', ')}</span>)
                      : <span className="t-meta">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
