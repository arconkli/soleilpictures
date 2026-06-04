// AcquisitionView — where signups come from and how the segment-filtered funnel
// behaves. The toolbar's Source / Campaign / Creative dropdowns drive the
// funnel here, so you can see which channel produces which drop-off.

import { supabase } from '../../../../lib/supabase.js';
import { useAdminData } from '../../useAdminData.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { useAnalyticsFilters, useRegisterViewRuntime } from '../AnalyticsFiltersContext.jsx';
import { SignupFunnelPanel } from '../widgets/SignupFunnelPanel.jsx';
import { AcquisitionBreakdown } from '../widgets/AcquisitionBreakdown.jsx';
import { CloudflareAnalyticsLink } from '../widgets/CloudflareAnalyticsLink.jsx';

export function AcquisitionView() {
  const f = useAnalyticsFilters();
  const q = useAdminData(async () => {
    const [ab, fn, fb] = await Promise.allSettled([
      supabase.rpc('admin_acquisition_breakdown', { p_days: f.days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_signup_funnel',         { p_days: f.days, p_source: f.source || null, p_campaign: f.campaign || null, p_content: f.content || null, p_exclude_internal: f.excludeInternal }),
      // The FB/IG segment is its own funnel — fbclid only, ignoring the UTM
      // selectors (FB ads carry no UTM). Tolerates errors via val() so it can
      // never break the main funnel.
      supabase.rpc('admin_signup_funnel',         { p_days: f.days, p_has_fbclid: true, p_exclude_internal: f.excludeInternal }),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;
    if (fn.status !== 'fulfilled' || fn.value.error) throw errOf(fn) || new Error('Failed to load funnel');
    return { acquisition: val(ab) || [], steps: val(fn) || [], fbSteps: val(fb) || [] };
  }, [f.days, f.source, f.campaign, f.content, f.excludeInternal]);

  useRegisterViewRuntime({ refresh: q.refresh, lastUpdated: q.lastUpdated, refreshing: q.refreshing });

  return (
    <AdminAsync loading={q.loading} error={q.error} onRetry={q.refresh} skeleton={<AdminSkeleton variant="chart" />}>
      <div className={q.refreshing ? 'is-refreshing' : ''}>
        <h2 className="admin-section-title">Acquisition</h2>
        <div className="admin-section-sub">First-touch source attribution and the segment-filtered signup funnel.</div>
        <AcquisitionBreakdown rows={q.data?.acquisition || []} days={f.days} />
        <SignupFunnelPanel steps={q.data?.steps || []} days={f.days}
          title="Funnel for this segment" sub="filtered by the source / campaign / creative selectors above" />
        <SignupFunnelPanel steps={q.data?.fbSteps || []} days={f.days}
          title="Facebook / Instagram funnel"
          sub="visitors who arrived via an FB/IG click (fbclid) — paid ads + organic, since fbclid can't separate them" />
        <CloudflareAnalyticsLink />
      </div>
    </AdminAsync>
  );
}
