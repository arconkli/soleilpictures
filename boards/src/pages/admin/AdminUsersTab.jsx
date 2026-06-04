// AdminUsersTab — two-pane master–detail view of every account.
//
//   • Shell owns: search (debounced 300ms) + tier filter + sort + pagination,
//     the selected user, and every mutation handler (tier change incl. Stripe-
//     cancel-first, ban / unban / re-sync / delete).
//   • Left  (<AdminUserList>):  compact searchable/filterable user list.
//   • Right (<AdminUserDetail>): rich profile for the selected user, fed by the
//     admin_user_detail RPC — acquisition, activation, engagement, billing, grants.
//     The interactive tier pills (the one part worth keeping) live in its header.
//   • Two useAdminData instances: #1 list, #2 detail (keyed by selection +
//     detailEpoch). Every mutation refreshes BOTH so the row and the open
//     profile stay consistent. Below 900px the detail becomes a slide-in drawer.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useAuth } from '../../auth/AuthGate.jsx';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { adminAccountAction } from '../../lib/checkout.js';
import { formatMoney } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminUserList } from './AdminUserList.jsx';
import { AdminUserDetail } from './AdminUserDetail.jsx';

const PAGE_SIZE = 50;

// Tiny media-query hook for the responsive drawer collapse.
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

export function AdminUsersTab() {
  const { user } = useAuth();
  const feedback = useFeedback();

  const [query, setQueryRaw]   = useState('');
  const [debounced, setDebounced] = useState('');
  const [tierFilter, setTierFilter] = useState('');   // '' = all tiers
  const [sort, setSort]        = useState('recent');
  const [page, setPage]        = useState(0);          // 0-indexed
  const [busyId, setBusyId]    = useState(null);

  const [selectedUserId, setSelectedUserId] = useState(null);
  const [detailEpoch, setDetailEpoch] = useState(0);
  const bumpDetailEpoch = () => setDetailEpoch((e) => e + 1);

  const isNarrow = useMediaQuery('(max-width: 900px)');

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Reset page when filters / sort change
  useEffect(() => { setPage(0); }, [debounced, tierFilter, sort]);

  // ── List query (#1) ──
  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(async () => {
    const q = debounced || null;
    const t = tierFilter || null;
    const [listRes, countRes] = await Promise.all([
      supabase.rpc('admin_list_users', { p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE, p_query: q, p_tier: t, p_sort: sort, p_status: null, p_source: null }),
      supabase.rpc('admin_user_count', { p_query: q, p_tier: t, p_status: null, p_source: null }),
    ]);
    if (listRes.error)  throw listRes.error;
    if (countRes.error) throw countRes.error;
    return { rows: listRes.data || [], total: Number(countRes.data) || 0 };
  }, [page, debounced, tierFilter, sort]);

  const rows  = data?.rows || [];
  const total = data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstIdx  = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastIdx   = Math.min(total, (page + 1) * PAGE_SIZE);

  // Clamp page into range after a mutation shrinks total (no empty-page strand).
  useEffect(() => { if (page > pageCount - 1) setPage(pageCount - 1); }, [pageCount, page]);

  // ── Detail query (#2) — fetched on selection; re-runs on detailEpoch bump ──
  const { data: detailData, loading: detailLoading, error: detailError, refreshing: detailRefreshing } = useAdminData(async () => {
    if (!selectedUserId) return { detail: null };
    const { data: d, error: e } = await supabase.rpc('admin_user_detail', { p_user_id: selectedUserId });
    if (e) throw e;
    return { detail: d ?? null };
  }, [selectedUserId, detailEpoch]);

  const selectedRow = rows.find((r) => r.user_id === selectedUserId) || null;

  // Drop a selection that's no longer in the list (deleted, or paged/filtered away).
  useEffect(() => {
    if (selectedUserId && !rows.some((r) => r.user_id === selectedUserId)) setSelectedUserId(null);
  }, [rows, selectedUserId]);

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!(isNarrow && selectedUserId)) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSelectedUserId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isNarrow, selectedUserId]);

  const hasActiveSub = (row) => ['active', 'trialing'].includes(row.subscription_status || '');

  // After any mutation, refresh the list row AND the open detail.
  const refreshBoth = async () => { await refresh(); bumpDetailEpoch(); };

  const onChangeTier = async (row, nextTier) => {
    if (row.tier === nextTier) return;
    if (row.user_id === user?.id) return;            // self pills are disabled; guard anyway

    const isDowngrade = nextTier === 'demo' || nextTier === 'waitlist';
    const willCancel  = isDowngrade && hasActiveSub(row);   // paying customer → cancel billing first
    const amount = row.subscription_amount_cents != null ? `${formatMoney(row.subscription_amount_cents)}/mo` : 'their plan';

    let message;
    if (willCancel) {
      message = `${row.email} is a paying customer (${amount}). Moving them to ${nextTier} will cancel their Stripe subscription immediately so they stop being billed — issue any refund in Stripe. `
        + (nextTier === 'waitlist'
            ? "They'll lose all access until accepted off the waitlist again."
            : 'They keep their data but are capped at 100 cards and view-only on shared boards.');
    } else if (nextTier === 'admin') {
      message = `${row.email} will gain full admin access — including the ability to change other tiers and access this page.`;
    } else if (nextTier === 'paid') {
      message = `${row.email} will be granted unlimited paid access without a Stripe subscription. They'll appear as paid users.`;
    } else if (nextTier === 'waitlist') {
      message = `${row.email} will lose all access until they're accepted off the waitlist again. Any complimentary grant is revoked.`;
    } else {
      message = `${row.email} will be capped at 100 cards and viewer-only on other people's boards. Any complimentary grant is revoked.`;
    }

    const ok = await feedback.confirm({
      title:        `Change ${row.email} → ${nextTier}?`,
      message,
      confirmLabel: willCancel ? 'Cancel sub & change tier' : 'Change tier',
      danger:       nextTier === 'admin' || nextTier === 'waitlist' || willCancel,
    });
    if (!ok) return;
    setBusyId(row.user_id);
    try {
      // Stop the billing before flipping the tier — admin_set_tier refuses the
      // downgrade while an active sub exists, so this must come first.
      if (willCancel) await adminAccountAction({ userId: row.user_id, action: 'cancel_subscription' });
      const { error: err } = await supabase.rpc('admin_set_tier', { p_user_id: row.user_id, p_tier: nextTier });
      if (err) throw err;
      feedback.toast({ type: 'success', message: `${row.email} → ${nextTier}` });
      await refreshBoth();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Tier change failed: ' + (e?.message || e) });
    } finally {
      setBusyId(null);
    }
  };

  const onBan = async (row) => {
    const ok = await feedback.confirm({
      title:   `Ban ${row.email}?`,
      message: `They'll be signed out and blocked from signing back in. `
        + (hasActiveSub(row) ? 'Their active Stripe subscription will be canceled so billing stops. ' : '')
        + `You can unban them later; their data is kept.`,
      confirmLabel: 'Ban account',
      danger: true,
    });
    if (!ok) return;
    setBusyId(row.user_id);
    try {
      await adminAccountAction({ userId: row.user_id, action: 'ban' });
      feedback.toast({ type: 'success', message: `Banned ${row.email}` });
      await refreshBoth();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Ban failed: ' + (e?.message || e) });
    } finally { setBusyId(null); }
  };

  const onUnban = async (row) => {
    const ok = await feedback.confirm({
      title:   `Unban ${row.email}?`,
      message: `They'll be able to sign in again at their previous tier. This does not restore any canceled subscription.`,
      confirmLabel: 'Unban',
    });
    if (!ok) return;
    setBusyId(row.user_id);
    try {
      await adminAccountAction({ userId: row.user_id, action: 'unban' });
      feedback.toast({ type: 'success', message: `Unbanned ${row.email}` });
      await refreshBoth();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Unban failed: ' + (e?.message || e) });
    } finally { setBusyId(null); }
  };

  const onResync = async (row) => {
    setBusyId(row.user_id);
    try {
      const res = await adminAccountAction({ userId: row.user_id, action: 'resync_subscription' });
      if (res?.ok === false) {
        feedback.toast({ type: 'info', message: res.reason || 'Nothing to re-sync.' });
      } else {
        const amt = res?.monthly_amount_cents != null ? ` (${formatMoney(res.monthly_amount_cents)}/mo)` : '';
        feedback.toast({ type: 'success', message: `Re-synced billing for ${row.email}${amt}` });
      }
      await refreshBoth();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Re-sync failed: ' + (e?.message || e) });
    } finally { setBusyId(null); }
  };

  const onDelete = async (row) => {
    const ok = await feedback.confirm({
      title:   `Delete ${row.email}?`,
      message: `This permanently deletes the account and can't be undone. `
        + (hasActiveSub(row) ? 'Their active Stripe subscription will be canceled. ' : '')
        + `Boards they created stay in shared workspaces (just un-owned).`,
      confirmLabel: 'Delete account',
      danger: true,
      confirmText: row.email,
      confirmTextLabel: 'Type the email to confirm',
      confirmTextPlaceholder: row.email,
    });
    if (!ok) return;
    setBusyId(row.user_id);
    try {
      await adminAccountAction({ userId: row.user_id, action: 'delete' });
      feedback.toast({ type: 'success', message: `Deleted ${row.email}` });
      setSelectedUserId(null);          // the account is gone — close its profile
      await refresh();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Delete failed: ' + (e?.message || e) });
    } finally { setBusyId(null); }
  };

  const isFiltered = !!(debounced || tierFilter);

  return (
    <div className="admin-section admin-section-users">
      <h2 className="admin-section-title">Users</h2>
      <div className="admin-section-sub">
        Every account on the platform. Search, filter or sort the list, then select a user to see their full
        profile — acquisition, activation, engagement, billing &amp; grants — and change their tier or ban /
        re-sync / delete them.
      </div>

      <div className="admin-users-2pane">
        <AdminUserList
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
          tierFilter={tierFilter}
          onTierFilterChange={setTierFilter}
          sort={sort}
          onSortChange={setSort}
          onPrevPage={() => setPage((p) => Math.max(0, p - 1))}
          onNextPage={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          onRefresh={refresh}
          selectedUserId={selectedUserId}
          onSelect={setSelectedUserId}
          currentUserId={user?.id}
          isFiltered={isFiltered}
        />

        <AdminUserDetail
          detail={detailData?.detail || null}
          loading={detailLoading}
          error={detailError}
          onRetry={bumpDetailEpoch}
          refreshing={detailRefreshing}
          selectedRow={selectedRow}
          currentUserId={user?.id}
          busyId={busyId}
          onChangeTier={onChangeTier}
          onBan={onBan}
          onUnban={onUnban}
          onResync={onResync}
          onDelete={onDelete}
          isOpen={isNarrow && !!selectedUserId}
          onClose={() => setSelectedUserId(null)}
        />

        {isNarrow && (
          <div
            className={`admin-users-detail-backdrop ${selectedUserId ? 'is-open' : ''}`}
            onClick={() => setSelectedUserId(null)}
          />
        )}
      </div>
    </div>
  );
}
