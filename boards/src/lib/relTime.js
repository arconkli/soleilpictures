// How long ago a message was sent: "just now", "5m ago", "3h ago", "2d ago",
// then the date. Pure; <RelTime> keeps it moving on lib/minuteTick.js.
//
// English is written out here and is byte for byte what it always was. Any
// other language comes from Intl (lib/intlFormat.js), which knows its words
// and its order.
import { uiLocale } from './uiLocale.js';
import { formatDate, formatLocale, formatRelative } from './intlFormat.js';

const ago = (n, unit) => formatRelative(-n, unit, { numeric: 'always', style: 'narrow' });

export function formatRelTime(iso, now = Date.now()) {
  if (!iso) return '';
  const d = new Date(iso);
  const sec = Math.floor((now - d.getTime()) / 1000);
  if (!Number.isFinite(sec)) return '';
  const en = uiLocale() === 'en';
  if (sec < 60) return en ? 'just now' : formatRelative(0, 'second', { numeric: 'auto', style: 'narrow' }).toLocaleLowerCase(formatLocale());
  if (sec < 3600) return en ? `${Math.floor(sec / 60)}m ago` : ago(Math.floor(sec / 60), 'minute');
  if (sec < 86400) return en ? `${Math.floor(sec / 3600)}h ago` : ago(Math.floor(sec / 3600), 'hour');
  if (sec < 604800) return en ? `${Math.floor(sec / 86400)}d ago` : ago(Math.floor(sec / 86400), 'day');
  const opts = { month: 'short', day: 'numeric' };
  return en ? d.toLocaleDateString(undefined, opts) : formatDate(d, opts);
}
