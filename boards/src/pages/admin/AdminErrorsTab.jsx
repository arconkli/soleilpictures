// AdminErrorsTab — first-party client-side error logs (public.client_errors,
// written by lib/errorReporting.js). Two views over a 7/30/90d window:
//   • Top errors  — grouped by message (occurrences / users / sessions / last seen)
//   • Recent      — raw stream, each row expands to its stack + component stack
// Backed by admin_error_summary() + admin_recent_errors() (migration 0108).

import { useCallback, useState, Fragment } from 'react';
import { supabase } from '../../lib/supabase.js';
import { CopyableText } from '../../components/CopyableText.jsx';
import { relativeTime, fmtDateTime, formatCount } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminTimeRange } from './AdminTimeRange.jsx';
import { Warning } from '../../lib/icons.js';

const RECENT_LIMIT = 200;

export function AdminErrorsTab() {
  const [days, setDays] = useState(7);
  const [openGroup, setOpenGroup] = useState(new Set());
  const [openRow, setOpenRow] = useState(new Set());

  const fetchErrors = useCallback(async () => {
    const results = await Promise.allSettled([
      supabase.rpc('admin_error_summary',  { p_days: days }),
      supabase.rpc('admin_recent_errors',  { p_days: days, p_limit: RECENT_LIMIT }),
    ]);
    const [sum, rec] = results;
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;
    // Fail the tab only if BOTH queries failed; otherwise render what we have.
    if (!val(sum) && !val(rec)) throw errOf(sum) || errOf(rec) || new Error('Failed to load errors');
    return { summary: val(sum) || [], recent: val(rec) || [] };
  }, [days]);

  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(fetchErrors, [days]);
  const summary = data?.summary || [];
  const recent = data?.recent || [];

  const toggle = (set, setter, key) => {
    setter((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };

  return (
    <div className="admin-section">
      <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated}>
        <AdminTimeRange value={days} onChange={setDays} />
        <span className="admin-filter-meta t-meta">
          {loading ? 'Loading…' : `${formatCount(summary.length)} distinct · ${formatCount(recent.length)}${recent.length >= RECENT_LIMIT ? '+' : ''} recent`}
        </span>
      </AdminToolbar>

      <AdminAsync
        loading={loading}
        error={error}
        onRetry={refresh}
        skeleton={<AdminSkeleton variant="list" rows={6} />}
        isEmpty={summary.length === 0 && recent.length === 0}
        empty={{
          icon: Warning,
          title: 'No errors logged',
          body: `No client-side errors in the last ${days} days. New crashes from the app appear here.`,
        }}
      >
        <div className={refreshing ? 'is-refreshing' : ''}>
          {/* ── Grouped: top errors by message ───────────────────────────── */}
          {summary.length > 0 && (
            <section className="admin-chart-panel admin-chart-panel-wide">
              <header className="admin-chart-head">
                <h3 className="admin-chart-title">Top errors · last {days} days</h3>
                <span className="admin-chart-sub t-meta">grouped by message — click a row for the stack</span>
              </header>
              <div className="admin-chart-body">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Error</th>
                      <th className="num">Count</th>
                      <th className="num">Users</th>
                      <th className="num">Sessions</th>
                      <th className="num">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((g, i) => {
                      const key = `${g.message}-${i}`;
                      const isOpen = openGroup.has(key);
                      return (
                        <Fragment key={key}>
                          <tr
                            role="button"
                            tabIndex={0}
                            aria-expanded={isOpen}
                            className="admin-error-grouprow"
                            onClick={() => toggle(openGroup, setOpenGroup, key)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(openGroup, setOpenGroup, key); } }}
                          >
                            <td>
                              <span className="admin-error-kind t-meta">{g.kind || 'error'}</span>{' '}
                              {g.message || '(no message)'}
                            </td>
                            <td className="num">{formatCount(g.occurrences)}</td>
                            <td className="num">{formatCount(g.users)}</td>
                            <td className="num">{formatCount(g.sessions)}</td>
                            <td className="num" title={fmtDateTime(g.last_seen)}>{relativeTime(g.last_seen)}</td>
                          </tr>
                          {isOpen && g.sample_stack && (
                            <tr>
                              <td colSpan={5}><pre className="admin-error-stack">{g.sample_stack}</pre></td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── Recent stream ────────────────────────────────────────────── */}
          {recent.length > 0 && (
            <section className="admin-chart-panel admin-chart-panel-wide">
              <header className="admin-chart-head">
                <h3 className="admin-chart-title">Recent · last {days} days</h3>
                <span className="admin-chart-sub t-meta">click a row for the full stack</span>
              </header>
              <div className="admin-feedback-list">
                {recent.map((r) => {
                  const isOpen = openRow.has(r.id);
                  return (
                    <div
                      key={r.id}
                      className="admin-feedback-row"
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => toggle(openRow, setOpenRow, r.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(openRow, setOpenRow, r.id); } }}
                    >
                      <div className="admin-feedback-meta">
                        <span className="admin-error-kind t-meta">{r.kind || 'error'}</span>
                        <span className="admin-muted" title={fmtDateTime(r.occurred_at)}>{relativeTime(r.occurred_at)}</span>
                        {r.path && <span className="admin-muted">{r.path}</span>}
                        {r.user_id
                          ? <CopyableText value={r.user_id} className="admin-email" />
                          : <span className="admin-email admin-muted">anonymous</span>}
                        {r.release && <span className="admin-muted">{r.release}</span>}
                      </div>
                      <div className="admin-feedback-message">
                        {r.name ? `${r.name}: ` : ''}{r.message || '(no message)'}
                      </div>
                      {isOpen && (r.stack || r.component_stack) && (
                        <pre className="admin-error-stack">
                          {r.stack || ''}
                          {r.component_stack ? `\n\nComponent stack:\n${r.component_stack}` : ''}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </AdminAsync>
    </div>
  );
}
