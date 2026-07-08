// Admin SEO measurement (migration 0180): the health/deploy-drift strip + the
// landing-page performance table. Rendered at the top of the Discover tab.
//
// Health: latest seo-health run (edge fn `seo-health`, pg_cron every 6h) —
// red/green per check. Failures also land in the Errors tab (client_errors
// kind 'seo_health'), so this strip is the glanceable summary, not the alert.
//
// Landing pages: views / sessions / signups per /tools|/vs|/use-cases path
// (seo_landing_view events + profiles.first_source attribution), with a
// referrer-class breakdown — the "is AI/search actually sending people" view.

import { useCallback, useEffect, useState } from 'react';
import { adminSeoPageStats, adminSeoReferrers, adminSeoHealthLatest } from '../../lib/boardsApi.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';

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
        adminSeoPageStats(d),
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
        <div role="tablist" aria-label="Window" style={{ display: 'inline-flex', gap: 6 }}>
          {[7, 30].map((d) => (
            <button key={d} role="tab" aria-selected={days === d}
                    className={days === d ? 'btn-secondary is-active' : 'btn-secondary'}
                    onClick={() => setDays(d)}>{d}d</button>
          ))}
        </div>
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

        {/* Landing pages table */}
        <div className="t-meta" style={{ marginBottom: 6 }}><b>Landing pages ({days}d)</b></div>
        {(!pages || pages.length === 0) ? (
          <div className="t-meta admin-muted" style={{ marginBottom: 14 }}>
            No landing-page views in this window yet.
          </div>
        ) : (
          <table className="admin-table" style={{ width: '100%', marginBottom: 14 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Path</th>
                <th>Views</th>
                <th>Sessions</th>
                <th>Signups</th>
                <th style={{ textAlign: 'left' }}>Referrers</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.path}>
                  {/* props.path is attacker-writable (analytics_events has an open
                      insert policy) — only linkify known internal landing paths;
                      anything else renders as inert text, never an href. */}
                  <td style={{ textAlign: 'left' }}>
                    {/^\/(tools|vs|use-cases)(\/|$)/.test(p.path || '')
                      ? <a href={p.path} target="_blank" rel="noreferrer">{p.path}</a>
                      : <span>{p.path}</span>}
                  </td>
                  <td style={{ textAlign: 'center' }}>{p.views}</td>
                  <td style={{ textAlign: 'center' }}>{p.sessions}</td>
                  <td style={{ textAlign: 'center' }}>{p.signups}</td>
                  <td style={{ textAlign: 'left' }}>
                    {CLASS_ORDER.filter((k) => p.referrers?.[k]).map((k) => (
                      <span key={k} style={{
                        font: '500 11px/1 var(--font-sans)', padding: '3px 7px', borderRadius: 999,
                        border: '1px solid var(--line-2)', marginRight: 6,
                        color: k === 'ai' ? 'var(--soleil)' : 'var(--ink-2)',
                      }}>
                        {CLASS_LABELS[k]} {p.referrers[k]}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

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
