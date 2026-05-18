// Compact duration formatter.
// Returns single-token strings that fit comfortably in a ticker cell
// or a stat card. Aims for "human glanceable" precision, not exact.

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < MIN)   return `${s}s`;
  if (s < HOUR)  return `${Math.round(s / MIN)}m`;
  if (s < DAY)   return `${Math.round(s / HOUR)}h`;
  if (s < MONTH) return `${Math.round(s / DAY)}d`;
  if (s < YEAR)  return `${Math.round(s / MONTH)} mo`;
  return `${(s / YEAR).toFixed(1)} yr`;
}

// Longer form for stat card sub-text, e.g. "median 3 d · avg 5 d".
// Same buckets, slightly verbose.
export function formatDurationLong(seconds) {
  return formatDuration(seconds);
}
