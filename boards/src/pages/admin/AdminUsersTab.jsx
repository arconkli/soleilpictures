// AdminUsersTab — paginated, filterable list of every user.
//
//   • Top: search input (debounced 300ms) + tier filter dropdown
//   • Body: table with Email | Tier pill group | Cards | Joined | Sub | Last sign-in
//   • Per row: clicking a tier pill (other than the current one) opens a
//     confirm dialog then calls admin_set_tier(user_id, tier). Self-row
//     tier pills are disabled with a tooltip — server also blocks self-change.
//   • Bottom: pagination controls. 50 rows / page.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useAuth } from '../../auth/AuthGate.jsx';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { formatDuration } from '../../lib/formatDuration.js';

const PAGE_SIZE = 50;
const TIERS = ['admin', 'paid', 'demo', 'waitlist'];

function relativeTime(iso) {
  if (!iso) return '—';
  const d  = new Date(iso);
  const ms = Date.now() - d.getTime();
  const m  = Math.floor(ms / 60000);
  if (m < 1)        return 'now';
  if (m < 60)       return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)       return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 30)    return `${days}d`;
  return d.toLocaleDateString();
}

export function AdminUsersTab() {
  const { user } = useAuth();
  const feedback = useFeedback();

  const [query, setQueryRaw]   = useState('');
  const [debounced, setDebounced] = useState('');
  const [tierFilter, setTierFilter] = useState('');   // '' = all tiers
  const [page, setPage]        = useState(0);          // 0-indexed
  const [rows, setRows]        = useState([]);
  const [total, setTotal]      = useState(0);
  const [loading, setLoading]  = useState(true);
  const [error, setError]      = useState(null);
  const [busyId, setBusyId]    = useState(null);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [debounced, tierFilter]);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = debounced || null;
      const t = tierFilter || null;
      const [listRes, countRes] = await Promise.all([
        supabase.rpc('admin_list_users', {
          p_limit:  PAGE_SIZE,
          p_offset: page * PAGE_SIZE,
          p_query:  q,
          p_tier:   t,
        }),
        supabase.rpc('admin_user_count', { p_query: q, p_tier: t }),
      ]);
      if (listRes.error)  throw listRes.error;
      if (countRes.error) throw countRes.error;
      setRows(listRes.data || []);
      setTotal(Number(countRes.data) || 0);
    } catch (e) {
      setError(e?.message || String(e));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, debounced, tierFilter]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstIdx  = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastIdx   = Math.min(total, (page + 1) * PAGE_SIZE);

  const onChangeTier = async (row, nextTier) => {
    if (row.tier === nextTier) return;
    if (row.user_id === user?.id) {
      feedback.toast({ type: 'info', message: "You can't change your own tier." });
      return;
    }
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
      const { error } = await supabase.rpc('admin_set_tier', {
        p_user_id: row.user_id,
        p_tier:    nextTier,
      });
      if (error) throw error;
      feedback.toast({ type: 'success', message: `${row.email} → ${nextTier}` });
      await fetchPage();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Tier change failed: ' + (e?.message || e) });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-section">

      {/* Filters */}
      <div className="admin-filter-row">
        <input
          className="auth-input admin-search-input"
          type="text"
          placeholder="search email…"
          value={query}
          onChange={(e) => setQueryRaw(e.target.value)}
        />
        <select
          className="auth-input admin-filter-select"
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
        >
          <option value="">All tiers</option>
          {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="admin-filter-meta t-meta">
          {loading
            ? 'Loading…'
            : total === 0
              ? 'No matches'
              : `${firstIdx.toLocaleString()}–${lastIdx.toLocaleString()} of ${total.toLocaleString()}`}
        </div>
      </div>

      {error && <div className="auth-error t-meta">{error}</div>}

      {/* Table */}
      {rows.length === 0 && !loading ? (
        <div className="admin-empty">No users match these filters.</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Tier</th>
              <th>Cards</th>
              <th>Time in app</th>
              <th>Joined</th>
              <th>Last sign-in</th>
              <th>Subscription</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSelf = r.user_id === user?.id;
              const subLabel =
                r.subscription_status
                  ? `${r.subscription_plan || 'sub'} · ${r.subscription_status}`
                  : '—';
              return (
                <tr key={r.user_id}>
                  <td className="admin-email">
                    {r.email}{isSelf && <span className="admin-muted"> · you</span>}
                  </td>
                  <td>
                    <div className="admin-tier-pill-group">
                      {TIERS.map((t) => (
                        <button
                          key={t}
                          className={`admin-tier-pill admin-tier-pill-${t} ${r.tier === t ? 'is-active' : ''}`}
                          disabled={isSelf || busyId === r.user_id}
                          title={isSelf
                            ? "Can't change your own tier"
                            : r.tier === t
                              ? `Already ${t}`
                              : `Change to ${t}`}
                          onClick={() => onChangeTier(r, t)}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="admin-muted">{r.demo_card_count}</td>
                  <td className="admin-muted" title={`${(r.seconds_in_app ?? 0).toLocaleString()} seconds`}>
                    {formatDuration(Number(r.seconds_in_app || 0))}
                  </td>
                  <td className="admin-muted">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="admin-muted">{relativeTime(r.last_sign_in_at)}</td>
                  <td className="admin-muted">{subLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="admin-pagination">
          <button
            className="admin-action"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← Prev
          </button>
          <span className="admin-muted">
            Page {page + 1} of {pageCount}
          </span>
          <button
            className="admin-action"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
