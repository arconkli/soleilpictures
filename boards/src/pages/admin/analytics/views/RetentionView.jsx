// RetentionView — "do they come back, how often, and doing what?"
//
// Replaces EngagementView, which was nineteen widgets in a flat vertical stack
// firing about twenty-five RPCs in four sequential waves. Every panel had the
// same visual weight, so the view had no opinion, and the four waves meant the
// last one could not start until the third finished — for data nobody had
// scrolled to yet.
//
// Now: activation, then return, then habit. Three questions in the order you
// ask them. Everything else is behind Detail and fetches only when opened.
//
// THE CORRECTION THAT MATTERS HERE. user_active_day over-counts: 54% of its
// rows contain no work event at all (migration 0248). Every retention number on
// the dashboard rests on that table, and the old view called admin_return_rate
// WITHOUT p_require_work while calling admin_habit_curve WITH it — so the two
// panels sitting inches apart were measuring different populations and
// disagreeing by construction. Both now ask for work, and the presence figure
// is shown next to it rather than instead of it.

import { supabase } from '../../../../lib/supabase.js';
import { formatCount, formatPct } from '../../../../lib/adminFormat.js';
import { useAdminData } from '../../useAdminData.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { PanelNote } from '../../SmallN.jsx';
import { useAnalyticsFilters, useRegisterViewRuntime } from '../AnalyticsFiltersContext.jsx';
import { Distribution } from '../../viz/Distribution.jsx';
import { TrendLine } from '../../viz/TrendLine.jsx';
import { Detail } from '../../viz/Detail.jsx';
import { VAR } from '../../viz/palette.js';
import { ActivationFunnel } from '../widgets/ActivationFunnel.jsx';
import { ActivationByDevice } from '../widgets/ActivationByDevice.jsx';
import { ReturnRate } from '../widgets/ReturnRate.jsx';
import { RetentionBySource } from '../widgets/RetentionBySource.jsx';
import { UserDormancy } from '../widgets/UserDormancy.jsx';
import { FeatureAdoption } from '../widgets/FeatureAdoption.jsx';
import { SurfaceTime } from '../widgets/SurfaceTime.jsx';
import { TimeToFirstCard } from '../widgets/TimeToFirstCard.jsx';
import { FirstCardFriction } from '../widgets/FirstCardFriction.jsx';
import { PostSignupDropoff } from '../widgets/PostSignupDropoff.jsx';
import { AdminCardsSection } from '../../AdminCardsSection.jsx';

const num = (x) => (x == null || Number.isNaN(Number(x)) ? 0 : Number(x));

/**
 * The retention curve, as a line rather than the cohort heatmap that used to
 * sit here.
 *
 * RetentionCohorts is gone: its own header called it "the worst offender" for
 * small samples, and it is — weekly cohorts here are five to thirty people, so
 * the grid was thirty cells of noise with most of them suppressed anyway. The
 * curve says the same thing with the whole population behind each point.
 */
function RetentionCurvePanel({ rows, windowDays }) {
  const points = (rows || [])
    .filter((r) => num(r.eligible) > 0)
    .map((r) => ({ v: num(r.active_pct) * 100, label: `D${num(r.day_offset)}` }));

  const eligible = num(rows?.[0]?.eligible);
  const at = (d) => (rows || []).find((r) => num(r.day_offset) === d);
  const marks = [1, 7, 30].map((d) => ({ d, row: at(d) })).filter((m) => m.row);

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Return curve</h3>
        <span className="admin-chart-sub t-meta">
          share still active N days after signup · n={formatCount(eligible)} · {windowDays}d window
        </span>
      </header>
      <div className="admin-chart-body">
        {marks.length > 0 && (
          <div className="adm-marks">
            {marks.map(({ d, row }) => (
              <div className="adm-mark" key={d}>
                <span className="adm-mark-label">Day {d}</span>
                <span className="adm-mark-value">{formatPct(num(row.active_pct))}</span>
                <span className="adm-mark-sub">{formatCount(num(row.active))} of {formatCount(num(row.eligible))}</span>
              </div>
            ))}
          </div>
        )}
        <TrendLine
          points={points}
          height={140}
          color={VAR.cat[0]}
          area
          formatValue={(v) => `${v.toFixed(1)}%`}
        />
      </div>
      <PanelNote>
        Counts a day on which the account did real work, not a day the app was merely open —
        user_active_day contains no work event on 54% of its rows.
      </PanelNote>
    </section>
  );
}

/** Days present vs days that contained work, over 28 days. */
function HabitPanel({ presence, work }) {
  const key = (r) => num(r.active_days);
  const days = [...new Set([...(presence || []).map(key), ...(work || []).map(key)])].sort((a, b) => a - b);
  const pick = (rows, d) => num((rows || []).find((r) => key(r) === d)?.users);

  const total = (presence || []).reduce((a, r) => a + num(r.users), 0);
  const workTotal = (work || []).reduce((a, r) => a + num(r.users), 0);

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">How many days out of 28</h3>
        <span className="admin-chart-sub t-meta">
          {formatCount(total)} present · {formatCount(workTotal)} did work · last 28d
        </span>
      </header>
      <div className="admin-chart-body">
        {days.length === 0 ? (
          <div className="admin-empty">Nothing measured yet.</div>
        ) : (
          <Distribution
            buckets={days.map((d) => ({ label: String(d), value: pick(presence, d) }))}
            compare={days.map((d) => ({ label: String(d), value: pick(work, d) }))}
            primaryLabel="App open"
            compareLabel="Did real work"
            color={VAR.inkSoft}
            compareColor={VAR.cat[0]}
            height={140}
            formatValue={(v) => `${formatCount(v)} people`}
          />
        )}
      </div>
      <PanelNote>
        did_work cannot be backfilled — every row before migration 0248 is false, so an empty left
        edge means &ldquo;not yet measured&rdquo;, not zero.
      </PanelNote>
    </section>
  );
}

export function RetentionView() {
  const f = useAnalyticsFilters();

  // One wave, not four. The old view's sequencing was incidental — no call
  // depended on another's result — so it was pure added latency.
  const q = useAdminData(async () => {
    const [af, rc, rr, hp, hw] = await Promise.allSettled([
      supabase.rpc('admin_activation_funnel', { p_days: f.days, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_retention_curve', { p_window_days: Math.max(f.days, 30), p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      // p_require_work: the old call omitted it, so this panel and the habit
      // curve below disagreed about who counts.
      supabase.rpc('admin_return_rate', { p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly, p_require_work: true }),
      supabase.rpc('admin_habit_curve', { p_exclude_internal: f.excludeInternal, p_require_work: false, p_window_days: 28 }),
      supabase.rpc('admin_habit_curve', { p_exclude_internal: f.excludeInternal, p_require_work: true, p_window_days: 28 }),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;
    if (af.status !== 'fulfilled' || af.value.error) throw errOf(af) || new Error('Failed to load activation');
    return {
      activation: val(af),
      retention: val(rc) || [],
      returnRate: val(rr) || [],
      habitPresence: val(hp) || [],
      habitWork: val(hw) || [],
    };
  }, [f.days, f.excludeInternal, f.verifiedOnly]);

  useRegisterViewRuntime({ refresh: q.refresh, lastUpdated: q.lastUpdated, refreshing: q.refreshing });

  return (
    <AdminAsync loading={q.loading} error={q.error} onRetry={q.refresh}
      skeleton={<><AdminSkeleton variant="chart" /><div style={{ height: 16 }} /><AdminSkeleton variant="chart" /></>}>
      <div className={q.refreshing ? 'is-refreshing' : ''}>
        <h2 className="admin-section-title">Did they make anything</h2>
        <div className="admin-section-sub">
          Server-stamped milestones from profiles.first_*_at, not events — the trustworthy funnel.
        </div>
        {q.data?.activation && <ActivationFunnel data={q.data.activation} days={f.days} />}

        <h2 className="admin-section-title">Did they come back</h2>
        <RetentionCurvePanel rows={q.data?.retention} windowDays={Math.max(f.days, 30)} />
        <ReturnRate rows={q.data?.returnRate || []} />

        <h2 className="admin-section-title">How deep does it go</h2>
        <HabitPanel presence={q.data?.habitPresence} work={q.data?.habitWork} />

        <h2 className="admin-section-title">Detail</h2>
        <div className="admin-section-sub">Each section fetches only once opened.</div>
        <Detail id="ret.friction" label="Where first-time users get stuck">
          <LazyFriction days={f.days} f={f} />
        </Detail>
        <Detail id="ret.who" label="Who returns, and who went quiet">
          <LazySegments days={f.days} f={f} />
        </Detail>
        <Detail id="ret.what" label="What they use, and what they make">
          <LazyProduct days={f.days} f={f} />
        </Detail>
      </div>
    </AdminAsync>
  );
}

function LazyFriction({ days, f }) {
  const q = useAdminData(async () => {
    const [jd, tt, fc] = await Promise.allSettled([
      supabase.rpc('admin_journey_dropoff', { p_days: days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_time_to_first_card', { p_days: days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_first_card_friction', { p_days: days, p_exclude_internal: f.excludeInternal }),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    return { journeyDropoff: val(jd), timeToCard: val(tt), friction: val(fc) };
  }, [days, f.excludeInternal]);

  return (
    <AdminAsync loading={q.loading} error={q.error} onRetry={q.refresh} skeleton={<AdminSkeleton variant="chart" />}>
      <PostSignupDropoff data={q.data?.journeyDropoff} />
      <TimeToFirstCard data={q.data?.timeToCard} />
      <FirstCardFriction data={q.data?.friction} />
    </AdminAsync>
  );
}

const DEVICES = ['mobile', 'desktop', 'tablet'];

function LazySegments({ days, f }) {
  const q = useAdminData(async () => {
    const settled = await Promise.allSettled([
      supabase.rpc('admin_retention_by_source', { p_window_days: Math.max(days, 30), p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_user_dormancy', { p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      ...DEVICES.map((d) => supabase.rpc('admin_activation_funnel', {
        p_days: days, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly, p_device: d,
      })),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const [bs, dm, ...deviceResults] = settled;
    return {
      bySource: val(bs) || [],
      dormancy: val(dm) || [],
      byDevice: DEVICES
        .map((device, i) => ({ device, data: val(deviceResults[i]) }))
        .filter((x) => x.data),
    };
  }, [days, f.excludeInternal, f.verifiedOnly]);

  return (
    <AdminAsync loading={q.loading} error={q.error} onRetry={q.refresh} skeleton={<AdminSkeleton variant="table" />}>
      <ActivationByDevice rows={q.data?.byDevice || []} days={days} />
      <RetentionBySource rows={q.data?.bySource || []} />
      <UserDormancy rows={q.data?.dormancy || []} />
    </AdminAsync>
  );
}

function LazyProduct({ days, f }) {
  const q = useAdminData(async () => {
    const [fa, st, cs, pd] = await Promise.allSettled([
      supabase.rpc('admin_feature_adoption', { p_days: Math.max(days, 30), p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_surface_time', { p_days: days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_card_stats', { p_days: days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_cards_per_day', { p_days: days, p_exclude_internal: f.excludeInternal }),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    return { adoption: val(fa) || [], surface: val(st) || [], cardStats: val(cs), perDay: val(pd) || [] };
  }, [days, f.excludeInternal]);

  return (
    <AdminAsync loading={q.loading} error={q.error} onRetry={q.refresh} skeleton={<AdminSkeleton variant="table" />}>
      <FeatureAdoption rows={q.data?.adoption || []} days={Math.max(days, 30)} />
      <AdminCardsSection perDay={q.data?.perDay || []} cardStats={q.data?.cardStats} days={days} />
      <SurfaceTime rows={q.data?.surface || []} days={days} />
    </AdminAsync>
  );
}
