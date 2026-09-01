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
// MRR is on this screen from before the first subscription exists, by explicit
// decision. The argument against it was that a structurally-zero number reads
// as a measurement rather than an absence — which is true, and the reason the
// tile does NOT draw a sparkline or a delta while it is zero. What it draws
// instead is the reason it is zero, in words. The moment a subscription lands
// it becomes a normal metric with a trend, and nobody has to remember to add
// it back on the day it would first have mattered.

import { supabase } from '../../../../lib/supabase.js';
import { formatCount, formatCompact, formatMoney, relativeTime, fmtDateTime } from '../../../../lib/adminFormat.js';
import { useAdminData } from '../../useAdminData.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { useAnalyticsFilters, useRegisterViewRuntime, POLL_MS } from '../AnalyticsFiltersContext.jsx';
import { Metric, MetricGrid, deltaInfo } from '../../viz/Metric.jsx';
import { AreaChart } from '../../viz/AreaChart.jsx';
import { Heatmap } from '../../viz/Heatmap.jsx';
import { EventConsole } from '../../viz/EventConsole.jsx';
import { Deck, Well, Plate } from '../../viz/Well.jsx';
import { VAR } from '../../viz/palette.js';

// The browser's zone, so the heatmap buckets by the hours the owner keeps
// rather than by UTC — which would smear a US-hours product diagonally across
// the grid and make the dead hours look busy.
const TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
})();

const shortDay = (iso) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return String(iso); }
};

const num = (x) => (x == null || Number.isNaN(Number(x)) ? null : Number(x));

// `RightNow` used to live here: a full-page-width panel holding one numeral and
// a 64px sparkline, which made it the sparsest thing on the densest screen. It
// measured the same stream the live console does, so it moved inside it — the
// numeral is now a readout in the console header.

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
    const [kpi, hist, cards, signups, active, dorm, users, work, life, heat, sig90] = await Promise.allSettled([
      supabase.rpc('admin_kpi_summary', { p_days: 7, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_metrics_history', { p_days: 60 }),
      supabase.rpc('admin_cards_per_day', { p_days: 30, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_signups_by_day', { p_days: 30, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_active_now', { p_window_minutes: 5 }),
      supabase.rpc('admin_user_dormancy', { p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_list_users', { p_limit: 8, p_offset: 0 }),
      // Presence and work are different things: 54% of user_active_day rows
      // contain no work event at all, so "weekly active" and "did real work"
      // must come from different calls or the second is just the first again.
      supabase.rpc('admin_habit_curve', { p_exclude_internal: f.excludeInternal, p_require_work: true, p_window_days: 7 }),
      // Lifetime scale, straight off platform_counters. Every window figure on
      // this screen is paired with one of these: a total on its own only ever
      // goes up, so it cannot tell you anything is wrong, but beside "this
      // week" it gives the week a size.
      supabase.rpc('admin_universe_stats'),
      // The two charts that are worth looking at rather than reading.
      supabase.rpc('admin_activity_heatmap', { p_days: 30, p_tz: TZ, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_signups_by_day', { p_days: 90, p_verified_only: f.verifiedOnly }),
    ]);

    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;

    // Only the headline numbers gate the view; everything else degrades in
    // place rather than blanking the morning check-in.
    if (kpi.status !== 'fulfilled' || kpi.value.error) throw errOf(kpi) || new Error('Failed to load today');

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
      lifetime: val(life) || null,
      heatmap: val(heat) || [],
      signups90: val(sig90) || [],
      stalled: (val(dorm) || [])
        .filter((r) => !r.did_card && (num(r.days_dormant) ?? 999) <= 14)
        .sort((a, b) => (num(b.active_day_count) || 0) - (num(a.active_day_count) || 0))
        .slice(0, 6),
    };
  }, [f.excludeInternal, f.verifiedOnly],
     { pollIntervalMs: POLL_MS.today, refetchOnFocus: true });

  useRegisterViewRuntime({ refresh: q.refresh, lastUpdated: q.lastUpdated, refreshing: q.refreshing });

  const d = q.data;
  const cur = d?.kpi?.current || {};
  const prev = d?.kpi?.previous || {};
  const life = d?.lifetime || {};
  const lifeN = (k) => num(life[k]);

  // MRR rides admin_stats, which the shell already fetches for every view —
  // no extra call. The prior value comes off the same metrics_daily series the
  // sparkline uses, so the badge and the line can never disagree.
  const mrrCents = num(f.stats?.mrr_cents);
  const payingUsers = num(f.stats?.tier_counts?.paid) || 0;
  const arpu = mrrCents != null && payingUsers > 0 ? mrrCents / payingUsers : null;
  const mrrPrev = (() => {
    const h = d?.history || [];
    for (let i = h.length - 2; i >= 0; i--) {
      const v = num(h[i]?.mrr_cents);
      if (v != null) return v;
    }
    return null;
  })();

  return (
    <AdminAsync
      loading={q.loading}
      error={q.error}
      onRetry={q.refresh}
      skeleton={<><AdminSkeleton variant="cards" rows={4} /><div style={{ height: 16 }} /><AdminSkeleton variant="chart" /></>}
    >
      <div className="adm-view">
        {/* Sparkline hue follows the metric's FAMILY — acquisition, engagement,
            output — rather than being four decorative colours. Three hues for
            three families is the most colour this palette can carry honestly:
            a fourth categorical hue does not survive the contrast and
            colour-blindness floors (see viz/palette.js). */}
        <h2 className="admin-section-title">The last seven days</h2>
        {/* The primary readout goes on the plot ground with everything else.
            The tiles were the last part of the page still floating on the bare
            surface, which made the top of the screen read as a document header
            with instruments below it rather than as one console. */}
        <Deck>
        <Well
          span={12}
          className="adm-rail"
          foot={lifeN('total_users') != null ? (
            /* Everything the platform has ever accumulated, on one line. Kept
               out of the tiles because a total that only ever rises cannot tell
               you anything is wrong — it is scale, not a signal, and now it
               reads as the rail's footer rather than as five more metrics. */
            <dl className="admin-lifetime">
              <div><dt>Signups</dt><dd>{formatCount(lifeN('total_users'))}</dd></div>
              <div><dt>Clusters</dt><dd>{formatCount(lifeN('total_boards'))}</dd></div>
              <div><dt>Cards</dt><dd>{formatCount(lifeN('total_cards'))}</dd></div>
              <div><dt>Workspaces</dt><dd>{formatCount(lifeN('total_workspaces'))}</dd></div>
              <div>
                <dt>Time in app</dt>
                <dd>{lifeN('total_seconds_in_app') != null
                  ? `${formatCount(Math.round(lifeN('total_seconds_in_app') / 3600))}h` : '—'}</dd>
              </div>
            </dl>
          ) : null}
        >
        <MetricGrid hero>
          <Metric
            hero
            label="Signups"
            value={cur.signups != null ? formatCount(cur.signups) : null}
            sub="new accounts"
            total={lifeN('total_users') != null
              ? { value: formatCount(lifeN('total_users')), label: 'all time' } : null}
            delta={deltaInfo(num(cur.signups), num(prev.signups))}
            spark={(d?.signups || []).map((r) => num(r.signups) || 0)}
            sparkColor={VAR.cat[0]}   /* acquisition */
          />
          <Metric
            hero
            label="Weekly active"
            value={cur.wau != null ? formatCount(cur.wau) : null}
            sub="opened the app"
            total={lifeN('total_users') != null && cur.wau != null
              ? { value: formatCount(lifeN('total_users')), label: 'signed up' } : null}
            delta={deltaInfo(num(cur.wau), num(prev.wau))}
            spark={(d?.history || []).map((r) => num(r.active_users) || 0)}
            sparkColor={VAR.cat[1]}   /* engagement */
          />
          <Metric
            hero
            label="Did real work"
            value={d?.workUsers != null ? formatCount(d.workUsers) : null}
            sub="placed, edited or shared something"
            total={d?.workUsers != null && cur.wau
              ? { value: formatCount(cur.wau), label: 'were here' } : null}
            ratio={d?.workUsers != null && cur.wau
              ? { pct: d.workUsers / Math.max(1, num(cur.wau)),
                  title: `${formatCount(d.workUsers)} of ${formatCount(cur.wau)} weekly actives did real work` }
              : null}
            sparkColor={VAR.cat[1]}
            title="Counts days containing a work event, not days the app was merely open — user_active_day over-counts presence by roughly 2x."
          />
          <Metric
            hero
            label="MRR"
            value={mrrCents == null ? null : formatMoney(mrrCents)}
            sub={payingUsers > 0
              ? `${formatCount(payingUsers)} paying ${payingUsers === 1 ? 'account' : 'accounts'}`
              : 'no subscription yet'}
            muted={!(mrrCents > 0)}
            total={payingUsers > 0 && arpu != null
              ? { value: formatMoney(arpu), label: 'per account' } : null}
            delta={mrrCents > 0 ? deltaInfo(mrrCents, mrrPrev, 'money') : null}
            spark={mrrCents > 0 ? (d?.history || []).map((r) => num(r.mrr_cents) || 0) : null}
            sparkColor={VAR.cat[1]}
            title={mrrCents > 0
              ? 'Live monthly recurring revenue from active + trialing subscriptions.'
              : 'No subscription has ever existed, so this is zero by absence rather than by measurement. It gets a trend line and a change badge as soon as there is something to trend.'}
          />
          <Metric
            hero
            label="Cards created"
            value={cur.cards_created != null ? formatCompact(cur.cards_created) : null}
            sub="across every cluster"
            total={lifeN('total_cards') != null
              ? { value: formatCompact(lifeN('total_cards')), label: 'all time' } : null}
            delta={deltaInfo(num(cur.cards_created), num(prev.cards_created))}
            spark={(d?.cards || []).map((r) => num(r.cards) || 0)}
            sparkColor={VAR.cat[2]}   /* output */
          />
        </MetricGrid>
        </Well>
        </Deck>

        {/* Four series on four scales. Sharing one axis would flatten signups
            against a number ten times its size — the dual-axis mistake wearing
            a disguise — so they are small multiples instead.

            Two of these cost nothing new. admin_metrics_history returns NINE
            columns and this view was reading three of them; `total_users` was
            fetched and dropped on every poll. It is the growth curve, and it
            was already in the payload. */}
        <h2 className="admin-section-title">Growth</h2>
        <Deck>
          <Well span={3} title="Signups" meta="per day · 90d">
            <AreaChart
              height={168}
              labels={(d?.signups90 || []).map((r) => shortDay(r.day))}
              formatValue={(v) => formatCount(v)}
              series={[{ name: 'Signups', color: VAR.cat[0], values: (d?.signups90 || []).map((r) => num(r.signups) ?? 0) }]}
            />
          </Well>

          <Well span={3} title="Total users" meta="cumulative · 60d">
            <AreaChart
              height={168}
              labels={(d?.history || []).map((r) => shortDay(r.day))}
              formatValue={(v) => formatCount(v)}
              series={[{ name: 'Total users', color: VAR.cat[0], values: (d?.history || []).map((r) => num(r.total_users)) }]}
            />
          </Well>

          <Well span={3} title="Active users" meta="per day · gaps = never captured">
            <AreaChart
              height={168}
              labels={(d?.history || []).map((r) => shortDay(r.day))}
              formatValue={(v) => formatCount(v)}
              series={[{ name: 'Active users', color: VAR.cat[1], values: (d?.history || []).map((r) => num(r.active_users)) }]}
            />
          </Well>

          <Well span={3} title="Cards created" meta="per day · 30d">
            <AreaChart
              height={168}
              labels={(d?.cards || []).map((r) => shortDay(r.day))}
              formatValue={(v) => formatCount(v)}
              series={[{ name: 'Cards', color: VAR.cat[2], values: (d?.cards || []).map((r) => num(r.cards) ?? 0) }]}
            />
          </Well>
        </Deck>

        <h2 className="admin-section-title">When people are here, and what is happening now</h2>
        <Deck>
          <Well
            span={8}
            flush
            title="Activity by weekday and hour"
            meta="30d of events, folded onto one week, your timezone"
            foot="Daily totals are too small to have a shape. A month of them stacked on a week is."
          >
            <Heatmap
              cells={d?.heatmap || []}
              formatValue={(v) => `${formatCount(v)} event${v === 1 ? '' : 's'}`}
            />
          </Well>

          <Well span={4} flush title="Live" meta="pushed, not polled">
            <EventConsole activeNow={d?.activeNow} minutes={60} excludeInternal={f.excludeInternal} />
          </Well>
        </Deck>

        <h2 className="admin-section-title">People</h2>
        <div className="admin-section-sub">
          At this volume the individuals are legible, so read them rather than an average.
        </div>
        <Deck>
          <Plate span={6} title="Just arrived" meta={`newest ${d?.users?.length || 0}`}>
            <WhoArrived users={d?.users || []} />
          </Plate>
          <Plate span={6} title="Arrived and stalled" meta="signed up ≤14d ago, no card ever">
            <WhoStalled rows={d?.stalled || []} />
          </Plate>
        </Deck>
      </div>
    </AdminAsync>
  );
}
