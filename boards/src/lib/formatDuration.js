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

// Full multi-unit breakdown for a big "always going up" counter: returns the
// units from the largest NON-ZERO unit down to seconds, e.g.
//   563525  -> [{d,6},{h,12},{m,32},{s,5}]
//   ~1 year -> [{y,1},{mo,3},{d,12},{h,6},{m,42},{s,18}]
// Leading zero units are dropped (no "0y 0mo …"); seconds are always present so
// the value visibly ticks. Months=30d / years=365d, matching the constants above
// — glanceable, not calendar-exact.
const DURATION_UNITS = [
  ['y', YEAR], ['mo', MONTH], ['d', DAY], ['h', HOUR], ['m', MIN], ['s', 1],
];
export function formatDurationParts(seconds) {
  let s = Math.max(0, Math.floor(Number(seconds) || 0));
  const out = DURATION_UNITS.map(([unit, size]) => {
    const value = Math.floor(s / size);
    s -= value * size;
    return { unit, value };
  });
  let i = 0;
  while (i < out.length - 1 && out[i].value === 0) i++; // trim leading zeros, keep ≥1
  return out.slice(i);
}
