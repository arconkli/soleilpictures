// AdminAnalyticsTab — orchestrator. Reorganized into a funnel narrative:
//   Business health (hero KPI strip) → Acquisition → Activation funnel →
//   Engagement & retention → Monetization & checkout → Cards & product →
//   Infrastructure. A global time-range selector (7/30/90d) threads `days`
//   into every windowed RPC and into useAdminData's deps, so the whole tab
//   re-fetches on change. RPCs fire with allSettled so one failed/not-yet-
//   deployed RPC renders a partial page rather than blanking the tab; the
//   newer KPI/history/stats RPCs are NON-CORE, so the tab survives without
//   them (cards degrade to "—").

import { useEffect, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList } from 'recharts';
import { supabase } from '../../lib/supabase.js';
import { formatPct, formatCount } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminTimeRange } from './AdminTimeRange.jsx';
import { AdminKpiStrip } from './AdminKpiStrip.jsx';
import { AdminFunnel } from './AdminFunnel.jsx';
import { AdminEventBreakdown } from './AdminEventBreakdown.jsx';
import { AdminCardsSection } from './AdminCardsSection.jsx';
import { AdminTierCompareTable } from './AdminTierCompareTable.jsx';
import { AdminTopUsersList } from './AdminTopUsersList.jsx';
import { AdminStorageSection } from './AdminStorageSection.jsx';

const SOLEIL = '#ffa500';

function Section({ title, sub, children }) {
  return (
    <>
      <h2 className="admin-section-title">{title}</h2>
      {sub && <div className="admin-section-sub">{sub}</div>}
      {children}
    </>
  );
}

export function AdminAnalyticsTab() {
  const [days, setDays] = useState(30);

  // Seed/refresh today's snapshot once so the KPI deltas have a current
  // datapoint (same opportunistic top-up the Command Center does).
  useEffect(() => { supabase.rpc('admin_capture_metrics_now').then(() => {}, () => {}); }, []);

  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(async () => {
    const results = await Promise.allSettled([
      supabase.rpc('admin_event_funnel',         { p_days: days }),
      supabase.rpc('admin_card_stats',           { p_days: days }),
      supabase.rpc('admin_cards_per_day',        { p_days: days }),
      supabase.rpc('admin_tier_usage_compare',   { p_days: days }),
      supabase.rpc('admin_top_users',            { p_tier: 'demo', p_limit: 20 }),
      supabase.rpc('admin_top_users',            { p_tier: 'paid', p_limit: 20 }),
      supabase.rpc('admin_acquisition_breakdown',{ p_days: days }),
      supabase.rpc('admin_activation_funnel',    { p_days: days }),
      supabase.rpc('admin_retention_cohorts',    { p_window_days: Math.max(days, 60) }),
      supabase.rpc('admin_event_breakdown',      { p_days: days }),
      supabase.rpc('admin_checkout_reliability',  { p_days: days }),
      supabase.rpc('admin_kpi_summary',          { p_days: days }),   // non-core
      supabase.rpc('admin_metrics_history',      { p_days: 90 }),     // non-core (trend reference)
      supabase.rpc('admin_stats'),                                    // non-core (live MRR/ARPU)
    ]);
    const [fn, cs, pd, tc, td, tp, ac, af, ch, eb, cr, ks, mh, st] = results;
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;
    const core = [fn, cs, pd, tc, td, tp];
    if (!core.some((r) => r.status === 'fulfilled' && !r.value.error)) {
      throw errOf(core.find(errOf)) || new Error('Failed to load analytics');
    }
    return {
      funnel:      val(fn) || [],
      cardStats:   val(cs),
      perDay:      val(pd) || [],
      tierCompare: val(tc) || [],
      topDemo:     val(td) || [],
      topPaid:     val(tp) || [],
      acquisition: val(ac) || [],
      activation:  val(af),
      cohorts:     val(ch) || [],
      eventBreakdown:      val(eb) || [],
      checkoutReliability: val(cr),
      kpi:         val(ks),
      history:     val(mh) || [],
      stats:       val(st),
    };
  }, [days]);

  return (
    <div className="admin-analytics">
      <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated}>
        <AdminTimeRange value={days} onChange={setDays} />
      </AdminToolbar>

      <AdminAsync
        loading={loading}
        error={error}
        onRetry={refresh}
        skeleton={<><AdminSkeleton variant="cards" rows={8} /><div style={{ height: 16 }} /><AdminSkeleton variant="chart" /></>}
      >
        <div className={refreshing ? 'is-refreshing' : ''}>
          <AdminKpiStrip
            kpi={data?.kpi}
            history={data?.history || []}
            stats={data?.stats}
            perDay={data?.perDay || []}
            days={days}
          />

          <Section title="Acquisition" sub="Where signed-up users come from (first-touch).">
            <CloudflareAnalyticsLink />
            {data?.acquisition.length > 0 && <AcquisitionBreakdown rows={data.acquisition} days={days} />}
          </Section>

          <Section title="Activation funnel" sub="Top-of-funnel sessions, then post-signup product milestones.">
            <AdminFunnel rows={data?.funnel || []} days={days} />
            {data?.activation && <ActivationFunnel data={data.activation} days={days} />}
          </Section>

          <Section title="Engagement & retention" sub="How cohorts keep coming back after signup.">
            {data?.cohorts.length > 0 && <RetentionCohorts rows={data.cohorts} />}
          </Section>

          <Section title="Monetization & checkout" sub="Checkout reliability, failure signals, and paid-vs-demo usage.">
            <AdminEventBreakdown rows={data?.eventBreakdown || []} reliability={data?.checkoutReliability} days={days} />
            <AdminTierCompareTable rows={data?.tierCompare || []} />
          </Section>

          <Section title="Cards & product" sub="What's being created and who creates the most.">
            <AdminCardsSection perDay={data?.perDay || []} cardStats={data?.cardStats} days={days} />
            <AdminTopUsersList topDemo={data?.topDemo || []} topPaid={data?.topPaid || []} />
          </Section>

          <Section title="Infrastructure" sub="Storage footprint by tier and heaviest accounts.">
            <AdminStorageSection />
          </Section>
        </div>
      </AdminAsync>
    </div>
  );
}

// ── Activation milestones — signed_up → first_X_at counts ──────────
function ActivationFunnel({ data, days = 30 }) {
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
        <h3 className="admin-chart-title">Activation milestones</h3>
        <span className="admin-chart-sub t-meta">% of signed-up users · last {days}d</span>
      </header>
      <div className="admin-chart-body">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 6, right: 56, bottom: 6, left: 8 }}>
            <XAxis type="number" stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis dataKey="name" type="category" stroke="var(--ink-3)" fontSize={11} tickLine={false} axisLine={false} width={130} />
            <Tooltip
              contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 12 }}
              formatter={(v, _n, p) => [`${formatCount(v)} (${formatPct(p.payload.pct)})`, 'users']}
            />
            <Bar dataKey="count" radius={[0, 3, 3, 0]} isAnimationActive={false}>
              {chartData.map((_, i) => <Cell key={i} fill={SOLEIL} fillOpacity={0.35 + 0.6 * (1 - i / chartData.length)} />)}
              <LabelList dataKey="pct" position="right" formatter={(v) => formatPct(v)} fill="var(--ink-2)" fontSize={11} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// ── Retention cohorts heatmap ──────────────────────────────────────
function RetentionCohorts({ rows }) {
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
                    const pct = Math.max(0, Math.min(1, row.cells[o] || 0));
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

// ── Acquisition breakdown ──────────────────────────────────────────
function AcquisitionBreakdown({ rows, days = 30 }) {
  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Acquisition source</h3>
        <span className="admin-chart-sub t-meta">first-touch · conversion = signups → paid · last {days}d</span>
      </header>
      <div className="admin-chart-body">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Source</th>
              <th className="num">Signups</th>
              <th className="num">Paid</th>
              <th className="num">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source}>
                <td className="admin-email">{r.source}</td>
                <td className="admin-muted num">{formatCount(r.signups)}</td>
                <td className="admin-muted num">{formatCount(r.converted)}</td>
                <td className="admin-muted num">{r.conversion ? formatPct(Number(r.conversion)) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Banner pointing to the Cloudflare Web Analytics dashboard.
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
        <a className="admin-action admin-action-primary" href={cwaUrl} target="_blank" rel="noreferrer">
          Open Cloudflare ↗
        </a>
      </div>
    </section>
  );
}
