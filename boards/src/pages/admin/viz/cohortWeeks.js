// cohortWeeks — whether a cohort-matrix cell's week has finished. Plain JS so
// node --test can drive it (src/lib/adminCohortWeeks.test.mjs).
//
// admin_retention_cohort_matrix emits every week a cohort has lived through UP
// TO AND INCLUDING the current one (its generate_series runs to
// (current_date - cohort_week) / 7). Week `offset` of a cohort covers the UTC
// days [cohort_week + 7*offset, cohort_week + 7*offset + 7), so it is complete
// once the day after it has begun. The current week is one or two days of
// counting on a Monday, and drawn as a measured cell it read as a sharp drop
// down the whole newest diagonal and dragged the "All" row down with it.

const DAY_MS = 86_400_000;

/** Today's UTC date as YYYY-MM-DD, the calendar the RPC's current_date uses. */
export function utcToday(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/** True when week `offset` of the cohort starting `cohortWeek` has ended by `today`. */
export function weekComplete(cohortWeek, offset, today = utcToday()) {
  const start = Date.parse(`${String(cohortWeek).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start)) return false;
  const end = new Date(start + (Number(offset) + 1) * 7 * DAY_MS).toISOString().slice(0, 10);
  return end <= today;
}
