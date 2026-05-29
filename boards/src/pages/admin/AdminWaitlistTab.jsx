// AdminWaitlistTab — review waitlist entries.
// Per pending row: Accept now, custom date/time reschedule, quick +7d,
// Reject (confirmed). Every action confirms-if-destructive, toasts its
// outcome, and refetches — so a failed action can't read as success.

import { useCallback, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { CopyableText } from '../../components/CopyableText.jsx';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { StatusPill } from './AdminPills.jsx';
import { fmtDate, fmtDateTime } from '../../lib/adminFormat.js';
import { Inbox } from '../../lib/icons.js';

const ACTION_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/admin-waitlist-action';
const PAGE_LIMIT = 200;
const STATUS_OPTIONS = ['', 'pending', 'accepted', 'rejected', 'canceled'];

// <input type="datetime-local"> expects "YYYY-MM-DDTHH:MM" in *local*
// time. These helpers convert between that and ISO UTC.
function localInputString(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function isoToLocalInput(iso) {
  if (!iso) {
    const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    return localInputString(d);
  }
  return localInputString(new Date(iso));
}
function localInputToIso(local) {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function AdminWaitlistTab() {
  const feedback = useFeedback();
  const [statusFilter, setStatusFilter] = useState('');
  const [busyId, setBusyId] = useState(null);
  // Local edit state per row's date picker. Map<entry_id, local-input-string>.
  const [drafts, setDrafts] = useState({});

  const fetchEntries = useCallback(async () => {
    let q = supabase
      .from('waitlist_entries')
      .select('id, email, links, status, scheduled_accept_at, accepted_at, rejected_at, created_at')
      .order('scheduled_accept_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(PAGE_LIMIT);
    if (statusFilter) q = q.eq('status', statusFilter);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }, [statusFilter]);

  const { data, loading, error, refreshing, lastUpdated, refresh } =
    useAdminData(fetchEntries, [statusFilter]);
  const rows = data || [];

  const post = async (entry, action, extras, successMsg, label) => {
    setBusyId(entry.id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const res = await fetch(ACTION_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ entry_id: entry.id, action, ...extras }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setDrafts((d) => { const n = { ...d }; delete n[entry.id]; return n; });
      feedback.toast({ type: 'success', message: successMsg });
      await refresh();
    } catch (e) {
      feedback.toast({ type: 'error', message: `${label} failed: ` + (e?.message || e) });
    } finally {
      setBusyId(null);
    }
  };

  const onAccept = (entry) =>
    post(entry, 'accept', {}, `Accepted ${entry.email}`, 'Accept');

  const onReject = async (entry) => {
    const ok = await feedback.confirm({
      title: `Reject ${entry.email}?`,
      message: 'They stay on the waitlist and cannot sign in. You can re-accept them later.',
      confirmLabel: 'Reject',
      danger: true,
    });
    if (!ok) return;
    post(entry, 'reject', {}, `Rejected ${entry.email}`, 'Reject');
  };

  const onReschedule = (entry, local) => {
    const iso = localInputToIso(local);
    if (!iso) return;
    if (new Date(iso).getTime() < Date.now()) {
      feedback.toast({ type: 'info', message: 'Pick a future date/time.' });
      return;
    }
    post(entry, 'reschedule', { scheduled_at: iso }, `Rescheduled ${entry.email}`, 'Reschedule');
  };

  const minLocal = localInputString(new Date());
  const countLabel = loading
    ? 'Loading…'
    : `${rows.length}${rows.length >= PAGE_LIMIT ? '+ (first 200)' : ''} ${statusFilter || 'entries'}`;

  return (
    <div className="admin-section">
      <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated}>
        <select
          className="auth-input admin-filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="admin-filter-meta t-meta">{countLabel}</span>
      </AdminToolbar>

      <AdminAsync
        loading={loading}
        error={error}
        onRetry={refresh}
        skeleton={<AdminSkeleton variant="table" rows={6} cols={6} />}
        isEmpty={rows.length === 0}
        empty={{
          icon: Inbox,
          title: statusFilter ? `No ${statusFilter} entries` : 'No waitlist entries yet',
          body: statusFilter ? 'Try a different status filter.' : 'New signups awaiting access will appear here.',
        }}
      >
        <table className={`admin-table admin-waitlist-table ${refreshing ? 'is-refreshing' : ''}`}>
          <thead>
            <tr>
              <th>Email</th>
              <th>Links</th>
              <th>Status</th>
              <th>Scheduled</th>
              <th>Joined</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const links = Array.isArray(r.links) ? r.links : [];
              const isPending = r.status === 'pending';
              const busy = busyId === r.id;
              return (
                <tr key={r.id}>
                  <td className="admin-email"><CopyableText value={r.email} className="admin-email" /></td>
                  <td className="admin-links">
                    {links.length === 0 ? <span className="admin-muted">—</span> : links.slice(0, 3).map((l, i) => (
                      <a key={i}
                         href={/^https?:\/\//.test(l) ? l : `https://${l}`}
                         target="_blank"
                         rel="noreferrer"
                         className="admin-link">
                        {l.replace(/^https?:\/\//, '').slice(0, 40)}
                      </a>
                    ))}
                    {links.length > 3 && <span className="admin-muted">+{links.length - 3}</span>}
                  </td>
                  <td><StatusPill kind={r.status} /></td>
                  <td className="admin-muted" title={fmtDateTime(r.scheduled_accept_at)}>
                    {r.scheduled_accept_at ? fmtDateTime(r.scheduled_accept_at) : '—'}
                  </td>
                  <td className="admin-muted" title={fmtDateTime(r.created_at)}>{fmtDate(r.created_at)}</td>
                  <td className="admin-actions">
                    {isPending ? (
                      <div className="admin-waitlist-actions">
                        <button className="admin-action admin-action-primary" disabled={busy} onClick={() => onAccept(r)}>
                          {busy ? '…' : 'Accept'}
                        </button>
                        <input
                          type="datetime-local"
                          className="admin-action admin-waitlist-when"
                          min={minLocal}
                          value={drafts[r.id] ?? isoToLocalInput(r.scheduled_accept_at)}
                          disabled={busy}
                          onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                        />
                        <button
                          className="admin-action"
                          disabled={busy}
                          title="Reschedule to the selected date/time"
                          onClick={() => onReschedule(r, drafts[r.id] ?? isoToLocalInput(r.scheduled_accept_at))}
                        >
                          Set
                        </button>
                        <button className="admin-action" disabled={busy} onClick={() => post(r, 'reschedule', { days: 7 }, `Pushed ${r.email} +7d`, 'Reschedule')}>+7d</button>
                        <button className="admin-action admin-action-danger" disabled={busy} onClick={() => onReject(r)}>Reject</button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </AdminAsync>
    </div>
  );
}
