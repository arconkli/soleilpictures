// AdminTalkTab — the pricing page's "Talk to us" requests, newest first.
//
// One row per request: who, how to reach them, what they need and what they
// wrote. New is the default view; each request is marked handled, or spam, with
// one click and can be reopened. Anyone may send one, signed in or not.
//
// Data: admin_team_contacts (admin-only RPC, migration 0542) lists the rows;
// admin_set_team_contact flips a row's status. Requests come from
// request_team_contact on /pricing/talk-to-us, and each one also pages through
// ops_alerts, so this tab is the backlog, not the only signal.

import { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { CopyableText } from '../../components/CopyableText.jsx';
import { Icon } from '../../components/Icon.jsx';
import { Inbox, RotateCcw } from '../../lib/icons.js';
import { fmtDateTime, relativeTime, formatCount } from '../../lib/adminFormat.js';
import { TEAM_CONTACT_NEEDS } from '../../lib/teamContact.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { StatusPill } from './AdminPills.jsx';

const FILTERS = [
  { id: 'new', label: 'New' },
  { id: 'handled', label: 'Handled' },
  { id: 'spam', label: 'Spam' },
  { id: 'all', label: 'All' },
];
const NEED_LABEL = Object.fromEntries(TEAM_CONTACT_NEEDS.map((n) => [n.key, n.label]));
const COLS = 8;

export function AdminTalkTab() {
  const feedback = useFeedback();
  const [filter, setFilter] = useState('new');
  const [busyId, setBusyId] = useState(null);

  const { data, loading, error, refreshing, lastUpdated, hasData, refresh } = useAdminData(async () => {
    const { data: rows, error: err } = await supabase.rpc('admin_team_contacts', { p_limit: 200 });
    if (err) throw err;
    return rows || [];
  }, []);

  const all = data || [];
  const counts = useMemo(() => {
    const c = { new: 0, handled: 0, spam: 0, all: all.length };
    for (const r of all) if (c[r.status] != null) c[r.status] += 1;
    return c;
  }, [all]);
  const rows = filter === 'all' ? all : all.filter((r) => r.status === filter);

  const setStatus = async (id, status) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const { error: err } = await supabase.rpc('admin_set_team_contact', { p_id: id, p_status: status });
      if (err) throw err;
      await refresh();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Couldn’t update: ' + (e?.message || e) });
    } finally {
      setBusyId(null);
    }
  };

  const emptyBody = filter === 'new'
    ? { title: 'No new requests. Each one also emails you.' }
    : { title: 'Nothing here', body: 'No requests in this view.' };

  return (
    <div className="admin-section">
      <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`admin-action${filter === f.id ? ' admin-action-primary' : ''}`}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label} {formatCount(counts[f.id])}
          </button>
        ))}
      </AdminToolbar>

      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Talk to us</h3>
          <span className="admin-chart-sub t-meta">
            Requests from the pricing page, newest first
          </span>
        </header>

        <AdminAsync
          loading={loading}
          error={error}
          hasData={hasData}
          onRetry={refresh}
          skeleton={<AdminSkeleton variant="table" rows={5} cols={COLS} />}
          isEmpty={rows.length === 0}
          empty={{ icon: Inbox, ...emptyBody }}
        >
          <table className={`admin-table ${refreshing ? 'is-refreshing' : ''}`}>
            <thead>
              <tr>
                <th>When</th>
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                <th>Editors</th>
                <th>Needs</th>
                <th>Signed in</th>
                <th>Message</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const needs = (Array.isArray(r.needs) ? r.needs : []).map((k) => NEED_LABEL[k] || k);
                const busy = busyId === r.id;
                return (
                  <tr key={r.id}>
                    <td className="admin-muted" title={fmtDateTime(r.created_at)}>{relativeTime(r.created_at)}</td>
                    <td>
                      {r.name}
                      {filter === 'all' && <> <StatusPill kind={r.status} /></>}
                    </td>
                    <td className="admin-email">
                      <CopyableText value={r.email} className="admin-email" />
                      {' '}<a className="admin-link" href={`mailto:${r.email}`}>mail</a>
                    </td>
                    <td>{r.company || <span className="admin-muted">—</span>}</td>
                    <td>{r.editors == null ? <span className="admin-muted">—</span> : formatCount(r.editors)}</td>
                    <td>{needs.length ? needs.join(', ') : <span className="admin-muted">—</span>}</td>
                    <td>{r.signed_in ? 'Yes' : 'No'}</td>
                    <td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minWidth: 220 }}>
                      {r.message || <span className="admin-muted">—</span>}
                    </td>
                    <td className="admin-actions">
                      {r.status === 'new' ? (
                        <>
                          <button className="admin-action admin-action-primary" disabled={!!busyId} onClick={() => setStatus(r.id, 'handled')}>Mark handled</button>
                          <button className="admin-action admin-action-danger" disabled={!!busyId} onClick={() => setStatus(r.id, 'spam')}>Spam</button>
                        </>
                      ) : (
                        <button className="admin-action" disabled={!!busyId} onClick={() => setStatus(r.id, 'new')}>
                          <Icon as={RotateCcw} size={13} /> Reopen
                        </button>
                      )}
                      {busy ? <span className="admin-muted t-meta"> Saving…</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </AdminAsync>
      </section>
    </div>
  );
}
