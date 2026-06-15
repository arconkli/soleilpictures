// AdminCampaignTab — the campaign gate for "ad-click → instant demo".
//
// One switch: while ON, visitors arriving from a Facebook/Instagram click
// (detected via the fbclid Facebook auto-appends) skip the invite-only waitlist
// and land on the price-first Creator offer with instant demo access. While OFF,
// everyone goes through the normal waitlist. Backed by the app_config
// `ad_instant_demo` flag (flipped via the admin_set_ad_instant_demo RPC).
//
// IMPORTANT: fbclid is on ALL FB/IG clicks (paid ads AND organic posts/shares),
// so this is scoped to "while a campaign is live" — turn it off when the campaign
// ends so off-campaign social traffic doesn't skip the line.

import { useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { formatCount } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { ToggleSwitch } from './AdminToggle.jsx';

export function AdminCampaignTab() {
  const feedback = useFeedback();
  const [busy, setBusy] = useState(false);

  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(async () => {
    const [flagRes, countRes] = await Promise.all([
      supabase.from('app_config').select('value').eq('key', 'ad_instant_demo').maybeSingle(),
      supabase.from('ad_signups').select('user_id', { count: 'exact', head: true }),
    ]);
    if (flagRes.error)  throw flagRes.error;
    if (countRes.error) throw countRes.error;
    return {
      enabled:   !!flagRes.data?.value?.enabled,
      adSignups: countRes.count || 0,
    };
  }, []);

  const enabled   = !!data?.enabled;
  const adSignups = data?.adSignups || 0;

  const onToggle = async () => {
    if (busy) return;
    const next = !enabled;
    if (next) {
      const ok = await feedback.confirm({
        title: 'Turn ON instant demo for ad traffic?',
        message: 'While ON, anyone arriving from a Facebook/Instagram click (fbclid) skips the '
          + 'waitlist and gets instant demo + the price-first Creator offer. This includes '
          + 'organic FB/IG traffic, not just paid ads — turn it OFF when your campaign ends.',
        confirmLabel: 'Turn on',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const { error: err } = await supabase.rpc('admin_set_ad_instant_demo', { p_enabled: next });
      if (err) throw err;
      feedback.toast({
        type: 'success',
        message: next ? 'Instant demo is ON for ad traffic' : 'Instant demo is OFF — everyone uses the waitlist',
      });
      await refresh();
    } catch (ex) {
      feedback.toast({ type: 'error', message: 'Toggle failed: ' + (ex?.message || ex) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-section">
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Ad traffic → instant demo</h3>
          <span className="admin-chart-sub t-meta">
            While ON, visitors from a Facebook/Instagram click (fbclid) skip the waitlist and
            land on the price-first Creator offer with instant demo access. Organic/direct
            traffic is unaffected. No ad-link change needed, so Facebook's learning is untouched.
          </span>
        </header>

        <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated} />

        <AdminAsync
          loading={loading}
          error={error}
          onRetry={refresh}
          skeleton={<AdminSkeleton variant="cards" rows={1} />}
          isEmpty={false}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '4px 2px 8px' }}>
            <ToggleSwitch checked={enabled} onClick={onToggle} disabled={busy || refreshing} label="Toggle instant demo for ad traffic" />
            <div>
              <div className="t-body" style={{ fontWeight: 600 }}>
                {busy
                  ? 'Saving…'
                  : enabled
                    ? 'On — ad clicks get instant demo + the offer'
                    : 'Off — everyone goes through the waitlist'}
              </div>
              <div className="t-meta admin-muted">
                {formatCount(adSignups)} ad signup{adSignups === 1 ? '' : 's'} fast-tracked so far
              </div>
            </div>
          </div>

          <p className="t-meta admin-muted" style={{ marginTop: 12, maxWidth: 640 }}>
            ⚠ <b>fbclid is on every Facebook/Instagram click</b> — paid ads <i>and</i> organic
            posts, shares, and DMs. Leave this ON only while a campaign is running, then turn it
            OFF so off-campaign social visitors don't skip the invite-only line.
          </p>

          <p className="t-meta admin-muted" style={{ marginTop: 8, maxWidth: 640 }}>
            Note: this switch only matters while the <b>Waitlist</b> master switch is ON. With the
            waitlist OFF, every signup already lands on demo + the Creator offer, so ad clicks get
            the same thing regardless of this toggle (it still records the ad-signup cohort).
          </p>
        </AdminAsync>
      </section>
    </div>
  );
}
