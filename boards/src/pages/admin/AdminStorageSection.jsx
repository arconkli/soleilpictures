// AdminStorageSection — total storage (R2 image files + Postgres Y.Doc
// snapshots), per-tier breakdown, top 20 users by combined bytes, plus a
// confirmed "Backfill R2 sizes" button that loops the worker endpoint
// until every images row has a size_bytes value. If it hits the batch cap
// it says so honestly ("stopped early, run again") rather than "done".

import { useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { CopyableText } from '../../components/CopyableText.jsx';
import { formatBytes, formatCount } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminStatCard } from './AdminStatCard.jsx';
import { TierPill } from './AdminPills.jsx';

const TIER_ORDER = ['admin', 'paid', 'demo', 'waitlist'];
const MAX_BATCHES = 200;          // worst case: 200 × 100 = 20k rows / run

export function AdminStorageSection() {
  const feedback = useFeedback();
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState(null);

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

  const runBackfill = async () => {
    if (backfilling) return;
    const ok = await feedback.confirm({
      title: 'Run R2 size backfill?',
      message: 'HEADs every R2 object still missing a size and writes it back. May take a while and hit R2 hard. Safe to run repeatedly.',
      confirmLabel: 'Run backfill',
    });
    if (!ok) return;

    setBackfilling(true);
    setBackfillProgress({ processed: 0, errors: 0, remaining: '?' });
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Not signed in.');

      let totalProcessed = 0;
      let totalErrors = 0;
      let lastRemaining = null;
      let stoppedEarly = false;
      let batches = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (batches++ >= MAX_BATCHES) { stoppedEarly = true; break; }
        const res = await fetch('/api/admin/backfill-image-sizes?limit=100', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        totalProcessed += body.processed || 0;
        totalErrors    += body.errors    || 0;
        lastRemaining = typeof body.remaining === 'number' ? body.remaining : null;
        setBackfillProgress({ processed: totalProcessed, errors: totalErrors, remaining: lastRemaining ?? '?' });
        if (lastRemaining === 0) break;          // explicitly finished
        if ((body.processed || 0) === 0) break;  // no progress (remaining unknown) — avoid an infinite loop
        await new Promise((r) => setTimeout(r, 250));
      }

      if (stoppedEarly) {
        feedback.toast({
          type: 'info',
          message: `Backfill stopped at the ${formatCount(MAX_BATCHES * 100)}-row cap${lastRemaining ? `, ~${formatCount(lastRemaining)} still remaining — run again` : ''}. Processed ${formatCount(totalProcessed)}.`
                   + (totalErrors > 0 ? ` ${totalErrors} errors.` : ''),
        });
      } else {
        feedback.toast({
          type: 'success',
          message: `Backfill done. Processed ${formatCount(totalProcessed)} rows.` + (totalErrors > 0 ? ` ${totalErrors} errors.` : ''),
        });
      }
      await refresh();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Backfill failed: ' + (e?.message || e) });
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <>
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Storage</h3>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {r2Unknown > 0 && (
              <span className="admin-chart-sub t-meta">
                {formatCount(r2Unknown)} image{r2Unknown === 1 ? '' : 's'} missing size — run the backfill ↓
              </span>
            )}
            <button
              className="admin-action admin-action-primary"
              disabled={backfilling}
              onClick={runBackfill}
              title="HEAD every R2 object and write size_bytes back to the images table"
            >
              {backfilling
                ? `Backfilling… ${backfillProgress?.processed ?? 0} (${backfillProgress?.remaining ?? '?'} left)`
                : 'Backfill R2 sizes'}
            </button>
          </div>
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
                sub={r2Unknown > 0 ? `${formatCount(r2Unknown)} rows un-sized` : 'all images sized'} />
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
