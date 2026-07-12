// Pure calendar-date helpers for the Schedule card (see lib/schedLayout.js).
// All math works on {y, m, d} calendar tuples — never epoch arithmetic and
// never `new Date('YYYY-MM-DD')` (that parses as UTC and shifts a day in
// negative-offset timezones). Date objects are only constructed at LOCAL NOON
// (new Date(y, m-1, d, 12)) so day-of-week / rollover math can never straddle
// a DST transition. Month/weekday names are fixed English (deterministic in
// tests; the app's UI language is English). Weeks are Monday-first.

export const MONTHS = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);
export const MONTHS_SHORT = Object.freeze([
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]);
export const WEEKDAYS = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

export function pad2(n) { return String(n).padStart(2, '0'); }

// m is 1–12 (calendar month, not Date's 0-11).
export function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

// Strict 'YYYY-MM-DD' → {y, m, d}, or null (validates real calendar dates).
export function parseISO(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

export function formatISO(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}`; }

export function todayISO(now = new Date()) {
  return formatISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function atNoon(t) { return new Date(t.y, t.m - 1, t.d, 12); }

// 0 = Monday … 6 = Sunday.
export function weekdayOf(iso) {
  const t = parseISO(iso);
  if (!t) return 0;
  return (atNoon(t).getDay() + 6) % 7;
}

export function firstWeekdayOfMonth(y, m) { return weekdayOf(formatISO(y, m, 1)); }

export function addDays(iso, n) {
  const t = parseISO(iso);
  if (!t) return iso;
  const dt = new Date(t.y, t.m - 1, t.d + n, 12); // noon → DST-proof rollover
  return formatISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

// Keeps the day-of-month, clamped to the target month (Jan 31 +1mo → Feb 28/29).
export function addMonths(iso, n) {
  const t = parseISO(iso);
  if (!t) return iso;
  const total = t.y * 12 + (t.m - 1) + n;
  const y = Math.floor(total / 12), m = total - y * 12 + 1;
  return formatISO(y, m, Math.min(t.d, daysInMonth(y, m)));
}

export function startOfWeek(iso) { return addDays(iso, -weekdayOf(iso)); }

export function isToday(iso, now = new Date()) { return iso === todayISO(now); }

export function monthTitle(iso) {
  const t = parseISO(iso);
  return t ? `${MONTHS[t.m - 1]} ${t.y}` : '';
}

export function weekTitle(iso) {
  const startIso = startOfWeek(iso);
  const a = parseISO(startIso);
  if (!a) return '';
  const b = parseISO(addDays(startIso, 6));
  if (a.m === b.m) return `${MONTHS_SHORT[a.m - 1]} ${a.d}–${b.d}, ${b.y}`;
  if (a.y === b.y) return `${MONTHS_SHORT[a.m - 1]} ${a.d} – ${MONTHS_SHORT[b.m - 1]} ${b.d}, ${b.y}`;
  return `${MONTHS_SHORT[a.m - 1]} ${a.d}, ${a.y} – ${MONTHS_SHORT[b.m - 1]} ${b.d}, ${b.y}`;
}

export function dayTitle(iso) {
  const t = parseISO(iso);
  if (!t) return '';
  return `${WEEKDAYS[weekdayOf(iso)]}, ${MONTHS_SHORT[t.m - 1]} ${t.d}, ${t.y}`;
}

// Compact hour-row label: '9 AM' / '12 PM' / '12 AM'.
export function hourLabel(h) {
  const hh = ((h % 24) + 24) % 24;
  const base = hh % 12 === 0 ? 12 : hh % 12;
  return `${base} ${hh < 12 ? 'AM' : 'PM'}`;
}

// '9 AM' / '9:15 AM' — hourLabel with an optional minute.
export function timeLabel(h, m = 0) {
  const hh = ((h % 24) + 24) % 24;
  const base = hh % 12 === 0 ? 12 : hh % 12;
  return m ? `${base}:${pad2(m)} ${hh < 12 ? 'AM' : 'PM'}` : hourLabel(hh);
}

// 'Jul 15' — compact date for chips / synthesized schedule rows.
export function shortDate(iso) {
  const t = parseISO(iso);
  return t ? `${MONTHS_SHORT[t.m - 1]} ${t.d}` : String(iso || '');
}

export function hourTitle(iso, h) {
  const t = parseISO(iso);
  if (!t) return '';
  return `${MONTHS_SHORT[t.m - 1]} ${t.d} · ${hourLabel(h)}`;
}
