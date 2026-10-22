// Compact relative-time formatter used in board card metadata. Returns
// short strings like "Just now", "5m", "3h", "2d", "1w", "Mar 12".
//
// Anything older than ~30 days falls back to a short calendar date.

export function relativeTimeShort(input) {
  if (!input) return '';
  const then = typeof input === 'string' ? Date.parse(input) : +input;
  if (!Number.isFinite(then)) return '';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'Just now';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  if (day < 30) return `${Math.floor(day / 7)}w ago`;
  const d = new Date(then);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

// Shorter still, for a comment's card: "Just now", "40m", "2h" while it's
// today (or under six hours ago, across midnight), "Yesterday", a weekday
// within the week ("Mon"), then a date ("Oct 12", with the year when it isn't
// this one's). By the calendar, in the reader's time zone, so "Yesterday"
// means yesterday.
export function relativeTimeCompact(input, now = Date.now()) {
  if (!input) return '';
  const then = typeof input === 'string' ? Date.parse(input) : +input;
  if (!Number.isFinite(then)) return '';
  const min = Math.floor((now - then) / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m`;
  const a = new Date(then);
  const b = new Date(now);
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(b) - day(a)) / 86400000);
  if (days <= 0 || min < 360) return `${Math.floor(min / 60)}h`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return a.toLocaleDateString(undefined, { weekday: 'short' });
  return a.toLocaleDateString(undefined, a.getFullYear() === b.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}
