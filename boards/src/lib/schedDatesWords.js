// The Schedule card's date and time words, in the person's language.
//
// lib/schedDates.js keeps its fixed English (month, weekday and 12-hour
// clock names: deterministic for its other readers, lib/schedLayout.js's
// summary reads that feed search and public pages, and the tests). The app's
// readers use these instead. In English each one returns exactly what the
// shared function returns; in any other language it is Intl through
// lib/intlFormat.js, so the order, the names and the 12/24-hour clock are the
// language's own. A mirror in the S1 sense, kept honest by
// schedDatesWords.test.mjs. App-only: no macros needed for the names, but the
// one phrase ("until") is a message.
import { t } from '@lingui/core/macro';
import { uiLocale } from './uiLocale.js';
import { formatDate } from './intlFormat.js';
import * as en from './schedDates.js';

const isEn = () => uiLocale() === 'en';

// Local noon, as schedDates builds every Date (DST can't move the day).
const noon = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const at = (iso) => {
  const p = en.parseISO(iso);
  return p ? noon(p.y, p.m, p.d) : null;
};

// Twelve month names, January first.
export function monthNames() {
  return isEn() ? en.MONTHS : Array.from({ length: 12 }, (_, i) => formatDate(noon(2024, i + 1, 15), { month: 'long' }));
}
export function monthShortNames() {
  return isEn() ? en.MONTHS_SHORT : Array.from({ length: 12 }, (_, i) => formatDate(noon(2024, i + 1, 15), { month: 'short' }));
}
// Seven short weekday names, Monday first (2024-01-01 was a Monday).
export function weekdayShortNames() {
  return isEn() ? en.WEEKDAYS : Array.from({ length: 7 }, (_, i) => formatDate(noon(2024, 1, 1 + i), { weekday: 'short' }));
}

export function monthTitle(iso) {
  const d = !isEn() && at(iso);
  return d ? formatDate(d, { month: 'long', year: 'numeric' }) : en.monthTitle(iso);
}

export function weekTitle(iso) {
  if (isEn()) return en.weekTitle(iso);
  const startIso = en.startOfWeek(iso);
  const a = at(startIso);
  const b = at(en.addDays(startIso, 6));
  if (!a || !b) return en.weekTitle(iso);
  const same = a.getFullYear() === b.getFullYear();
  return `${formatDate(a, same ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })} – ${formatDate(b, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

export function dayTitle(iso) {
  const d = !isEn() && at(iso);
  return d ? formatDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : en.dayTitle(iso);
}

// '9 AM' in English; the language's own hour otherwise.
export function hourLabel(h) {
  if (isEn()) return en.hourLabel(h);
  const hh = ((h % 24) + 24) % 24;
  return formatDate(noon(2024, 1, 1, hh), { hour: 'numeric' });
}

export function timeLabel(h, m = 0) {
  if (isEn()) return en.timeLabel(h, m);
  if (!m) return hourLabel(h);
  const hh = ((h % 24) + 24) % 24;
  return formatDate(noon(2024, 1, 1, hh, m), { hour: 'numeric', minute: '2-digit' });
}

// 'HH:MM:SS' → '7:00 AM' in English; '' for anything unparseable.
export function clockLabel(s) {
  if (isEn()) return en.clockLabel(s);
  const c = en.parseClock(s);
  return c ? formatDate(noon(2024, 1, 1, c.h, c.m), { hour: 'numeric', minute: '2-digit' }) : '';
}

export function clockRange(start, end) {
  if (isEn()) return en.clockRange(start, end);
  const a = clockLabel(start), b = clockLabel(end);
  if (!a) return b ? t`until ${b}` : '';
  return b ? `${a} – ${b}` : a;
}

// 'Jul 15'
export function shortDate(iso) {
  const d = !isEn() && at(iso);
  return d ? formatDate(d, { month: 'short', day: 'numeric' }) : en.shortDate(iso);
}

// 'Jun 1–7' or 'Jun 29 – Jul 5': a tiles week's heading, the same text
// schedCalendar's calWeeks labels carry (its own stays English for the tests).
export function weekRange(fromIso, toIso) {
  const x = en.parseISO(fromIso), y = en.parseISO(toIso);
  if (!x || !y) return '';
  if (isEn()) {
    return x.m === y.m
      ? `${en.MONTHS_SHORT[x.m - 1]} ${x.d}–${y.d}`
      : `${en.MONTHS_SHORT[x.m - 1]} ${x.d} – ${en.MONTHS_SHORT[y.m - 1]} ${y.d}`;
  }
  return `${shortDate(fromIso)} – ${shortDate(toIso)}`;
}

export function hourTitle(iso, h) {
  if (isEn() || !at(iso)) return en.hourTitle(iso, h);
  return `${shortDate(iso)} · ${hourLabel(h)}`;
}
