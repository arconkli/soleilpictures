// Compact relative-time formatter used in board card metadata. Returns
// short strings like "Just now", "5m", "3h", "2d", "1w", "Mar 12".
//
// Anything older than ~30 days falls back to a short calendar date.
//
// English is written out here and is byte for byte what it always was. Any
// other language comes from Intl (lib/intlFormat.js), which knows its words
// and its order.
import { uiLocale } from './uiLocale.js';
import { formatDate, formatLocale, formatRelative, formatUnit } from './intlFormat.js';

function capitalizeFirst(s) {
  const first = s.charAt(0);
  const up = first.toLocaleUpperCase(formatLocale());
  return up + s.slice(1);
}
const justNow = () => capitalizeFirst(formatRelative(0, 'second', { numeric: 'auto', style: 'narrow' }));
const ago = (n, unit) => formatRelative(-n, unit, { numeric: 'always', style: 'narrow' });

export function relativeTimeShort(input) {
  if (!input) return '';
  const then = typeof input === 'string' ? Date.parse(input) : +input;
  if (!Number.isFinite(then)) return '';
  const en = uiLocale() === 'en';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return en ? 'Just now' : justNow();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return en ? 'Just now' : justNow();
  const min = Math.floor(sec / 60);
  if (min < 60) return en ? `${min}m ago` : ago(min, 'minute');
  const hr = Math.floor(min / 60);
  if (hr < 24) return en ? `${hr}h ago` : ago(hr, 'hour');
  const day = Math.floor(hr / 24);
  if (day < 7) return en ? `${day}d ago` : ago(day, 'day');
  if (day < 30) return en ? `${Math.floor(day / 7)}w ago` : ago(Math.floor(day / 7), 'week');
  const d = new Date(then);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const opts = sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return en ? d.toLocaleDateString(undefined, opts) : formatDate(d, opts);
}

// Shorter still, for a comment's card: "Just now", "40m", "2h" while it's
// today (or under six hours ago, across midnight), "Yesterday", a weekday
// within the week ("Mon"), then a date ("Oct 12", with the year when it isn't
// this one's). By the calendar, in the reader's time zone, so "Yesterday"
// means yesterday.
// Which of relativeTimeCompact's forms an input gets: 'now' ("Just now"),
// 'minutes' ("40m"), 'hours' ("2h"), 'yesterday', 'weekday' ("Mon") or 'date'.
// '' for no time. A caller that needs to treat one form differently compares
// this, never the shown words (they change with the language).
export function relativeTimeKind(input, now = Date.now()) {
  return compactParts(input, now).kind;
}

function compactParts(input, now) {
  if (!input) return { kind: '' };
  const then = typeof input === 'string' ? Date.parse(input) : +input;
  if (!Number.isFinite(then)) return { kind: '' };
  const min = Math.floor((now - then) / 60000);
  if (min < 1) return { kind: 'now', then, min };
  if (min < 60) return { kind: 'minutes', then, min };
  const a = new Date(then);
  const b = new Date(now);
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(b) - day(a)) / 86400000);
  if (days <= 0 || min < 360) return { kind: 'hours', then, min, days };
  if (days === 1) return { kind: 'yesterday', then, min, days };
  if (days < 7) return { kind: 'weekday', then, min, days };
  return { kind: 'date', then, min, days };
}

export function relativeTimeCompact(input, now = Date.now()) {
  const { kind, then, min } = compactParts(input, now);
  if (!kind) return '';
  const en = uiLocale() === 'en';
  if (kind === 'now') return en ? 'Just now' : justNow();
  if (kind === 'minutes') return en ? `${min}m` : formatUnit(min, 'minute');
  if (kind === 'hours') return en ? `${Math.floor(min / 60)}h` : formatUnit(Math.floor(min / 60), 'hour');
  if (kind === 'yesterday') return en ? 'Yesterday' : capitalizeFirst(formatRelative(-1, 'day', { numeric: 'auto' }));
  const a = new Date(then);
  const b = new Date(now);
  const fmt = (opts) => (en ? a.toLocaleDateString(undefined, opts) : formatDate(a, opts));
  if (kind === 'weekday') return fmt({ weekday: 'short' });
  return fmt(a.getFullYear() === b.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}
