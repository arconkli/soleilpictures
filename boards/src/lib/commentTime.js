// How a comment's time and a conversation's summary read, the same words
// on the canvas, in docs and notes and on shared files. Pure: no clock but
// the one passed in. Only the comment parts read these, so they arrive with
// them (components/comments/commentPartsLazy.jsx) and not with the app.
//
// English is written out here, in the house order (day then month), and is
// what it always was. Any other language comes from Intl (lib/intlFormat.js),
// which knows its words and its order, as lib/relativeTime.js does.
import { t, plural } from '@lingui/core/macro';
import { uiLocale } from './uiLocale.js';
import { formatDate, formatLocale, formatRelative, formatUnit } from './intlFormat.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function capitalizeFirst(s) {
  return s.charAt(0).toLocaleUpperCase(formatLocale()) + s.slice(1);
}

// A comment's time, the same words on the canvas, in docs and notes and on
// shared files: "now", "5m", "2h" while it's today (or under six hours ago,
// across midnight), "Yesterday", a weekday within the week ("Mon"), then the
// date day first ("12 Nov"), with the year when it isn't this one's
// ("12 Nov 2025"). By the calendar, in the reader's time zone. `midLine` is
// for words that follow others on a line ("Resolved by Dev · yesterday",
// "2 replies · yesterday"): the day word is lower case there.
export function commentTimeWords(input, now = Date.now(), { midLine = false } = {}) {
  if (input == null || input === '') return '';
  const then = typeof input === 'string' ? Date.parse(input) : +input;
  if (!Number.isFinite(then)) return '';
  const en = uiLocale() === 'en';
  const min = Math.floor((now - then) / 60000);
  if (min < 1) return en ? 'now' : formatRelative(0, 'second', { numeric: 'auto', style: 'narrow' });
  if (min < 60) return en ? `${min}m` : formatUnit(min, 'minute');
  const a = new Date(then);
  const b = new Date(now);
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(b) - day(a)) / 86400000);
  if (days <= 0 || min < 360) return en ? `${Math.floor(min / 60)}h` : formatUnit(Math.floor(min / 60), 'hour');
  if (days === 1) {
    if (en) return midLine ? 'yesterday' : 'Yesterday';
    const word = formatRelative(-1, 'day', { numeric: 'auto' });
    return midLine ? word : capitalizeFirst(word);
  }
  if (days < 7) return en ? WEEKDAYS[a.getDay()].slice(0, 3) : formatDate(a, { weekday: 'short' });
  const sameYear = a.getFullYear() === b.getFullYear();
  if (!en) return formatDate(a, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  const date = `${a.getDate()} ${MONTHS[a.getMonth()].slice(0, 3)}`;
  return sameYear ? date : `${date} ${a.getFullYear()}`;
}

// The whole date behind a comment's time, for its tooltip, short: "Sat 15
// Nov, 07:58", with the year when it isn't this one's ("Sat 15 Nov 2025,
// 07:58"). Day then month in the house order; the clock as the reader's
// locale writes it (two digits on a 24-hour clock, "7:58 AM" on a 12-hour).
// In another language the whole of it is as that language writes it.
export function commentFullDate(input, { locale, now = Date.now() } = {}) {
  if (input == null || input === '') return '';
  const then = typeof input === 'string' ? Date.parse(input) : +input;
  if (!Number.isFinite(then)) return '';
  const d = new Date(then);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  if (uiLocale() !== 'en') {
    return formatDate(d, {
      weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? null : { year: 'numeric' }),
      hour: 'numeric', minute: '2-digit',
    });
  }
  let clock;
  try {
    const half = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12;
    clock = new Intl.DateTimeFormat(locale, { hour: half ? 'numeric' : '2-digit', minute: '2-digit' }).format(d);
  } catch (_) {
    clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const year = sameYear ? '' : ` ${d.getFullYear()}`;
  return `${WEEKDAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${year}, ${clock}`;
}

// "2 replies · 12m": how many replies still stand, when the newest thing
// was written, and that time in the comment words as they read mid-line
// ("last yesterday"). A thread with no replies gives the root's own time.
export function threadSummary(thread, now = Date.now()) {
  if (!thread?.root) return { replies: 0, lastAt: null, lastWords: '' };
  const live = (thread.replies || []).filter((r) => !r.deleted);
  const times = [thread.root, ...live].map((r) => r.createdAt).filter((t0) => t0 != null);
  const lastAt = times.length ? Math.max(...times) : null;
  return { replies: live.length, lastAt, lastWords: lastAt == null ? '' : commentTimeWords(lastAt, now, { midLine: true }) };
}

// The summary as a line: "No replies yet", "1 reply · 2h". The count is one
// message and the time of the newest words stands after it on its own: a
// time put inside a sentence ("last 5 min") does not agree with it in most
// languages.
export function threadSummaryLine(thread, now = Date.now()) {
  const s = threadSummary(thread, now);
  if (!s.replies) return t`No replies yet`;
  const replies = s.replies;
  const count = plural(replies, { one: '# reply', other: '# replies' });
  return s.lastWords ? `${count} · ${s.lastWords}` : count;
}
