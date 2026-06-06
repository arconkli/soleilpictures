// AdminWaitlistTab — review waitlist entries in one at-a-glance table.
//
// Everything is visible inline (links, timezone, status, scheduled, contacted) —
// no side panel. Per pending row: Accept now, custom date/time reschedule, +7d,
// Reject; terminal rows get Re-open. Check rows for bulk Accept / +7d / Reopen /
// Reject. The only thing bigger than a line — the outreach log — expands inline
// under a row (chevron in the Contacted cell).
//
// Data: admin_list_waitlist embeds each entry's outreach (+ contacted summary),
// so no per-row fetch. Accept goes through the admin-waitlist-action edge fn (it
// sends the welcome email); reject/reschedule/reopen are SECURITY DEFINER RPCs
// (migration 0123); outreach is logged by email so it also shows on the Users tab.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { CopyableText } from '../../components/CopyableText.jsx';
import { Icon } from '../../components/Icon.jsx';
import { Inbox, RotateCcw, MessageCircle } from '../../lib/icons.js';
import { fmtDate, fmtDateTime, formatCount, relativeTime, isoToLocalInput, localInputToIso } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminStatCard } from './AdminStatCard.jsx';
import { StatusPill } from './AdminPills.jsx';
import { OutreachSection } from './AdminOutreachSection.jsx';

const ACTION_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/admin-waitlist-action';
const PAGE_SIZE = 50;
const STATUS_OPTIONS = ['pending', 'accepted', 'rejected', 'canceled'];
const CONTACTED_OPTIONS = [
  { value: '',    label: 'Contacted: all' },
  { value: 'no',  label: 'Not contacted' },
  { value: 'yes', label: 'Contacted' },
];
const COLS = 7;   // table column count (for the expand row's colSpan)

// <input type="datetime-local"> works in LOCAL time as "YYYY-MM-DDTHH:MM".
function localInputString(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// A link's site name for a compact pill: strip protocol/www, take the host's
// domain word (instagram.com/jane → "instagram", janedoe.com → "janedoe").
function linkLabel(url) {
  const raw = String(url || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const host = raw.split('/')[0];
  const parts = host.split('.').filter(Boolean);
  return (parts.length >= 2 ? parts[parts.length - 2] : (parts[0] || raw)) || raw;
}
function linkHref(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function AdminWaitlistTab() {
  const feedback = useFeedback();

  const [query, setQueryRaw]   = useState('');
  const [debounced, setDebounced] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [contacted, setContacted] = useState('');
  const [page, setPage]        = useState(0);
  const [busy, setBusy]        = useState(false);
  const [selected, setSelected] = useState(() => new Set());   // bulk-select ids
  const [expandedId, setExpandedId] = useState(null);          // row whose outreach is open
  const [drafts, setDrafts]    = useState({});                 // per-row reschedule datetime

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => { setPage(0); }, [debounced, statusFilter, contacted]);
  useEffect(() => { setSelected(new Set()); }, [debounced, statusFilter, contacted, page]);

  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(async () => {
    const q = debounced || null;
    const s = statusFilter || null;
    const c = contacted || null;
    const [listRes, countRes, statsRes] = await Promise.all([
      supabase.rpc('admin_list_waitlist', { p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE, p_query: q, p_status: s, p_contacted: c }),
      supabase.rpc('admin_waitlist_count', { p_query: q, p_status: s, p_contacted: c }),
      supabase.rpc('admin_waitlist_status_counts'),
    ]);
    if (listRes.error)  throw listRes.error;
    if (countRes.error) throw countRes.error;
    return { rows: listRes.data || [], total: Number(countRes.data) || 0, statusCounts: statsRes.data || {} };
  }, [page, debounced, statusFilter, contacted]);

  const rows  = data?.rows || [];
  const total = data?.total || 0;
  const statusCounts = data?.statusCounts || {};
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstIdx  = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastIdx   = Math.min(total, (page + 1) * PAGE_SIZE);

  useEffect(() => { if (page > pageCount - 1) setPage(pageCount - 1); }, [pageCount, page]);

  // ── selection helpers ──
  const clearSelection = () => setSelected(new Set());
  const toggleCheck = (id) => setSelected((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const pageIds = rows.map((r) => r.id);
  const allOnPageChecked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleAllOnPage = () => setSelected(() => (allOnPageChecked ? new Set() : new Set(pageIds)));

  // ── accept (edge fn — sends the welcome email) ──
  const acceptOne = async (id) => {
    const { data: s } = await supabase.auth.getSession();
    const token = s?.session?.access_token;
    const res = await fetch(ACTION_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ entry_id: id, action: 'accept' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  };
  const acceptIds = async (ids) => {
    if (!ids.length) { feedback.toast({ type: 'info', message: 'No pending entries selected.' }); return; }
    setBusy(true);
    let ok = 0, fail = 0;
    for (const id of ids) { try { await acceptOne(id); ok += 1; } catch { fail += 1; } }
    feedback.toast({ type: fail ? 'info' : 'success', message: `Accepted ${ok}${fail ? ` · ${fail} failed` : ''}` });
    clearSelection();
    await refresh();
    setBusy(false);
  };

  // ── RPC mutations (reject / reschedule / reopen — bulk-capable) ──
  const rpcMutate = async (rpc, params, verb, count) => {
    setBusy(true);
    try {
      const { data: res, error: err } = await supabase.rpc(rpc, params);
      if (err) throw err;
      const affected = res?.affected ?? count;
      const skipped = res?.skipped ?? 0;
      feedback.toast({ type: 'success', message: `${verb} ${affected}${skipped ? ` · ${skipped} skipped` : ''}` });
      setDrafts({});
      clearSelection();
      await refresh();
      return true;
    } catch (e) {
      feedback.toast({ type: 'error', message: `${verb} failed: ` + (e?.message || e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const rejectIds = async (ids) => {
    if (!ids.length) return;
    const ok = await feedback.confirm({
      title: `Reject ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'}?`,
      message: 'They stay on the waitlist and cannot sign in. You can re-open them later. Only pending entries are affected.',
      confirmLabel: 'Reject', danger: true,
    });
    if (!ok) return;
    await rpcMutate('admin_waitlist_reject', { p_ids: ids }, 'Rejected', ids.length);
  };

  const rescheduleIds = (ids, opts = {}) => {
    if (!ids.length) return Promise.resolve(false);
    return rpcMutate('admin_waitlist_reschedule',
      { p_ids: ids, p_scheduled_at: opts.scheduled_at ?? null, p_days: opts.days ?? null },
      'Rescheduled', ids.length);
  };

  const reopenIds = async (ids) => {
    if (!ids.length) return;
    const ok = await feedback.confirm({
      title: `Move ${ids.length} back to pending?`,
      message: 'Re-opens the entry for review. Any accepted user among them loses access (demo → waitlist) until re-accepted.',
      confirmLabel: 'Move to pending', danger: true,
    });
    if (!ok) return;
    await rpcMutate('admin_waitlist_reopen', { p_ids: ids }, 'Re-opened', ids.length);
  };

  const rescheduleToDraft = (entry, local) => {
    const iso = localInputToIso(local);
    if (!iso) return;
    if (new Date(iso).getTime() < Date.now()) {
      feedback.toast({ type: 'info', message: 'Pick a future date/time.' });
      return;
    }
    rescheduleIds([entry.id], { scheduled_at: iso });
  };

  // ── outreach (unified by email — shows on the Users tab too) ──
  const onLogOutreach = async (entry, note) => {
    try {
      const { error: err } = await supabase.rpc('admin_log_outreach', { p_email: entry.email, p_note: note || null });
      if (err) throw err;
      feedback.toast({ type: 'success', message: `Logged outreach to ${entry.email}` });
      await refresh();
      return true;
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not log outreach: ' + (e?.message || e) });
      return false;
    }
  };
  const onDeleteOutreach = async (entry, id) => {
    const ok = await feedback.confirm({
      title: 'Remove this outreach entry?',
      message: 'This deletes the logged outreach note — it can’t be undone.',
      confirmLabel: 'Remove', danger: true,
    });
    if (!ok) return false;
    try {
      const { error: err } = await supabase.rpc('admin_delete_outreach', { p_id: id });
      if (err) throw err;
      feedback.toast({ type: 'success', message: 'Outreach entry removed' });
      await refresh();
      return true;
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Could not remove entry: ' + (e?.message || e) });
      return false;
    }
  };

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const selectedPendingIds = useMemo(
    () => rows.filter((r) => selected.has(r.id) && r.status === 'pending').map((r) => r.id),
    [rows, selected],
  );

  const minLocal = localInputString(new Date());
  const isFiltered = !!(debounced || statusFilter || contacted);
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
        <select
          className="auth-input admin-filter-select"
          value={contacted}
          onChange={(e) => setContacted(e.target.value)}
          aria-label="Filter by outreach status"
        >
          {CONTACTED_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <span className="admin-filter-meta t-meta">{countLabel}</span>
      </AdminToolbar>

      {!loading && !error && (
        <div className="admin-stat-grid">
          <AdminStatCard label="Total"    value={statusCounts.total == null ? null : formatCount(statusCounts.total)} sub="waitlist entries" />
          <AdminStatCard label="Pending"  value={statusCounts.pending == null ? null : formatCount(statusCounts.pending)} sub="awaiting review" />
          <AdminStatCard label="Accepted" value={statusCounts.accepted == null ? null : formatCount(statusCounts.accepted)} sub="granted access" />
          <AdminStatCard label="Rejected" value={statusCounts.rejected == null ? null : formatCount(statusCounts.rejected)} sub="held off" />
        </div>
      )}

      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Waitlist entries</h3>
          <span className="admin-chart-sub t-meta">
            {statusFilter ? `${statusFilter} only` : 'All statuses'}
            {contacted ? ` · ${contacted === 'yes' ? 'contacted' : 'not contacted'}` : ''}
            {debounced ? ` · matching “${debounced}”` : ''}
            {' · '}outreach is shared with the Users tab
          </span>
        </header>

        {selected.size > 0 && (
          <div className="admin-wl-bulkbar">
            <label className="admin-wl-selall">
              <input type="checkbox" checked={allOnPageChecked} onChange={toggleAllOnPage} aria-label="Select all on page" />
              <span>{selected.size} selected</span>
            </label>
            <div className="admin-wl-bulk-actions">
              <button className="admin-action admin-action-primary" disabled={busy} onClick={() => acceptIds(selectedPendingIds)} title="Accept selected (pending only)">Accept</button>
              <button className="admin-action" disabled={busy} onClick={() => rescheduleIds(selectedIds, { days: 7 })}>+7d</button>
              <button className="admin-action" disabled={busy} onClick={() => reopenIds(selectedIds)}>
                <Icon as={RotateCcw} size={13} /> Reopen
              </button>
              <button className="admin-action admin-action-danger" disabled={busy} onClick={() => rejectIds(selectedIds)}>Reject</button>
            </div>
          </div>
        )}

        <AdminAsync
          loading={loading}
          error={error}
          onRetry={refresh}
          skeleton={<AdminSkeleton variant="table" rows={6} cols={COLS} />}
          isEmpty={rows.length === 0}
          empty={{
            icon: Inbox,
            title: isFiltered ? 'No entries match these filters' : 'No waitlist entries yet',
            body: isFiltered ? 'Try a broader search or a different filter.' : 'New signups awaiting access will appear here.',
          }}
        >
          <table className={`admin-table admin-waitlist-table ${refreshing ? 'is-refreshing' : ''}`}>
            <thead>
              <tr>
                <th className="admin-wl-checkcol">
                  <input type="checkbox" checked={allOnPageChecked} onChange={toggleAllOnPage} aria-label="Select all on page" />
                </th>
                <th>Email</th>
                <th>Links</th>
                <th>Status</th>
                <th>Scheduled</th>
                <th>Contacted</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const links = Array.isArray(r.links) ? r.links.filter(Boolean) : [];
                const isPending = r.status === 'pending';
                const isOpen = expandedId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className={isOpen ? 'is-expanded' : ''}>
                      <td className="admin-wl-checkcol">
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleCheck(r.id)} aria-label={`Select ${r.email}`} />
                      </td>
                      <td className="admin-email"><CopyableText value={r.email} className="admin-email" /></td>
                      <td className="admin-wl-links-cell">
                        {links.length === 0 ? <span className="admin-muted">—</span> : (
                          <span className="admin-wl-linkpills">
                            {links.slice(0, 2).map((l, i) => (
                              <a key={i} href={linkHref(l)} target="_blank" rel="noreferrer"
                                 className="admin-wl-linkpill" title={String(l)} onClick={(e) => e.stopPropagation()}>
                                {linkLabel(l)}
                              </a>
                            ))}
                            {links.length > 2 && <span className="admin-muted admin-wl-linkmore">+{links.length - 2}</span>}
                          </span>
                        )}
                      </td>
                      <td><StatusPill kind={r.status} /></td>
                      <td className="admin-muted" title={fmtDateTime(r.scheduled_accept_at)}>
                        {r.scheduled_accept_at ? fmtDate(r.scheduled_accept_at) : '—'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="admin-wl-expand-toggle"
                          onClick={() => setExpandedId((id) => (id === r.id ? null : r.id))}
                          aria-expanded={isOpen}
                          title={isOpen ? 'Hide details' : 'Show details + outreach'}
                        >
                          {r.outreach_count > 0 ? (
                            <span
                              className="admin-badge-contacted"
                              title={`Reached out ${r.outreach_count}×${r.last_reached_out_at ? ` · last ${relativeTime(r.last_reached_out_at)}` : ''}`}
                            >
                              <Icon as={MessageCircle} size={11} /> {r.outreach_count}
                            </span>
                          ) : (
                            <span className="admin-muted">—</span>
                          )}
                          <span className="admin-wl-chevron">{isOpen ? '▾' : '▸'}</span>
                        </button>
                      </td>
                      <td className="admin-actions">
                        {isPending ? (
                          <div className="admin-waitlist-actions">
                            <button className="admin-action admin-action-primary" disabled={busy} onClick={() => acceptIds([r.id])}>Accept</button>
                            <button className="admin-action" disabled={busy} onClick={() => rescheduleIds([r.id], { days: 7 })}>+7d</button>
                            <button className="admin-action admin-action-danger" disabled={busy} onClick={() => rejectIds([r.id])}>Reject</button>
                          </div>
                        ) : (
                          <button className="admin-action" disabled={busy} onClick={() => reopenIds([r.id])} title="Move back to pending">
                            <Icon as={RotateCcw} size={13} /> Reopen
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="admin-wl-expandrow">
                        <td colSpan={COLS}>
                          <div className="admin-wl-expand">
                            <div className="admin-wl-expand-meta t-meta">
                              <span>tz: {r.timezone || '—'}</span>
                              <span>joined {fmtDate(r.created_at)}</span>
                              {r.reviewed_by_email && <span>reviewed by {r.reviewed_by_email}</span>}
                            </div>
                            {links.length > 0 && (
                              <ul className="admin-wl-links">
                                {links.map((l, i) => (
                                  <li key={i}>
                                    <a href={linkHref(l)} target="_blank" rel="noreferrer" className="admin-link">
                                      {String(l).replace(/^https?:\/\//, '')}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {isPending && (
                              <div className="admin-wl-resched">
                                <span className="t-meta admin-muted">Reschedule</span>
                                <input
                                  type="datetime-local"
                                  className="auth-input admin-waitlist-when"
                                  min={minLocal}
                                  value={drafts[r.id] ?? isoToLocalInput(r.scheduled_accept_at)}
                                  disabled={busy}
                                  onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                                />
                                <button className="admin-action" disabled={busy} title="Reschedule to the selected date/time"
                                  onClick={() => rescheduleToDraft(r, drafts[r.id] ?? isoToLocalInput(r.scheduled_accept_at))}>Set date</button>
                                <button className="admin-action" disabled={busy} onClick={() => rescheduleIds([r.id], { days: 7 })}>+7d</button>
                              </div>
                            )}
                            <OutreachSection outreach={r.outreach} row={r} onLogOutreach={onLogOutreach} onDeleteOutreach={onDeleteOutreach} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </AdminAsync>

        {pageCount > 1 && (
          <div className="admin-pagination">
            <button className="admin-action" disabled={page === 0 || refreshing} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Prev</button>
            <span className="admin-muted">Page {page + 1} of {pageCount}</span>
            <button className="admin-action" disabled={page >= pageCount - 1 || refreshing} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>Next →</button>
          </div>
        )}
      </section>
    </div>
  );
}
