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

// Two units, largest first: "1h 29m", "3d 4h", "45s". formatDuration rounds to
// a single unit because it is built for a ticker cell, which is wrong wherever
// the figure itself is the point: a profile read "1h" for 1h 29m. A zero
// second unit is dropped, so two days is "2d", not "2d 0h".
export function formatDurationPrecise(seconds) {
  const parts = formatDurationParts(seconds).slice(0, 2);
  const shown = parts.length === 2 && parts[1].value === 0 ? parts.slice(0, 1) : parts;
  return shown.map((p) => `${p.value}${p.unit}`).join(' ');
}
