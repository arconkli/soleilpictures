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
      <AdminFunnel rows={funnel} />
      <AdminCardsSection perDay={perDay} cardStats={cardStats} />
      <AdminTierCompareTable rows={tierCompare} />
      <AdminTopUsersList topDemo={topDemo} topPaid={topPaid} />
    </div>
  );
}
