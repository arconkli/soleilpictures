// AdminAnalyticsTab — orchestrator. Fires the 5 admin analytics RPCs in
// parallel on mount and renders Funnel + Cards + TierCompare + TopUsers
// in a single scroll. All data is read-only and live (no caching past
// the initial fetch — refresh the page to refetch).

import { useEffect, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { supabase } from '../../lib/supabase.js';
import { AdminFunnel } from './AdminFunnel.jsx';
import { AdminCardsSection } from './AdminCardsSection.jsx';
import { AdminTierCompareTable } from './AdminTierCompareTable.jsx';
import { AdminTopUsersList } from './AdminTopUsersList.jsx';
import { AdminStorageSection } from './AdminStorageSection.jsx';

const SOLEIL = '#ffa500';

export function AdminAnalyticsTab() {
  const [funnel, setFunnel]         = useState([]);
  const [cardStats, setCardStats]   = useState(null);
  const [perDay, setPerDay]         = useState([]);
  const [tierCompare, setTierCompare] = useState([]);
  const [topDemo, setTopDemo]       = useState([]);
  const [topPaid, setTopPaid]       = useState([]);
  const [acquisition, setAcquisition] = useState([]);
  const [activation, setActivation]   = useState(null);
  const [cohorts, setCohorts]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase.rpc('admin_event_funnel',         { p_days: 30 }),
      supabase.rpc('admin_card_stats',           { p_days: 30 }),
      supabase.rpc('admin_cards_per_day',        { p_days: 30 }),
      supabase.rpc('admin_tier_usage_compare'),
      supabase.rpc('admin_top_users',            { p_tier: 'demo', p_limit: 20 }),
      supabase.rpc('admin_top_users',            { p_tier: 'paid', p_limit: 20 }),
      supabase.rpc('admin_acquisition_breakdown'),
      supabase.rpc('admin_activation_funnel'),
      supabase.rpc('admin_retention_cohorts',    { p_window_days: 60 }),
    ])
      .then(([fn, cs, pd, tc, td, tp, ac, af, ch]) => {
        if (cancelled) return;
        if (fn.error) throw fn.error;
        if (cs.error) throw cs.error;
        if (pd.error) throw pd.error;
        if (tc.error) throw tc.error;
        if (td.error) throw td.error;
        if (tp.error) throw tp.error;
        // Newly-added — tolerate missing if migration hasn't rolled yet.
        setFunnel(fn.data       || []);
        setCardStats(cs.data    || null);
        setPerDay(pd.data       || []);
        setTierCompare(tc.data  || []);
        setTopDemo(td.data      || []);
        setTopPaid(tp.data      || []);
        if (!ac.error) setAcquisition(ac.data || []);
        if (!af.error) setActivation(af.data || null);
        if (!ch.error) setCohorts(ch.data || []);
      })
      .catch((e) => { if (!cancelled) setError(e?.message || String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="admin-empty">Loading analytics…</div>;
  if (error)   return <div className="auth-error t-meta" style={{ padding: 40 }}>{error}</div>;

  return (
    <div className="admin-analytics">
      <CloudflareAnalyticsLink />
      {activation && <ActivationFunnel data={activation} />}
      {cohorts.length > 0 && <RetentionCohorts rows={cohorts} />}
      {acquisition.length > 0 && <AcquisitionBreakdown rows={acquisition} />}
      <AdminFunnel rows={funnel} />
      <AdminCardsSection perDay={perDay} cardStats={cardStats} />
      <AdminTierCompareTable rows={tierCompare} />
      <AdminTopUsersList topDemo={topDemo} topPaid={topPaid} />
      <AdminStorageSection />
    </div>
  );
}

// ── New: activation funnel — signed_up → first_X_at counts ──────────
function ActivationFunnel({ data }) {
  const steps = [
    { key: 'signed_up',      label: 'Signed up' },
    { key: 'first_board',    label: 'Created board' },
    { key: 'first_card',     label: 'Created card' },
    { key: 'first_share',    label: 'Shared a board' },
    { key: 'first_backlink', label: 'Linked a doc' },
    { key: 'first_paid',     label: 'Became paid' },
  ];
  const top = Math.max(1, data.signed_up || 0);
  const chartData = steps.map((s) => ({
    name: s.label,
    count: Number(data[s.key] || 0),
    pct: Number(data[s.key] || 0) / top,
  }));
  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Activation funnel</h3>
        <span className="admin-chart-sub t-meta">all-time, % of signups</span>
      </header>
      <div className="admin-chart-body">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 6, right: 24, bottom: 6, left: 8 }}>
            <XAxis type="number" stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis dataKey="name" type="category" stroke="var(--ink-3)" fontSize={11} tickLine={false} axisLine={false} width={130} />
            <Tooltip
              contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 12 }}
              formatter={(v, _n, p) => [`${v.toLocaleString()} (${(p.payload.pct * 100).toFixed(1)}%)`, 'users']}
            />
            <Bar dataKey="count" radius={[0, 3, 3, 0]}>
              {chartData.map((_, i) => <Cell key={i} fill={SOLEIL} fillOpacity={0.35 + 0.6 * (1 - i / chartData.length)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// ── New: retention cohorts heatmap ──────────────────────────────────
function RetentionCohorts({ rows }) {
  // Pivot rows {cohort_week, day_offset, active_pct, cohort_size} into
  // a {week: [pct per offset]} matrix.
  const byWeek = new Map();
  let maxOffset = 0;
  for (const r of rows) {
    if (!byWeek.has(r.cohort_week)) byWeek.set(r.cohort_week, { size: r.cohort_size, cells: {} });
    byWeek.get(r.cohort_week).cells[r.day_offset] = Number(r.active_pct) || 0;
    if (r.day_offset > maxOffset) maxOffset = r.day_offset;
  }
  const weeks = [...byWeek.keys()].sort().reverse();
  const cap = Math.min(60, maxOffset);
  const offsets = Array.from({ length: cap + 1 }, (_, i) => i);
  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Retention cohorts</h3>
        <span className="admin-chart-sub t-meta">% of cohort active by day-since-signup</span>
      </header>
      <div className="admin-chart-body" style={{ overflowX: 'auto' }}>
        <table className="admin-cohort-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Cohort week</th>
              <th>N</th>
              {offsets.map((o) => <th key={o}>D{o}</th>)}
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => {
              const row = byWeek.get(w);
              return (
                <tr key={w}>
                  <td className="admin-muted" style={{ whiteSpace: 'nowrap' }}>{w}</td>
                  <td className="admin-muted">{row.size}</td>
                  {offsets.map((o) => {
                    const pct = row.cells[o] || 0;
                    const bg = `rgba(255,165,0,${pct})`;
                    const ink = pct > 0.5 ? '#0a0908' : 'var(--ink-1)';
                    return (
                      <td key={o} style={{ background: bg, color: ink, textAlign: 'center', minWidth: 32, fontVariantNumeric: 'tabular-nums' }}>
                        {pct > 0 ? `${Math.round(pct * 100)}` : ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── New: acquisition breakdown ──────────────────────────────────────
function AcquisitionBreakdown({ rows }) {
  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Acquisition source</h3>
        <span className="admin-chart-sub t-meta">first-touch · conversion = signups → paid</span>
      </header>
      <div className="admin-chart-body">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Signups</th>
              <th>Paid</th>
              <th>Conversion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source}>
                <td className="admin-email">{r.source}</td>
                <td className="admin-muted">{r.signups}</td>
                <td className="admin-muted">{r.converted}</td>
                <td className="admin-muted">{r.conversion ? `${(Number(r.conversion) * 100).toFixed(1)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Small banner pointing to the Cloudflare Web Analytics dashboard.
// CWA covers anonymous marketing-side metrics (visits, referrers,
// countries, Web Vitals) that we don't replicate here — the custom
// funnel above owns the authed product-side metrics (tier conversion,
// per-user activity). Two complementary surfaces, one click apart.
function CloudflareAnalyticsLink() {
  const cwaUrl = 'https://dash.cloudflare.com/?to=/:account/web-analytics';
  const tokenSet = !!import.meta.env.VITE_CF_ANALYTICS_TOKEN;
  return (
    <section className="admin-chart-panel admin-chart-panel-wide admin-cwa-link">
      <div className="admin-cwa-row">
        <div>
          <div className="admin-stat-label">Marketing analytics</div>
          <div className="admin-cwa-title">Cloudflare Web Analytics</div>
          <div className="admin-cwa-sub t-meta">
            Anonymous visits, referrers, top pages, country breakdown, and Web Vitals
            — covers what the custom funnel below can't (anon-visit attribution).
            {!tokenSet && ' Beacon not wired — set VITE_CF_ANALYTICS_TOKEN.'}
          </div>
        </div>
        <a
          className="admin-action admin-action-primary"
          href={cwaUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open Cloudflare ↗
        </a>
      </div>
    </section>
  );
}
