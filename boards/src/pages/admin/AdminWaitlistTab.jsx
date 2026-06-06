// AdminWaitlistTab — two-pane master–detail review of the waitlist.
//
//   • Shell owns: search (debounced) + status filter + contacted filter, the
//     selected entry, a bulk-selection Set, and every mutation handler.
//   • Left  (<AdminWaitlistList>):  searchable/filterable entry list + bulk bar.
//   • Right (<AdminWaitlistDetail>): full entry — links, timezone, timeline,
//     status-appropriate actions, and the unified Outreach log.
//
// Data comes from admin_list_waitlist (which embeds each entry's outreach), so
// the detail pane needs no separate fetch. ACCEPT still goes through the
// admin-waitlist-action edge fn (it sends the welcome email); reject / reschedule
// / reopen are SECURITY DEFINER RPCs (migration 0123), and outreach is logged by
// email so it shows on the Users tab too. Below 900px the detail is a drawer.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { formatCount } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminStatCard } from './AdminStatCard.jsx';
import { AdminWaitlistList } from './AdminWaitlistList.jsx';
import { AdminWaitlistDetail } from './AdminWaitlistDetail.jsx';

const ACTION_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/admin-waitlist-action';
const PAGE_SIZE = 50;

function useMediaQuery(query) {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function AdminWaitlistTab() {
  const feedback = useFeedback();

  const [query, setQueryRaw]   = useState('');
  const [debounced, setDebounced] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [contacted, setContacted] = useState('');
  const [page, setPage]        = useState(0);
  const [busy, setBusy]        = useState(false);

  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());   // bulk-select ids

  const isNarrow = useMediaQuery('(max-width: 900px)');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Filters/page change → reset page + clear bulk selection (scoped to the view).
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

  const selectedRow = rows.find((r) => r.id === selectedId) || null;

  // Drop a selection that paged/filtered/mutated away.
  useEffect(() => {
    if (selectedId && !rows.some((r) => r.id === selectedId)) setSelectedId(null);
  }, [rows, selectedId]);

  useEffect(() => {
    if (!(isNarrow && selectedId)) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSelectedId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isNarrow, selectedId]);

  // ── selection helpers ──
  const clearSelection = () => setSelected(new Set());
  const toggleCheck = (id) => setSelected((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleAllOnPage = () => setSelected((prev) => {
    const ids = rows.map((r) => r.id);
    const allChecked = ids.length > 0 && ids.every((id) => prev.has(id));
    if (allChecked) return new Set();
    return new Set(ids);
  });

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

  const rescheduleIds = async (ids, opts = {}) => {
    if (!ids.length) return;
    await rpcMutate('admin_waitlist_reschedule',
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

  // Bulk-bar entry points (operate on the current selection).
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const selectedPendingIds = useMemo(
    () => rows.filter((r) => selected.has(r.id) && r.status === 'pending').map((r) => r.id),
    [rows, selected],
  );

  const isFiltered = !!(debounced || statusFilter || contacted);

  return (
    <div className="admin-section admin-section-users">
      <h2 className="admin-section-title">Waitlist</h2>
      <div className="admin-section-sub">
        Review signups awaiting access. Search, filter, or select multiple to act in bulk; pick an entry to see
        its links, schedule access, and log outreach — outreach is shared with the Users tab so nobody double-contacts.
      </div>

      <div className="admin-stat-grid">
        <AdminStatCard label="Total"    value={statusCounts.total == null ? null : formatCount(statusCounts.total)} sub="waitlist entries" />
        <AdminStatCard label="Pending"  value={statusCounts.pending == null ? null : formatCount(statusCounts.pending)} sub="awaiting review" />
        <AdminStatCard label="Accepted" value={statusCounts.accepted == null ? null : formatCount(statusCounts.accepted)} sub="granted access" />
        <AdminStatCard label="Rejected" value={statusCounts.rejected == null ? null : formatCount(statusCounts.rejected)} sub="held off" />
      </div>

      <div className="admin-users-2pane">
        <AdminWaitlistList
          rows={rows}
          total={total}
          loading={loading}
          error={error}
          refreshing={refreshing}
          lastUpdated={lastUpdated}
          page={page}
          pageCount={pageCount}
          firstIdx={firstIdx}
          lastIdx={lastIdx}
          query={query}
          onQueryChange={setQueryRaw}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          contacted={contacted}
          onContactedChange={setContacted}
          onPrevPage={() => setPage((p) => Math.max(0, p - 1))}
          onNextPage={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          onRefresh={refresh}
          selectedId={selectedId}
          onSelect={setSelectedId}
          selected={selected}
          onToggleCheck={toggleCheck}
          onToggleAllOnPage={toggleAllOnPage}
          busy={busy}
          onBulkAccept={() => acceptIds(selectedPendingIds)}
          onBulkReject={() => rejectIds(selectedIds)}
          onBulkReschedule={(opts) => rescheduleIds(selectedIds, opts)}
          onBulkReopen={() => reopenIds(selectedIds)}
          isFiltered={isFiltered}
        />

        <AdminWaitlistDetail
          entry={selectedRow}
          busy={busy}
          isOpen={isNarrow && !!selectedId}
          onClose={() => setSelectedId(null)}
          onAccept={(entry) => acceptIds([entry.id])}
          onReject={(entry) => rejectIds([entry.id])}
          onReschedule={(entry, opts) => rescheduleIds([entry.id], opts)}
          onReopen={(entry) => reopenIds([entry.id])}
          onLogOutreach={onLogOutreach}
          onDeleteOutreach={onDeleteOutreach}
        />

        {isNarrow && (
          <div
            className={`admin-users-detail-backdrop ${selectedId ? 'is-open' : ''}`}
            onClick={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}
