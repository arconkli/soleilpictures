// AdminStorageSection — total storage (R2 image files + Postgres Y.Doc
// snapshots), per-tier breakdown, and top 20 users by combined bytes.
// Image byte sizes are stamped at upload time, and any historical gaps are
// filled automatically by the nightly Worker cron (runImageSizeBackfill in
// worker.js) — so there's nothing to do here by hand; the "un-sized" count
// just drains to 0 on its own.

import { supabase } from '../../lib/supabase.js';
import { CopyableText } from '../../components/CopyableText.jsx';
import { formatBytes, formatCount } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminStatCard } from './AdminStatCard.jsx';
import { TierPill } from './AdminPills.jsx';

const TIER_ORDER = ['admin', 'paid', 'demo', 'waitlist'];

export function AdminStorageSection() {
  const { data, loading, error, refreshing, refresh } = useAdminData(async () => {
    const [s, t] = await Promise.all([
      supabase.rpc('admin_storage_stats'),
      supabase.rpc('admin_storage_per_user', { p_limit: 20 }),
    ]);
    if (s.error) throw s.error;
    if (t.error) throw t.error;
    return { stats: s.data || null, top: t.data || [] };
  }, []);

  const stats = data?.stats || null;
  const top   = data?.top || [];
  const totals  = stats?.totals || {};
  const byTier  = stats?.by_tier || {};
  const r2Unknown = totals.r2_unknown_rows || 0;

  return (
    <>
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Storage</h3>
          {r2Unknown > 0 && (
            <span className="admin-chart-sub t-meta">
              {formatCount(r2Unknown)} image{r2Unknown === 1 ? '' : 's'} pending size · fills nightly
            </span>
          )}
        </header>

        <AdminAsync
          loading={loading}
          error={error}
          onRetry={refresh}
          skeleton={<AdminSkeleton variant="cards" rows={4} />}
        >
          <div className={refreshing ? 'is-refreshing' : ''}>
            <div className="admin-stat-grid">
              <AdminStatCard label="Total storage"   value={formatBytes(totals.grand_total)} accent />
              <AdminStatCard label="R2 (uploads)"    value={formatBytes(totals.r2_bytes)}
                sub={r2Unknown > 0 ? `${formatCount(r2Unknown)} pending · fills nightly` : 'all images sized'} />
              <AdminStatCard label="Postgres (docs)" value={formatBytes(totals.db_bytes)}
                sub={totals.db_breakdown
                  ? `state ${formatBytes(totals.db_breakdown.board_state)} · snaps ${formatBytes(totals.db_breakdown.board_snapshots)} · ops ${formatBytes(totals.db_breakdown.board_ops)}`
                  : null} />
              <AdminStatCard label="Users tracked"
                value={formatCount(Object.values(byTier).reduce((a, t) => a + Number(t?.users || 0), 0))} />
            </div>
          </div>
        </AdminAsync>
      </section>

      {/* Per-tier table */}
      {stats && (
        <section className="admin-chart-panel admin-chart-panel-wide">
          <header className="admin-chart-head">
            <h3 className="admin-chart-title">Storage by tier</h3>
          </header>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th className="num">Users</th>
                <th className="num">R2</th>
                <th className="num">Postgres</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {TIER_ORDER.filter((t) => byTier[t]).map((tier) => {
                const t = byTier[tier];
                return (
                  <tr key={tier}>
                    <td><TierPill tier={tier} /></td>
                    <td className="num">{formatCount(t.users)}</td>
                    <td className="num">{formatBytes(t.r2_bytes)}</td>
                    <td className="num">{formatBytes(t.db_bytes)}</td>
                    <td className="num admin-funnel-num">{formatBytes(t.total_bytes)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Top 20 by storage */}
      {stats && (
        <section className="admin-chart-panel admin-chart-panel-wide">
          <header className="admin-chart-head">
            <h3 className="admin-chart-title">Top 20 users by storage</h3>
            <span className="admin-chart-sub t-meta">R2 + Postgres combined</span>
          </header>
          {top.length === 0 ? (
            <div className="admin-empty">No data yet.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th>Email</th>
                  <th>Tier</th>
                  <th className="num">Images</th>
                  <th className="num">R2</th>
                  <th className="num">Postgres</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r, i) => (
                  <tr key={r.user_id}>
                    <td className="admin-top-rank">{i + 1}</td>
                    <td className="admin-email"><CopyableText value={r.email} className="admin-email" /></td>
                    <td><TierPill tier={r.tier} /></td>
                    <td className="num">{formatCount(r.image_count)}</td>
                    <td className="num">{formatBytes(r.r2_bytes)}</td>
                    <td className="num">{formatBytes(r.db_bytes)}</td>
                    <td className="num admin-funnel-num">{formatBytes(r.total_bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}
