// adminDefinitionBreaks.js — when a number started meaning something else.
//
// A weekly trend is a claim that this week is comparable to last week, and the
// claim is false across a change in what the counter counts. This dashboard has
// changed its counters more than once: user counts went verified-only, money
// went trial-aware, crawler and QA traffic was quarantined out of analytics,
// and the did_work signal was stamped on every no-op re-sync until the start of
// October. A slope fitted straight through one of those measures the
// migration, not the product, and nothing on the chart would say so.
//
// This list is the one place those dates live, and it does two jobs:
//
//   1. A `cut` entry tells the weekly trend where to stop scoring. Weeks before
//      it are still drawn, but never compared with the weeks after it
//      (breaksFor() in weeklySeries.js turns the date into a Monday cut point).
//   2. Every entry, cut or not, is a dated marker inside the thirteen-week
//      window Today shows: the What-changed list lists it, and a weekly chart
//      draws it only if its `series` names that chart's column, so a step in a
//      line has its explanation printed beside it.
//
// Only one entry cuts. That is a judgement made series by series, not an
// omission:
//
//   - signups: the verified rule filters on CURRENT column values, so the
//     series is computed the same way for every week back in time. Nothing to
//     cut.
//   - cards: card_index.created_at was backfilled from updated_at, which the
//     client never updates, so it is first-index time throughout. Uniform on
//     both sides of 0254: a marker, not a cut.
//   - work_users: did_work before 0347 was also stamped on no-op re-syncs and
//     credited the board creator, so the weeks before 2026-10-01 over-count and
//     must not be scored against the weeks after it. This is the cut.
//
// `date` is the day the migration file was first committed, so every entry can
// be re-derived rather than remembered:
//
//   git log --format=%ad --date=short --diff-filter=A -- supabase/migrations/<file>
//
// Add new entries the same way. Data only and import-free; the test pins the
// shape the rest of the feature depends on.

/** A dated change in what a series means. `cut` = the weekly trend must not be scored across it. */
export const DEFINITION_BREAKS = [
  { date: '2026-06-01', migration: '0102', series: ['metrics_daily'], cut: false,
    label: 'User counts become email-verified only' },
  { date: '2026-06-18', migration: '0149', series: ['metrics_daily'], cut: false,
    label: 'Verified now means confirmed and signed in' },
  { date: '2026-08-17', migration: '0248', series: ['work_users'], cut: false,
    label: 'Work tracking starts (did_work)' },          // the floor; SQL returns it as work_floor
  { date: '2026-08-22', migration: '0254', series: ['cards'], cut: false,
    label: 'Cards get a creation time (backfilled from first index)' },
  { date: '2026-09-04', migration: '0294', series: ['events'], cut: false,
    label: 'Crawler and QA rows quarantined from analytics' },
  { date: '2026-09-15', migration: '0327', series: ['metrics_daily'], cut: false,
    label: 'Money counters become trial-aware' },
  { date: '2026-09-17', migration: '0332', series: ['metrics_daily'], cut: false,
    label: 'MRR counts active subscriptions only' },
  { date: '2026-10-01', migration: '0347', series: ['work_users'], cut: true,
    label: 'did_work no longer stamped on no-op re-syncs' },
];

/** The columns admin_weekly_series trends, in the order the dashboard stacks them. */
export const WEEKLY_SERIES_KEYS = ['signups', 'active_users', 'work_users', 'cards'];
