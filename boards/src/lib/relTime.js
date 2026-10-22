// How long ago a message was sent: "just now", "5m ago", "3h ago", "2d ago",
// then the date. Pure; <RelTime> keeps it moving on lib/minuteTick.js.
export function formatRelTime(iso, now = Date.now()) {
  if (!iso) return '';
  const d = new Date(iso);
  const sec = Math.floor((now - d.getTime()) / 1000);
  if (!Number.isFinite(sec)) return '';
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
