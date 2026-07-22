// Admin SEO measurement: the health/deploy-drift strip (migration 0180) + the
// landing-page SCORECARD (migration 0195). Rendered at the top of the Discover
// tab — the tab's job is now "which landing pages win, which leak".
//
// Health: latest seo-health run (edge fn `seo-health`, pg_cron every 6h) —
// red/green per check. Failures also land in the Errors tab (client_errors
// kind 'seo_health'), so this strip is the glanceable summary, not the alert.
//
// Scorecard: one ranked row per public page over the uniform lp_* engagement
// family — views/sessions, median scroll + dwell, signup-CTA CTR, attributed
// signups, referrer classes (ai/search/social/referral/direct), trend spark.

import { useCallback, useEffect, useState } from 'react';
import { adminLandingScorecard, adminSeoReferrers, adminSeoHealthLatest } from '../../lib/boardsApi.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminLandingScorecard } from './AdminLandingScorecard.jsx';
import { AdminTimeRange } from './AdminTimeRange.jsx';

const CLASS_LABELS = { ai: 'AI', search: 'Search', social: 'Social', referral: 'Referral', direct: 'Direct' };
const CLASS_ORDER = ['ai', 'search', 'social', 'referral', 'direct'];

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))}m ago`;
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function AdminSeoSection() {
  const [days, setDays] = useState(30);
  const [pages, setPages] = useState(null);
  const [referrers, setReferrers] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async (d = days) => {
    setRefreshing(true);
    try {
      const [p, r, h] = await Promise.all([
        adminLandingScorecard(d),
        adminSeoReferrers(d),
        adminSeoHealthLatest().catch(() => null), // absent runs ≠ page failure
      ]);
      setPages(p); setReferrers(r); setHealth(h);
      setError(null); setLastUpdated(new Date());
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [days]);

  useEffect(() => { load(days); }, [load, days]);

  const run = health?.run || null;
  const checks = Array.isArray(health?.checks) ? health.checks : [];
  const failing = checks.filter((c) => !c.ok);
  // Stale runs (cron every 6h → amber past ~2 intervals) read as "prober down".
  const stale = run && (Date.now() - new Date(run.run_at).getTime()) > 13 * 3600000;

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">SEO</h3>
        <span className="admin-chart-sub t-meta">
          Live health checks on the public SEO surface (edge prober, every 6h) + landing-page
          performance with search/AI referrer attribution.
        </span>
      </header>

      <AdminToolbar onRefresh={() => load(days)} refreshing={refreshing} lastUpdated={lastUpdated}>
        <AdminTimeRange value={days} onChange={setDays} />
      </AdminToolbar>

      <AdminAsync loading={loading} error={error} onRetry={() => load(days)}
                  skeleton={<AdminSkeleton variant="table" rows={3} />} isEmpty={false}>
        {/* Health strip */}
        <div style={{ marginBottom: 18 }}>
          <div className="t-meta" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
            <b>Health</b>
            {run ? (
              <span style={{ color: failing.length ? 'var(--danger, #e5484d)' : 'var(--ok, #46a758)' }}>
                {failing.length ? `${failing.length} failing` : 'all green'}
              </span>
            ) : <span className="admin-muted">no runs yet</span>}
            {run && (
              <span className="admin-muted" style={stale ? { color: 'var(--warn, #f5a524)' } : undefined}>
                checked {timeAgo(run.run_at)}{stale ? ' — stale' : ''}
              </span>
            )}
          </div>
          {checks.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {checks.map((c) => (
                <span key={`${c.url}:${c.check_name}`}
                      title={`${c.url}\nexpected: ${c.expected}\nactual: ${c.actual}`}
                      style={{
                        font: '500 12px/1 var(--font-sans)', padding: '5px 9px', borderRadius: 999,
                        border: '1px solid var(--line-2)',
                        color: c.ok ? 'var(--ink-1)' : '#fff',
                        background: c.ok ? 'transparent' : 'var(--danger, #e5484d)',
                      }}>
                  {c.ok ? '✓' : '✗'} {c.check_name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Landing-page scorecard */}
        <div className="t-meta" style={{ marginBottom: 6 }}><b>Landing pages ({days}d)</b></div>
        <AdminLandingScorecard rows={pages} />

        {/* Top referrers */}
        {referrers && referrers.length > 0 && (
          <>
            <div className="t-meta" style={{ marginBottom: 6 }}><b>Top referrers</b></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {referrers.map((r) => (
                <span key={`${r.host}:${r.class}`} style={{
                  font: '500 12px/1 var(--font-sans)', padding: '5px 9px', borderRadius: 999,
                  border: '1px solid var(--line-2)',
                  color: r.class === 'ai' ? 'var(--soleil)' : 'var(--ink-1)',
                }}>
                  {r.host} · {CLASS_LABELS[r.class] || r.class} · {r.views}
                </span>
              ))}
            </div>
          </>
        )}
      </AdminAsync>
    </section>
  );
}
