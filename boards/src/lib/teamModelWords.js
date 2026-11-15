// teamModelWords — the words for the Team page's model (teamModel.js), read
// through Lingui. App only: teamModel.js is also read by the Worker's crawlable
// /pricing, so it keeps the rules, the ids and the numbers, and the sentences
// live here. Nothing outside the app reads these words.
//
// `ROLE_LABEL` is a table of getters, never a plain object: a message read at
// module load would freeze the language it loaded in.

import { t as tr, plural } from '@lingui/core/macro';
import { uiLocale } from './uiLocale.js';
import { formatDate, dollarsText, sizeText, formatList, namesList } from './intlFormat.js';
import { money as englishMoney, sizeLabel as englishSizeLabel, seatPrice, proratedToday, seatsFree, TEAM_SEAT_PRICE } from './teamModel.js';

// The app's money() and sizeLabel(): English exactly as teamModel.js writes it,
// and the same amount written the reader's way in other languages (fr "25 $US",
// "1,5 To"). teamModel.js stays a leaf in English: the public pricing pages load it.
export function money(n) {
  const cents = Math.round(n * 100);
  return dollarsText(englishMoney(n), cents / 100, cents % 100 === 0 ? 0 : 2);
}
export function sizeLabel(bytes) {
  const english = englishSizeLabel(bytes); // "100 GB", "1.5 TB"
  const [shown, unit] = english.split(' ');
  return sizeText(english, Number(shown), unit === 'TB' ? 'terabyte' : 'gigabyte', (shown.split('.')[1] || '').length);
}

export const ROLE_LABEL = {
  get owner() { return tr`Owner`; },
  get admin() { return tr({ message: 'Admin', context: 'role' }); },
  get member() { return tr`Member`; },
  get guest() { return tr`Guest`; },
  get viewer() { return tr`Viewer`; },
};

export function whereLabel(p) {
  return p.everywhere ? tr`Everywhere` : (uiLocale() === 'en' ? p.where.join(', ') : formatList(p.where, { type: 'conjunction', style: 'narrow' }));
}

// Where "ago" lands: a kind and a count, so each phrase is one whole message.
function agoKind(at, now) {
  const mins = (now - at) / 60000;
  if (mins < 60) return { kind: 'min', n: Math.max(1, Math.round(mins)) };
  const hours = Math.round(mins / 60);
  if (hours < 6) return { kind: 'hour', n: hours };
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const start = midnight.getTime();
  if (at >= start) return { kind: 'today', n: 0 };
  if (at >= start - 864e5) return { kind: 'yesterday', n: 0 };
  const days = Math.floor((start - at) / 864e5) + 1;
  if (days < 7) return { kind: 'day', n: days };
  if (days < 14) return { kind: 'lastweek', n: 0 };
  if (days < 60) return { kind: 'week', n: Math.floor(days / 7) };
  return { kind: 'awhile', n: 0 };
}

function agoLabel({ kind, n }) {
  switch (kind) {
    case 'min': return tr`${n} min ago`;
    case 'hour': return tr`${plural(n, { one: '# hour ago', other: '# hours ago' })}`;
    case 'today': return tr`Today`;
    case 'yesterday': return tr`Yesterday`;
    case 'day': return tr`${plural(n, { one: '# day ago', other: '# days ago' })}`;
    case 'lastweek': return tr`Last week`;
    case 'week': return tr`${plural(n, { one: '# week ago', other: '# weeks ago' })}`;
    default: return tr`A while ago`;
  }
}

// "Sent 5 min ago", "Sent today": the invite's own sentence per kind.
function sentLabel({ kind, n }) {
  switch (kind) {
    case 'min': return tr`Sent ${n} min ago`;
    case 'hour': return tr`${plural(n, { one: 'Sent # hour ago', other: 'Sent # hours ago' })}`;
    case 'today': return tr`Sent today`;
    case 'yesterday': return tr`Sent yesterday`;
    case 'day': return tr`${plural(n, { one: 'Sent # day ago', other: 'Sent # days ago' })}`;
    case 'lastweek': return tr`Sent last week`;
    case 'week': return tr`${plural(n, { one: 'Sent # week ago', other: 'Sent # weeks ago' })}`;
    default: return tr`Sent a while ago`;
  }
}

export function lastHereLabel(p, now = Date.now()) {
  if (p.invited) return sentLabel(agoKind(p.invited.sentAt, now));
  if (p.online) return tr`Here now`;
  if (!p.lastSeenAt) return '';
  return agoLabel(agoKind(p.lastSeenAt, now));
}

// "Alex and Ben", "Alex, Ben and Mia": the owner and admins by first name,
// for the line a member reads under the list.
export function adminNames(team) {
  const names = team.admins.map((a) => a.name.split(' ')[0]);
  return namesList(names);
}

// The signed-in /pricing hero's Team sentence. teamModel.js keeps its English
// (the Worker's crawlable /pricing reads it); teamModelWords.test.mjs and
// teamModel.test.mjs hold the two together.
export function teamHeroLine(editorLimit) {
  const price = money(TEAM_SEAT_PRICE.month);
  return tr`Teams with more than ${editorLimit} people who edit pay ${price} a seat.`;
}

export function seatPriceLabel(plan) {
  const price = money(seatPrice(plan));
  const interval = plan.interval;
  if (interval === 'year') return tr`${price} a year`;
  if (interval === 'month') return tr`${price} a month`;
  return tr`${price} a ${interval}`;
}

export function seatAddLine(plan, n = 1, now = Date.now()) {
  const price = seatPriceLabel(plan);
  const today = money(proratedToday(plan, now) * n);
  return n === 1 ? tr`${price}, ${today} today` : tr`${price} each, ${today} today`;
}

// The line under a join request: a free seat is used first; only when none
// is left does approving buy one.
export function approveLine(team, now = Date.now()) {
  const free = seatsFree(team);
  if (free > 0) return tr`${plural(free, { one: 'Approving uses one of the # free seat.', other: 'Approving uses one of the # free seats.' })}`;
  const line = seatAddLine(team.plan, 1, now);
  return tr`Approving adds a seat: ${line}.`;
}

// "October 21, 2026" in English (kept on en-US, as teamModel's dateLabel is);
// the browser's own words in any other language.
export function dateLabel(ms) {
  const opts = { month: 'long', day: 'numeric', year: 'numeric' };
  return uiLocale() === 'en' ? new Date(ms).toLocaleDateString('en-US', opts) : formatDate(new Date(ms), opts);
}

// "October 21", the same way.
export function dayLabel(ms) {
  const opts = { month: 'long', day: 'numeric' };
  return uiLocale() === 'en' ? new Date(ms).toLocaleDateString('en-US', opts) : formatDate(new Date(ms), opts);
}
