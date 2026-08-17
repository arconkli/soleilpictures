// Shoot-day planning — pure. No Supabase, no Yjs, no React.
//
// Split out of productionDay.js for the same reason schedDates/schedLayout are
// split out of schedState: the orchestration side imports supabase.js, which
// reads import.meta.env and cannot be loaded by `node --test`. Arithmetic that
// decides how many clusters get created deserves a test, so it lives here.

import { addDays, weekdayOf, todayISO } from './schedDates.js';
import { rundownKey, RUNDOWN_TUNING } from './rundown.js';
import { sequence } from './fracIndex.js';

// A bulk add is a planning gesture, not a data import. The ceiling is here so a
// fat-fingered end date can't mint a thousand clusters; the UI surfaces it.
export const MAX_SHOOT_DAYS_PER_ADD = 90;

// The dates a range covers, optionally skipping weekends — a six-day week is
// normal on a film, so "skip weekends" is an option and not a rule.
export function shootDayDates(fromIso, toIso, { skipWeekends = false } = {}) {
  const out = [];
  if (!fromIso || !toIso || toIso < fromIso) return out;
  let d = fromIso;
  for (let i = 0; i <= MAX_SHOOT_DAYS_PER_ADD && d <= toIso; i++) {
    // weekdayOf is Monday-first, so 5 and 6 are Saturday and Sunday.
    if (!skipWeekends || weekdayOf(d) < 5) out.push(d);
    if (out.length >= MAX_SHOOT_DAYS_PER_ADD) break;
    d = addDays(d, 1);
  }
  return out;
}
// "Day 1", "Day 2", … continuing past whatever is already on the calendar so a
// second bulk add doesn't restart the numbering.
export function nextDayNumber(existingBoards, parentId) {
  let max = 0;
  for (const id in existingBoards || {}) {
    const b = existingBoards[id];
    if (!b || b.parent_board_id !== parentId || !b.scheduled_date) continue;
    const m = /^\s*Day\s+(\d+)\s*$/i.exec(String(b.day_label || ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}
// The four things a crew opens a shoot day to find. Deliberately NOT seeded
// with board/boardlink cards — their ids point at the source workspace and a
// per-card doc store can't be cloned across boards (see showcaseClone.js).
// The skeleton every production day has, whatever the industry: it starts, it
// breaks in the middle, it ends. Seeding these three turns "set up this day"
// into something usable rather than an empty list — and because the middle one
// is PINNED, the day already demonstrates the one behaviour that matters: put
// work above it and watch the overrun get reported instead of silently eating
// the break.
//
// Deliberately three rows and not a template of a whole shoot day. Guessing
// someone's setups would be wrong more often than useful; guessing that a day
// has a start, a meal and an end is not.
export function shootDayRundown(dateIso, startClock = '07:00') {
  const ord = sequence(3);
  const start = /^\d{2}:\d{2}$/.test(startClock) ? startClock : '07:00';
  const [h, m] = start.split(':').map(Number);
  // Six hours after call, which is when the meal penalty clock runs out on a
  // union shoot. The same interval is a reasonable default anywhere else — a
  // day that runs six hours without a break is a bad day in any industry.
  const meal = `${String((h + 6) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return [
    { type: 'text', title: 'Crew call', kind: 'item', ord: ord[0], dur: 30, pin: start },
    { type: 'text', title: 'First setup', kind: 'item', ord: ord[1],
      dur: RUNDOWN_TUNING.DEFAULT_DUR * 4 },
    { type: 'text', title: 'Lunch', kind: 'break', ord: ord[2], dur: 60, pin: meal },
  ];
}

export function shootDayCards(dayLabel, dateIso = null) {
  const t = Date.now();
  // Rundown keys carry the date, so the seed can only be written when we know
  // it. Without a date the card is still created — it just opens empty, which
  // is what happens for a cluster that has not been dated yet.
  const cells = {};
  if (dateIso) {
    shootDayRundown(dateIso).forEach((row, i) => {
      cells[rundownKey(dateIso, `seed${i}`)] = row;
    });
  }
  return [
    // The day's running order. anchorMode:'board' means it reads its date from
    // the cluster it lives on, so moving the day re-anchors this with nothing
    // to cascade. Seeded with the skeleton — an empty rundown is a blank page,
    // and a blank page is what people close.
    {
      id: `sched-${t}`, kind: 'schedule', schedView: 'day',
      anchorMode: 'board', cells,
      x: 40, y: 40, w: 340, h: 460,
    },
    { id: `doc-${t + 1}`, kind: 'doc', title: 'Call sheet', x: 412, y: 40, w: 360, h: 460 },
    { id: `grid-${t + 2}`, kind: 'grid', x: 804, y: 40, w: 360, h: 300 },
    {
      id: `note-${t + 3}`, kind: 'note', sectionHeader: true, span: 'full',
      sub: 'Drop the day’s pages here',
      html: '<div>Script pages</div>', body: 'Script pages',
      x: 804, y: 372, w: 360, h: 128,
    },
  ];
}
// Convenience for "start a production block today".
export function defaultShootRange(fromIso = todayISO(), weeks = 4) {
  return { from: fromIso, to: addDays(fromIso, weeks * 7 - 1) };
}
