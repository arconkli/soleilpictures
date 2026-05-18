// AdminStorageSection — total storage usage (R2 image files + Postgres
// Y.Doc snapshots), per-tier breakdown, top 20 users by combined bytes,
// plus a manual "Backfill R2 sizes" button that loops the worker
// endpoint until every images row has a size_bytes value.
//
// Reads two RPCs:
//   • admin_storage_stats()  → { totals, by_tier }
//   • admin_storage_per_user(20) → top 20

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../../components/AppFeedback.jsx';

const TIER_ORDER = ['admin', 'paid', 'demo', 'waitlist'];

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = v / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)} ${units[i]}`;
}

export function AdminStorageSection() {
  const feedback = useFeedback();
  const [stats, setStats]     = useState(null);
  const [top, setTop]         = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, t] = await Promise.all([
        supabase.rpc('admin_storage_stats'),
        supabase.rpc('admin_storage_per_user', { p_limit: 20 }),
      ]);
      if (s.error) throw s.error;
      if (t.error) throw t.error;
      setStats(s.data || null);
      setTop(t.data || []);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const runBackfill = async () => {
    if (backfilling) return;
    setBackfilling(true);
    setBackfillProgress({ processed: 0, errors: 0, remaining: '?' });
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Not signed in.');

      let totalProcessed = 0;
      let totalErrors    = 0;
      let safety = 200;   // worst-case caps: 200 batches × 100 = 20k rows
      while (safety-- > 0) {
        const res = await fetch('/api/admin/backfill-image-sizes?limit=100', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        totalProcessed += body.processed || 0;
        totalErrors    += body.errors    || 0;
        setBackfillProgress({
          processed: totalProcessed,
          errors:    totalErrors,
          remaining: body.remaining ?? 0,
        });
        if ((body.remaining || 0) === 0) break;
        // Tiny delay between batches so we don't hammer R2.
        await new Promise((r) => setTimeout(r, 250));
      }
      feedback.toast({
        type: 'success',
        message: `Backfill done. Processed ${totalProcessed} rows.`
                 + (totalErrors > 0 ? ` ${totalErrors} errors.` : ''),
      });
      await load();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Backfill failed: ' + (e?.message || e) });
    } finally {
      setBackfilling(false);
    }
  };

  if (loading) return <div className="admin-empty">Loading storage…</div>;
  if (error)   return <div className="auth-error t-meta" style={{ padding: 40 }}>{error}</div>;

  const totals  = stats?.totals || {};
  const byTier  = stats?.by_tier || {};
  const r2Unknown = totals.r2_unknown_rows || 0;

  return (
    <>
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Storage</h3>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {r2Unknown > 0 && (
              <span className="admin-chart-sub t-meta">
                {r2Unknown.toLocaleString()} image{r2Unknown === 1 ? '' : 's'} missing size — run the backfill ↓
              </span>
            )}
            <button
              className="admin-action admin-action-primary"
              disabled={backfilling}
              onClick={runBackfill}
              title="HEAD every R2 object and write size_bytes back to images table"
            >
              {backfilling
                ? `Backfilling… ${backfillProgress?.processed ?? 0} (${backfillProgress?.remaining ?? '?'} left)`
                : 'Backfill R2 sizes'}
            </button>
          </div>
        </header>

        <div className="admin-stat-grid">
          <StatCard label="Total storage"   value={fmtBytes(totals.grand_total)} accent />
          <StatCard label="R2 (uploads)"    value={fmtBytes(totals.r2_bytes)}
                    sub={r2Unknown > 0 ? `${r2Unknown.toLocaleString()} rows un-sized` : 'all images sized'} />
          <StatCard label="Postgres (docs)" value={fmtBytes(totals.db_bytes)}
                    sub={totals.db_breakdown
                      ? `state ${fmtBytes(totals.db_breakdown.board_state)} · snaps ${fmtBytes(totals.db_breakdown.board_snapshots)} · ops ${fmtBytes(totals.db_breakdown.board_ops)}`
                      : null} />
          <StatCard label="Users tracked"
                    value={Object.values(byTier).reduce((a, t) => a + Number(t?.users || 0), 0).toLocaleString()} />
        </div>
      </section>

      {/* Per-tier table */}
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Storage by tier</h3>
        </header>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Tier</th>
              <th style={{ textAlign: 'right' }}>Users</th>
              <th style={{ textAlign: 'right' }}>R2</th>
              <th style={{ textAlign: 'right' }}>Postgres</th>
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {TIER_ORDER.filter((t) => byTier[t]).map((tier) => {
              const t = byTier[tier];
              return (
                <tr key={tier}>
                  <td><span className={`admin-status admin-status-${tier}`}>{tier}</span></td>
                  <td style={{ textAlign: 'right' }}>{Number(t.users || 0).toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{fmtBytes(t.r2_bytes)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtBytes(t.db_bytes)}</td>
                  <td style={{ textAlign: 'right' }} className="admin-funnel-num">
                    {fmtBytes(t.total_bytes)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Top 20 by storage */}
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
                <th style={{ textAlign: 'right' }}>Images</th>
                <th style={{ textAlign: 'right' }}>R2</th>
                <th style={{ textAlign: 'right' }}>Postgres</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {top.map((r, i) => (
                <tr key={r.user_id}>
                  <td className="admin-top-rank">{i + 1}</td>
                  <td className="admin-email">{r.email}</td>
                  <td><span className={`admin-status admin-status-${r.tier}`}>{r.tier}</span></td>
                  <td style={{ textAlign: 'right' }}>{Number(r.image_count || 0).toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{fmtBytes(r.r2_bytes)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtBytes(r.db_bytes)}</td>
                  <td style={{ textAlign: 'right' }} className="admin-funnel-num">
                    {fmtBytes(r.total_bytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className={`admin-stat-card ${accent ? 'is-accent' : ''}`}>
      <div className="admin-stat-label">{label}</div>
      <div className="admin-stat-value">{value}</div>
      {sub && <div className="admin-stat-sub">{sub}</div>}
    </div>
  );
}
