// AdminWaitlistTab — review waitlist entries.
// Per pending row: Accept now, custom date/time reschedule, quick +7d,
// Reject (confirmed). Every action confirms-if-destructive, toasts its
// outcome, and refetches — so a failed action can't read as success.
//
// Search (debounced email ilike) + status filter + 50/page pagination,
// with a per-status hero strip for an at-a-glance breakdown.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { CopyableText } from '../../components/CopyableText.jsx';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminStatCard } from './AdminStatCard.jsx';
import { StatusPill } from './AdminPills.jsx';
import { fmtDate, fmtDateTime, formatCount, isoToLocalInput, localInputToIso } from '../../lib/adminFormat.js';
import { Inbox } from '../../lib/icons.js';

const ACTION_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/admin-waitlist-action';
const PAGE_SIZE = 50;
const STATUS_OPTIONS = ['pending', 'accepted', 'rejected', 'canceled'];
// Statuses surfaced in the at-a-glance hero strip.
const HERO_STATUSES = ['pending', 'accepted', 'rejected'];

// <input type="datetime-local"> works in LOCAL time as "YYYY-MM-DDTHH:MM".
// Used only for the picker's min= floor; ISO⇄local conversion lives in
// adminFormat (isoToLocalInput / localInputToIso).
function localInputString(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AdminWaitlistTab() {
  const feedback = useFeedback();
  const [query, setQueryRaw] = useState('');
  const [debounced, setDebounced] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);            // 0-indexed
  const [busyId, setBusyId] = useState(null);
  // Local edit state per row's date picker. Map<entry_id, local-input-string>.
  const [drafts, setDrafts] = useState({});

  // Debounce the email search.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Reset to the first page whenever the query or filter changes.
  useEffect(() => { setPage(0); }, [debounced, statusFilter]);

  const fetchEntries = useCallback(async () => {
    const q = debounced || null;
    const offset = page * PAGE_SIZE;

    // Page of rows.
    let listQ = supabase
      .from('waitlist_entries')
      .select('id, email, links, status, scheduled_accept_at, accepted_at, rejected_at, created_at')
      .order('scheduled_accept_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (statusFilter) listQ = listQ.eq('status', statusFilter);
    if (q) listQ = listQ.ilike('email', `%${q}%`);

    // Total matching the same filters (head count, no rows).
    let countQ = supabase
      .from('waitlist_entries')
      .select('id', { count: 'exact', head: true });
    if (statusFilter) countQ = countQ.eq('status', statusFilter);
    if (q) countQ = countQ.ilike('email', `%${q}%`);

    // Per-status hero counts (cheap head counts, independent of the active
    // filter so the breakdown stays a stable at-a-glance summary).
    const heroQ = HERO_STATUSES.map((s) =>
      supabase.from('waitlist_entries').select('id', { count: 'exact', head: true }).eq('status', s)
    );

    const [listRes, countRes, ...heroRes] = await Promise.all([listQ, countQ, ...heroQ]);
    if (listRes.error) throw listRes.error;
    if (countRes.error) throw countRes.error;

    const statusCounts = {};
    HERO_STATUSES.forEach((s, i) => {
      statusCounts[s] = heroRes[i]?.error ? null : (heroRes[i]?.count ?? 0);
    });

    return {
      rows: listRes.data || [],
      total: countRes.count ?? 0,
      statusCounts,
    };
  }, [debounced, statusFilter, page]);

  const { data, loading, error, refreshing, lastUpdated, refresh } =
    useAdminData(fetchEntries, [debounced, statusFilter, page]);

  const rows = data?.rows || [];
  const total = data?.total || 0;
  const statusCounts = data?.statusCounts || {};
  const heroTotal = HERO_STATUSES.reduce((acc, s) => acc + (statusCounts[s] || 0), 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstIdx = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastIdx = Math.min(total, (page + 1) * PAGE_SIZE);
  // Next is enabled when this page came back full (more may follow).
  const hasNext = rows.length === PAGE_SIZE && page < pageCount - 1;

  // Clamp page into range after a mutation shrinks total (no empty-page strand).
  useEffect(() => { if (page > pageCount - 1) setPage(pageCount - 1); }, [pageCount, page]);

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
    : total === 0
      ? 'No matches'
      : `${formatCount(firstIdx)}–${formatCount(lastIdx)} of ${formatCount(total)}`;

  return (
    <div className="admin-section">
      <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated}>
        <input
          className="auth-input admin-search-input"
          type="text"
          placeholder="search email…"
          value={query}
          onChange={(e) => setQueryRaw(e.target.value)}
          aria-label="Search by email"
        />
        <select
          className="auth-input admin-filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="admin-filter-meta t-meta">{countLabel}</span>
      </AdminToolbar>

      {!loading && !error && (
        <div className="admin-stat-grid">
          <AdminStatCard label="Total" value={formatCount(heroTotal)} sub="waitlist entries" />
          <AdminStatCard label="Pending" value={statusCounts.pending == null ? null : formatCount(statusCounts.pending)} sub="awaiting review" />
          <AdminStatCard label="Accepted" value={statusCounts.accepted == null ? null : formatCount(statusCounts.accepted)} sub="granted access" />
          <AdminStatCard label="Rejected" value={statusCounts.rejected == null ? null : formatCount(statusCounts.rejected)} sub="held off" />
        </div>
      )}

      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Waitlist entries</h3>
          <span className="admin-chart-sub t-meta">
            {statusFilter ? `${statusFilter} only` : 'All statuses'}
            {debounced ? ` · matching “${debounced}”` : ''}
          </span>
        </header>

        <AdminAsync
          loading={loading}
          error={error}
          onRetry={refresh}
          skeleton={<AdminSkeleton variant="table" rows={6} cols={6} />}
          isEmpty={rows.length === 0}
          empty={{
            icon: Inbox,
            title: debounced
              ? 'No entries match your search'
              : statusFilter ? `No ${statusFilter} entries` : 'No waitlist entries yet',
            body: debounced
              ? 'Try a different email or clear the search.'
              : statusFilter ? 'Try a different status filter.' : 'New signups awaiting access will appear here.',
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

        {pageCount > 1 && (
          <div className="admin-pagination">
            <button className="admin-action" disabled={page === 0 || refreshing} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Prev</button>
            <span className="admin-muted">Page {page + 1} of {pageCount}</span>
            <button className="admin-action" disabled={!hasNext || refreshing} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>Next →</button>
          </div>
        )}
      </section>
    </div>
  );
}
