// AdminUsersTab — paginated, filterable list of every user.
//
//   • Toolbar: search (debounced 300ms) + tier filter + refresh.
//   • Body: table with Email | Tier pills | Cards | Time in app | Joined |
//     Last sign-in | Subscription. Clicking a non-current tier pill confirms
//     then calls admin_set_tier. Self-row pills are disabled.
//   • Bottom: pagination (50 / page), clamped after mutations.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useAuth } from '../../auth/AuthGate.jsx';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { CopyableText } from '../../components/CopyableText.jsx';
import { formatDuration } from '../../lib/formatDuration.js';
import { relativeTime, fmtDate, fmtDateTime, formatCount } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { User as UsersIcon } from '../../lib/icons.js';

const PAGE_SIZE = 50;
const TIERS = ['admin', 'paid', 'demo', 'waitlist'];

export function AdminUsersTab() {
  const { user } = useAuth();
  const feedback = useFeedback();

  const [query, setQueryRaw]   = useState('');
  const [debounced, setDebounced] = useState('');
  const [tierFilter, setTierFilter] = useState('');   // '' = all tiers
  const [page, setPage]        = useState(0);          // 0-indexed
  const [busyId, setBusyId]    = useState(null);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [debounced, tierFilter]);

  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(async () => {
    const q = debounced || null;
    const t = tierFilter || null;
    const [listRes, countRes] = await Promise.all([
      supabase.rpc('admin_list_users', { p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE, p_query: q, p_tier: t }),
      supabase.rpc('admin_user_count', { p_query: q, p_tier: t }),
    ]);
    if (listRes.error)  throw listRes.error;
    if (countRes.error) throw countRes.error;
    return { rows: listRes.data || [], total: Number(countRes.data) || 0 };
  }, [page, debounced, tierFilter]);

  const rows  = data?.rows || [];
  const total = data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstIdx  = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastIdx   = Math.min(total, (page + 1) * PAGE_SIZE);

  // Clamp page into range after a mutation shrinks total (no empty-page strand).
  useEffect(() => { if (page > pageCount - 1) setPage(pageCount - 1); }, [pageCount, page]);

  const onChangeTier = async (row, nextTier) => {
    if (row.tier === nextTier) return;
    if (row.user_id === user?.id) return;            // self pills are disabled; guard anyway
    const ok = await feedback.confirm({
      title:        `Change ${row.email} → ${nextTier}?`,
      message:
        nextTier === 'admin'    ? `${row.email} will gain full admin access — including the ability to change other tiers and access this page.`
      : nextTier === 'paid'     ? `${row.email} will be granted unlimited paid access without a Stripe subscription. They'll appear as paid users.`
      : nextTier === 'waitlist' ? `${row.email} will lose all access until they're accepted off the waitlist again.`
      : `${row.email} will be capped at 100 cards and viewer-only on other people's boards.`,
      confirmLabel: 'Change tier',
      danger:       nextTier === 'admin' || nextTier === 'waitlist',
    });
    if (!ok) return;
    setBusyId(row.user_id);
    try {
      const { error: err } = await supabase.rpc('admin_set_tier', { p_user_id: row.user_id, p_tier: nextTier });
      if (err) throw err;
      feedback.toast({ type: 'success', message: `${row.email} → ${nextTier}` });
      await refresh();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Tier change failed: ' + (e?.message || e) });
    } finally {
      setBusyId(null);
    }
  };

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
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          aria-label="Filter by tier"
        >
          <option value="">All tiers</option>
          {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="admin-filter-meta t-meta">
          {loading
            ? 'Loading…'
            : total === 0
              ? 'No matches'
              : `${formatCount(firstIdx)}–${formatCount(lastIdx)} of ${formatCount(total)}`}
        </span>
      </AdminToolbar>

      <AdminAsync
        loading={loading}
        error={error}
        onRetry={refresh}
        skeleton={<AdminSkeleton variant="table" rows={8} cols={7} />}
        isEmpty={rows.length === 0}
        empty={{
          icon: UsersIcon,
          title: 'No users match these filters',
          body: debounced || tierFilter ? 'Try a broader search or a different tier.' : 'Users will appear here as they sign up.',
        }}
      >
        <table className={`admin-table ${refreshing ? 'is-refreshing' : ''}`}>
          <thead>
            <tr>
              <th>Email</th>
              <th>Tier</th>
              <th className="num">Cards</th>
              <th className="num">Time in app</th>
              <th>Joined</th>
              <th>Last sign-in</th>
              <th>Subscription</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSelf = r.user_id === user?.id;
              const subLabel = r.subscription_status
                ? `${r.subscription_plan || 'sub'} · ${r.subscription_status}`
                : '—';
              return (
                <tr key={r.user_id}>
                  <td className="admin-email">
                    <CopyableText value={r.email} className="admin-email" />
                    {isSelf && <span className="admin-muted"> · you</span>}
                  </td>
                  <td>
                    <div className="admin-tier-pill-group">
                      {TIERS.map((t) => (
                        <button
                          key={t}
                          className={`admin-tier-pill admin-tier-pill-${t} ${r.tier === t ? 'is-active' : ''}`}
                          disabled={isSelf || busyId === r.user_id}
                          title={isSelf ? "Can't change your own tier" : r.tier === t ? `Already ${t}` : `Change to ${t}`}
                          onClick={() => onChangeTier(r, t)}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="admin-muted num">{formatCount(r.demo_card_count)}</td>
                  <td className="admin-muted num" title={`${(r.seconds_in_app ?? 0).toLocaleString()} seconds`}>
                    {formatDuration(Number(r.seconds_in_app || 0))}
                  </td>
                  <td className="admin-muted" title={fmtDateTime(r.created_at)}>{fmtDate(r.created_at)}</td>
                  <td className="admin-muted" title={fmtDateTime(r.last_sign_in_at)}>
                    {r.last_sign_in_at ? relativeTime(r.last_sign_in_at) : '—'}
                  </td>
                  <td className="admin-muted">{subLabel}</td>
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
          <button className="admin-action" disabled={page >= pageCount - 1 || refreshing} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>Next →</button>
        </div>
      )}
    </div>
  );
}
