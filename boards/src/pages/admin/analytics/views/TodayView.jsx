// TodayView — the daily check-in, and the view that did not exist.
//
// Before this there were two Overviews. The top-level tab showed total users,
// MRR, a signups bar chart, a tier donut and a list of recent emails; the
// Analytics sub-view showed eight KPIs and the funnel. Both led with the same
// numbers, neither was authoritative, and NEITHER answered the question you
// actually open a dashboard with in the morning: does anything need me?
//
// So that question leads here, and it is the only block on the page that is
// about acting rather than knowing.
//
// Two deliberate omissions:
//
//   * No MRR tile. No subscription has ever existed, so it is structurally
//     zero — and this codebase already learned (see the header of the old
//     AdminOverviewTab, and AdminCommandCenter) that a permanent flat zero
//     reads as a measurement rather than an absence. A number that cannot move
//     does not earn the top of the screen.
//
//   * "Needs you" renders only non-zero rows. Feedback has one row in its
//     entire history; a row that always says 0 is the waitlist funnel mistake
//     again. When everything is clear the block says so in a sentence.

import { supabase } from '../../../../lib/supabase.js';
import { formatCount, formatCompact, relativeTime, fmtDateTime } from '../../../../lib/adminFormat.js';
import { useAdminData } from '../../useAdminData.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { useActivityPulse } from '../../useActivityPulse.js';
import { useAnalyticsFilters, useRegisterViewRuntime } from '../AnalyticsFiltersContext.jsx';
import { Metric, MetricGrid, deltaInfo } from '../../viz/Metric.jsx';
import { TrendLine } from '../../viz/TrendLine.jsx';
import { VAR } from '../../viz/palette.js';

const num = (x) => (x == null || Number.isNaN(Number(x)) ? null : Number(x));
const goTo = (tab) => {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    url.searchParams.delete('view');
    window.location.assign(url.toString());
  } catch { /* ignore */ }
};

/**
 * The actionable block. Each row is a queue with a count and somewhere to go.
 *
 * Everything here is derived from counts the dashboard already fetched for
 * other tabs — no new RPC, no new migration. The whole feature is that nobody
 * had put them on one screen.
 */
function NeedsYou({ errors, approvals, feedback, emailFailures }) {
  const rows = [
    approvals > 0 && {
      key: 'approvals',
      count: approvals,
      label: approvals === 1 ? 'cluster waiting for review' : 'clusters waiting for review',
      tab: 'approvals',
      tone: 'act',
    },
    errors > 0 && {
      key: 'errors',
      count: errors,
      label: errors === 1 ? 'distinct error in the last 24h' : 'distinct errors in the last 24h',
      tab: 'errors',
      tone: 'bad',
    },
    emailFailures > 0 && {
      key: 'emails',
      count: emailFailures,
      label: 'email sends failed or bounced this week',
      tab: 'emails',
      tone: 'bad',
    },
    feedback > 0 && {
      key: 'feedback',
      count: feedback,
      label: feedback === 1 ? 'new piece of feedback' : 'new pieces of feedback',
      tab: 'feedback',
      tone: 'act',
    },
  ].filter(Boolean);

  return (
    <section className="admin-needs">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Needs you</h3>
        <span className="admin-chart-sub t-meta">queues and breakage, across every tab</span>
      </header>
      {rows.length === 0 ? (
        <p className="admin-needs-clear">
          Nothing needs you. No pending reviews, no new errors in 24 hours, no failed sends.
        </p>
      ) : (
        <div className="admin-needs-rows">
          {rows.map((r) => (
            <button key={r.key} type="button" className={`admin-needs-row is-${r.tone}`} onClick={() => goTo(r.tab)}>
              <span className="admin-needs-count">{formatCount(r.count)}</span>
              <span className="admin-needs-label">{r.label}</span>
              <span className="admin-needs-go" aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Right now.
 *
 * The pulse is push-based (analytics_events is in the realtime publication),
 * so this costs one backfill and then nothing. Worth knowing before reading it:
 * the platform creates a node roughly every twenty minutes, so a quiet minute
 * here is normal, not a broken pipeline.
 */
function RightNow({ activeNow }) {
  const pulse = useActivityPulse({ minutes: 60 });
  const points = pulse.buckets.map((b) => ({
    v: b.events,
    label: new Date(b.minute).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  }));

  return (
    <section className="admin-chart-panel">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Right now</h3>
        <span className="admin-chart-sub t-meta">
          {formatCount(pulse.total)} events in the last hour
          {pulse.status === 'live' ? ' · live' : pulse.status === 'error' ? ' · reconnecting' : ' · connecting'}
        </span>
      </header>
      <div className="admin-right-now">
        <div className="admin-right-now-figure">
          <span className="admin-right-now-value">{formatCount(activeNow ?? 0)}</span>
          <span className="admin-right-now-label">signed in within 5 minutes</span>
        </div>
        <div className="admin-right-now-plot">
          <TrendLine
            points={points}
            height={64}
            color={VAR.cat[0]}
            area
            formatValue={(v) => `${formatCount(v)} events`}
          />
        </div>
      </div>
    </section>
  );
}

/** Who arrived, and whether they did anything once they got here. */
function WhoArrived({ users }) {
  if (!users.length) return <div className="admin-empty">No signups yet.</div>;
  return (
    <div className="admin-people-list">
      {users.map((u) => {
        const cards = num(u.card_count) || 0;
        const boards = num(u.board_count) || 0;
        const did = cards > 0;
        return (
          <div className="admin-people-row" key={u.user_id}>
            <span className={`admin-people-dot ${did ? 'is-did' : ''}`} aria-hidden="true" />
            <span className="admin-people-email" title={u.email}>{u.email}</span>
            <span className="admin-people-what">
              {did
                ? `${formatCount(cards)} card${cards === 1 ? '' : 's'} · ${formatCount(boards)} cluster${boards === 1 ? '' : 's'}`
                : 'nothing yet'}
            </span>
            <span className="admin-people-when" title={fmtDateTime(u.created_at)}>{relativeTime(u.created_at)}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Who signed up recently and has still never made a card.
 *
 * This is the actionable half of the person view. `admin_user_dormancy` has
 * carried `did_card` all along and nothing on the dashboard has ever read it.
 */
function WhoStalled({ rows }) {
  if (!rows.length) {
    return <div className="admin-empty">Everyone who signed up in the last two weeks has made something.</div>;
  }
  return (
    <div className="admin-people-list">
      {rows.map((r) => (
        <div className="admin-people-row" key={r.user_id}>
          <span className="admin-people-dot" aria-hidden="true" />
          <span className="admin-people-email" title={r.email}>{r.email}</span>
          <span className="admin-people-what">
            {r.active_day_count > 1
              ? `came back ${formatCount(r.active_day_count)}×, never made a card`
              : 'one visit, never made a card'}
          </span>
          <span className="admin-people-when">{formatCount(r.days_dormant)}d quiet</span>
        </div>
      ))}
    </div>
  );
}

export function TodayView() {
  const f = useAnalyticsFilters();

  const q = useAdminData(async () => {
    const [kpi, hist, cards, signups, active, errs, subs, fb, dorm, users, work, mail] = await Promise.allSettled([
      supabase.rpc('admin_kpi_summary', { p_days: 7, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_metrics_history', { p_days: 60 }),
      supabase.rpc('admin_cards_per_day', { p_days: 30, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_signups_by_day', { p_days: 30, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_active_now', { p_window_minutes: 5 }),
      supabase.rpc('admin_recent_errors', { p_days: 1, p_limit: 200, p_include_muted: false }),
      supabase.rpc('admin_public_board_submission_counts'),
      supabase.rpc('admin_list_feedback', { p_limit: 50, p_offset: 0, p_kind: null, p_q: null }),
      supabase.rpc('admin_user_dormancy', { p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_list_users', { p_limit: 8, p_offset: 0 }),
      // Presence and work are different things: 54% of user_active_day rows
      // contain no work event at all, so "weekly active" and "did real work"
      // must come from different calls or the second is just the first again.
      supabase.rpc('admin_habit_curve', { p_exclude_internal: f.excludeInternal, p_require_work: true, p_window_days: 7 }),
      supabase.rpc('admin_email_stats', { p_days: 7, p_exclude_internal: f.excludeInternal, p_include_foreign: false }),
    ]);

    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;

    // Only the headline numbers gate the view. Every queue count degrades to
    // zero — a broken errors query must not blank the morning check-in.
    if (kpi.status !== 'fulfilled' || kpi.value.error) throw errOf(kpi) || new Error('Failed to load today');

    const feedbackRows = val(fb) || [];
    const weekAgo = Date.now() - 7 * 86400_000;

    return {
      kpi: val(kpi),
      history: val(hist) || [],
      cards: val(cards) || [],
      signups: val(signups) || [],
      activeNow: val(active),
      users: val(users) || [],
      // null, not 0, when the call itself failed. A hard zero here would say
      // "nobody did anything this week" when what happened is that we did not
      // find out — the same class of lie as the flat-zero waitlist funnel.
      workUsers: val(work) == null ? null : val(work).reduce((a, r) => a + (num(r.users) || 0), 0),
      // Distinct messages, not occurrences: one loop firing 400 times is one
      // thing to fix, and counting the occurrences would make it look like 400.
      errorCount: new Set((val(errs) || []).map((e) => e.message)).size,
      approvals: num(val(subs)?.pending) || 0,
      feedbackCount: feedbackRows.filter((r) => new Date(r.created_at).getTime() > weekAgo).length,
      emailFailures: (val(mail) || []).reduce((a, r) => a + (num(r.failed) || 0) + (num(r.bounced) || 0), 0),
      stalled: (val(dorm) || [])
        .filter((r) => !r.did_card && (num(r.days_dormant) ?? 999) <= 14)
        .sort((a, b) => (num(b.active_day_count) || 0) - (num(a.active_day_count) || 0))
        .slice(0, 6),
    };
  }, [f.excludeInternal, f.verifiedOnly], { pollIntervalMs: 30_000 });

  useRegisterViewRuntime({ refresh: q.refresh, lastUpdated: q.lastUpdated, refreshing: q.refreshing });

  const d = q.data;
  const cur = d?.kpi?.current || {};
  const prev = d?.kpi?.previous || {};

  return (
    <AdminAsync
      loading={q.loading}
      error={q.error}
      onRetry={q.refresh}
      skeleton={<><AdminSkeleton variant="cards" rows={4} /><div style={{ height: 16 }} /><AdminSkeleton variant="chart" /></>}
    >
      <div className={q.refreshing ? 'is-refreshing' : ''}>
        <NeedsYou
          errors={d?.errorCount || 0}
          approvals={d?.approvals || 0}
          feedback={d?.feedbackCount || 0}
          emailFailures={d?.emailFailures || 0}
        />

        <h2 className="admin-section-title">The last seven days</h2>
        <MetricGrid hero>
          <Metric
            hero
            label="Signups"
            value={cur.signups != null ? formatCount(cur.signups) : null}
            sub="new accounts"
            delta={deltaInfo(num(cur.signups), num(prev.signups))}
            spark={(d?.signups || []).map((r) => num(r.signups) || 0)}
            sparkColor={VAR.cat[0]}
          />
          <Metric
            hero
            label="Weekly active"
            value={cur.wau != null ? formatCount(cur.wau) : null}
            sub="opened the app"
            delta={deltaInfo(num(cur.wau), num(prev.wau))}
            spark={(d?.history || []).map((r) => num(r.active_users) || 0)}
            sparkColor={VAR.cat[0]}
          />
          <Metric
            hero
            label="Did real work"
            value={d?.workUsers != null ? formatCount(d.workUsers) : null}
            sub="placed, edited or shared something"
            title="Counts days containing a work event, not days the app was merely open — user_active_day over-counts presence by roughly 2x."
          />
          <Metric
            hero
            label="Cards created"
            value={cur.cards_created != null ? formatCompact(cur.cards_created) : null}
            sub="across every cluster"
            delta={deltaInfo(num(cur.cards_created), num(prev.cards_created))}
            spark={(d?.cards || []).map((r) => num(r.cards) || 0)}
            sparkColor={VAR.cat[0]}
          />
        </MetricGrid>

        <div style={{ height: 14 }} />
        <RightNow activeNow={d?.activeNow} />

        <h2 className="admin-section-title">People</h2>
        <div className="admin-section-sub">
          At this volume the individuals are legible, so read them rather than an average.
        </div>
        <div className="admin-charts-row">
          <section className="admin-chart-panel">
            <header className="admin-chart-head">
              <h3 className="admin-chart-title">Just arrived</h3>
              <span className="admin-chart-sub t-meta">newest {d?.users?.length || 0}</span>
            </header>
            <WhoArrived users={d?.users || []} />
          </section>
          <section className="admin-chart-panel">
            <header className="admin-chart-head">
              <h3 className="admin-chart-title">Arrived and stalled</h3>
              <span className="admin-chart-sub t-meta">signed up ≤14d ago, no card ever</span>
            </header>
            <WhoStalled rows={d?.stalled || []} />
          </section>
        </div>
      </div>
    </AdminAsync>
  );
}
