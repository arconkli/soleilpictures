// Shoot-day planning — pure. No Supabase, no Yjs, no React.
//
// Split out of productionDay.js for the same reason schedDates/schedLayout are
// split out of schedState: the orchestration side imports supabase.js, which
// reads import.meta.env and cannot be loaded by `node --test`. Arithmetic that
// decides how many clusters get created deserves a test, so it lives here.

import { addDays, weekdayOf, todayISO } from './schedDates.js';

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
export function shootDayCards(dayLabel) {
  const t = Date.now();
  return [
    // Hour-by-hour. anchorMode:'board' means it reads its date from the cluster
    // it lives on, so moving the day re-anchors this with nothing to cascade.
    {
      id: `sched-${t}`, kind: 'schedule', schedView: 'day',
      anchorMode: 'board', anchorHour: 7,
      x: 40, y: 40, w: 300, h: 460,
    },
    { id: `doc-${t + 1}`, kind: 'doc', title: 'Call sheet', x: 372, y: 40, w: 360, h: 460 },
    { id: `grid-${t + 2}`, kind: 'grid', x: 764, y: 40, w: 360, h: 300 },
    {
      id: `note-${t + 3}`, kind: 'note', sectionHeader: true, span: 'full',
      sub: 'Drop the day’s pages here',
      html: '<div>Script pages</div>', body: 'Script pages',
      x: 764, y: 372, w: 360, h: 128,
    },
  ];
}
// Convenience for "start a production block today".
export function defaultShootRange(fromIso = todayISO(), weeks = 4) {
  return { from: fromIso, to: addDays(fromIso, weeks * 7 - 1) };
}
