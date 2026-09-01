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
import { formatCount } from '../../../../lib/adminFormat.js';
import { useAdminData } from '../../useAdminData.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { useAnalyticsFilters, useRegisterViewRuntime } from '../AnalyticsFiltersContext.jsx';
import { Distribution } from '../../viz/Distribution.jsx';
import { TrendLine } from '../../viz/TrendLine.jsx';
import { AreaChart } from '../../viz/AreaChart.jsx';
import { CohortMatrix } from '../../viz/CohortMatrix.jsx';
import { Deck, Well } from '../../viz/Well.jsx';
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
 * The retention curve, as a line.
 *
 * The old daily cohort grid is still gone, and for the reason its own header
 * gave: at 5-30 people per DAILY cohort it was a wall of suppressed cells. What
 * has come back beside this is a WEEKLY matrix at 25-51 per cohort, which is a
 * different chart with a different denominator — see CohortMatrix.
 */
function RetentionCurvePanel({ rows, windowDays }) {
  // admin_retention_curve returns THREE rows per day_offset — segment all /
  // demo / paid — and this panel plotted every one of them in RPC order. The
  // result was a 22-day decay drawn as a 66-point sawtooth, with the zigzag
  // between segments reading as wild day-to-day volatility. It has always been
  // wrong; putting the chart on a ruled ground is what made it obvious.
  const all = (rows || []).filter((r) => (r.segment ?? 'all') === 'all');
  const points = all
    .filter((r) => num(r.eligible) > 0)
    .sort((a, b) => num(a.day_offset) - num(b.day_offset))
    .map((r) => ({ v: num(r.active_pct) * 100, label: `D${num(r.day_offset)}` }));

  const eligible = num(all?.[0]?.eligible);

  return (
    <Well
      span={4}
      title="Return curve"
      meta={`n=${formatCount(eligible)} · ${windowDays}d`}
      foot="Work-days, not app-open days — user_active_day carries no work event on 54% of its rows."
    >
      <TrendLine
        points={points}
        height={168}
        color={VAR.cat[0]}
        area
        formatValue={(v) => `${v.toFixed(1)}%`}
      />
    </Well>
  );
}

/**
 * Session depth — how long a session actually is.
 *
 * admin_session_depth has been deployed since migration 0250 and had NEVER been
 * called from anywhere. It is the only function in the schema exposing session
 * length percentiles, and "are sessions getting longer" was simply not
 * answerable on this dashboard before now.
 *
 * p90 rather than the mean: session length is heavily skewed, a single
 * left-open tab drags an average anywhere, and the long sessions are the ones
 * worth watching.
 */
function SessionDepth({ rows = [] }) {
  const labels = rows.map((r) => {
    try {
      return new Date(`${r.week}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch { return String(r.week); }
  });

  if (rows.length < 2) {
    return (
      <Well span={6} title="Session depth" meta="never drawn before now">
        <div className="admin-empty">usage_session has fewer than two weeks of history.</div>
      </Well>
    );
  }

  const last = rows[rows.length - 1] || {};

  return (
    <Well
      span={6}
      title="Session length"
      meta={`p50 ${num(last.median_minutes).toFixed(0)}m · p90 ${num(last.p90_minutes).toFixed(0)}m`}
      foot={`${formatCount(num(last.sessions))} sessions from ${formatCount(num(last.users))} people in the latest week.`}
    >
      <AreaChart
        height={168}
        labels={labels}
        formatValue={(v) => `${v.toFixed(0)}m`}
        series={[
          { name: 'p90', color: VAR.cat[2], values: rows.map((r) => num(r.p90_minutes)) },
          { name: 'median', color: VAR.cat[1], values: rows.map((r) => num(r.median_minutes)) },
        ]}
      />
    </Well>
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
    <Well
      span={6}
      title="Days out of 28"
      meta={`${formatCount(total)} present · ${formatCount(workTotal)} worked`}
      foot="did_work is false for every row before 2026-08-17 and cannot be backfilled, so a thin work series here means not-yet-measured, not zero."
    >
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
          height={168}
          formatValue={(v) => `${formatCount(v)} people`}
        />
      )}
    </Well>
  );
}

export function RetentionView() {
  const f = useAnalyticsFilters();

  // One wave, not four. The old view's sequencing was incidental — no call
  // depended on another's result — so it was pure added latency.
  const q = useAdminData(async () => {
    const [af, rc, rr, hp, hw, cm, sd] = await Promise.allSettled([
      supabase.rpc('admin_activation_funnel', { p_days: f.days, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_retention_curve', { p_window_days: Math.max(f.days, 30), p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      // p_require_work: the old call omitted it, so this panel and the habit
      // curve below disagreed about who counts.
      supabase.rpc('admin_return_rate', { p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly, p_require_work: true }),
      supabase.rpc('admin_habit_curve', { p_exclude_internal: f.excludeInternal, p_require_work: false, p_window_days: 28 }),
      supabase.rpc('admin_habit_curve', { p_exclude_internal: f.excludeInternal, p_require_work: true, p_window_days: 28 }),
      // Weekly, not daily. The daily version of this (admin_retention_cohorts)
      // is still deployed and still wrong for the job: its counts are distinct
      // per DAY, so seven of them cannot be summed into a week without
      // double-counting anyone who came back twice.
      supabase.rpc('admin_retention_cohort_matrix', {
        p_weeks: 13, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly, p_require_work: true,
      }),
      // Deployed since 0250 and never once called from the client.
      supabase.rpc('admin_session_depth', { p_days: 84, p_exclude_internal: f.excludeInternal }),
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
      cohorts: val(cm) || [],
      sessionDepth: val(sd) || [],
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
        <ReturnRate rows={q.data?.returnRate || []} />

        <Deck>
          <Well
            span={8}
            title="Cohort retention"
            meta="signup week × weeks since · work-days only"
            foot="Each row is a signup week; each column a week of its life. Blank = that week has not happened yet. Hatched = it predates work instrumentation, so nobody was counting — not that nobody came."
          >
            <CohortMatrix rows={q.data?.cohorts || []} />
          </Well>
          <RetentionCurvePanel rows={q.data?.retention} windowDays={Math.max(f.days, 30)} />
        </Deck>

        <h2 className="admin-section-title">How deep does it go</h2>
        <Deck>
          <HabitPanel presence={q.data?.habitPresence} work={q.data?.habitWork} />
          <SessionDepth rows={q.data?.sessionDepth || []} />
        </Deck>

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
