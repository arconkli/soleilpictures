// AdminAnalyticsTab — orchestrator. Fires the 5 admin analytics RPCs in
// parallel on mount and renders Funnel + Cards + TierCompare + TopUsers
// in a single scroll. All data is read-only and live (no caching past
// the initial fetch — refresh the page to refetch).

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { AdminFunnel } from './AdminFunnel.jsx';
import { AdminCardsSection } from './AdminCardsSection.jsx';
import { AdminTierCompareTable } from './AdminTierCompareTable.jsx';
import { AdminTopUsersList } from './AdminTopUsersList.jsx';
import { AdminStorageSection } from './AdminStorageSection.jsx';

export function AdminAnalyticsTab() {
  const [funnel, setFunnel]         = useState([]);
  const [cardStats, setCardStats]   = useState(null);
  const [perDay, setPerDay]         = useState([]);
  const [tierCompare, setTierCompare] = useState([]);
  const [topDemo, setTopDemo]       = useState([]);
  const [topPaid, setTopPaid]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase.rpc('admin_event_funnel',        { p_days: 30 }),
      supabase.rpc('admin_card_stats',          { p_days: 30 }),
      supabase.rpc('admin_cards_per_day',       { p_days: 30 }),
      supabase.rpc('admin_tier_usage_compare'),
      supabase.rpc('admin_top_users',           { p_tier: 'demo', p_limit: 20 }),
      supabase.rpc('admin_top_users',           { p_tier: 'paid', p_limit: 20 }),
    ])
      .then(([fn, cs, pd, tc, td, tp]) => {
        if (cancelled) return;
        if (fn.error) throw fn.error;
        if (cs.error) throw cs.error;
        if (pd.error) throw pd.error;
        if (tc.error) throw tc.error;
        if (td.error) throw td.error;
        if (tp.error) throw tp.error;
        setFunnel(fn.data       || []);
        setCardStats(cs.data    || null);
        setPerDay(pd.data       || []);
        setTierCompare(tc.data  || []);
        setTopDemo(td.data      || []);
        setTopPaid(tp.data      || []);
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
      <AdminFunnel rows={funnel} />
      <AdminCardsSection perDay={perDay} cardStats={cardStats} />
      <AdminTierCompareTable rows={tierCompare} />
      <AdminTopUsersList topDemo={topDemo} topPaid={topPaid} />
      <AdminStorageSection />
    </div>
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
