// The rundown — a day as an ordered list of items with DURATIONS.
//
// What this replaces: a column of fixed hour buckets, 8am to 6pm, where an item
// was "filed under 9 AM" and that was all a day could say. No durations, no end
// times, no order within an hour. So it could not express "shoot 14A, 2h15",
// and it could not answer the only question anyone asks on a running day —
// rehearsal went 25 minutes long, what time is everything now?
//
// The model is the one broadcast and live-event production settled on decades
// ago (Rundown Studio, Shoflo, Cuez, Ontime all agree): each item carries a
// duration and start times CASCADE from the item above. An item may be PINNED
// to a wall-clock time — crew call, the union meal break, a permit window —
// which anchors the chain and produces a visible gap or overlap when the plan
// does not fit around it. Change one duration and the whole day re-times.
//
// It also happens to be the shape of a call sheet's schedule section: a
// chronological running order, not a time grid.
//
// KEYS. A third sibling in the grammar in schedLayout.js:
//   d:2026-09-08              day slot     (month cell)
//   d:2026-09-08/i:<uid>      loose item   (month grid — untouched)
//   d:2026-09-08/r:<uid>      RUNDOWN item (here)
//
// The record is a standard grid cell record plus four fields, so CellContent
// and the whole existing cell pipeline render a row — including a row whose
// record is a BOARD, which is how a setup's cluster hangs off its own item.

import { parseClock, formatClock, pad2 } from './schedDates.js';
import { between, sequence } from './fracIndex.js';

// Not-work is the other three things on a call sheet, and the industry already
// names them: meal breaks, company moves, and banner notes.
export const RUNDOWN_KINDS = Object.freeze(['item', 'break', 'move', 'note']);

export const RUNDOWN_TUNING = Object.freeze({
  DEFAULT_START: '08:00',   // when a day says nothing about when it begins
  DEFAULT_DUR: 30,          // minutes, for a new row and for a converted legacy item
  MIN_DUR: 0,               // a zero-length row is legal: a marker, a banner
  MAX_DUR: 1440,
  SNAP: 5,                  // minutes; duration entry rounds to this
});

const R_RE = /^d:(\d{4}-\d{2}-\d{2})\/r:([^/]+)$/;
const LEGACY_RE = /^d:(\d{4}-\d{2}-\d{2})\/h:(\d{2})(?:\/m:(\d{2}))?\/i:([^/]+)$/;
const LOOSE_RE = /^d:(\d{4}-\d{2}-\d{2})\/i:([^/]+)$/;

export function rundownKey(dateIso, uid) { return `d:${dateIso}/r:${uid}`; }
export function isRundownKey(key) { return R_RE.test(key || ''); }
export function parseRundownKey(key) {
  const m = R_RE.exec(key || '');
  return m ? { date: m[1], uid: m[2] } : null;
}

// ── clock arithmetic ────────────────────────────────────────────────────────
// Minutes from midnight of the day the rundown STARTS on, so a night shoot that
// calls at 18:00 and wraps at 04:00 is 1080 → 1680 rather than wrapping round
// to a smaller number and reading as time travel.

export function toMinutes(clock) {
  const t = parseClock(clock);
  return t ? t.h * 60 + t.m : null;
}

// 'HH:MM' back out, with the day it lands on. 1680 → { clock: '04:00', day: 1 }.
export function fromMinutes(mins) {
  const m = Math.round(mins);
  const day = Math.floor(m / 1440);
  const within = ((m % 1440) + 1440) % 1440;
  return { clock: `${pad2(Math.floor(within / 60))}:${pad2(within % 60)}`, day };
}

// A pin is a time of DAY, so on an overnight day it has to be resolved to the
// occurrence at or after the day's start: with a call at 18:00, a lunch pinned
// to 02:00 means 02:00 tomorrow, not fourteen hours ago.
function resolvePin(clock, dayStartMin) {
  const base = toMinutes(clock);
  if (base === null) return null;
  let at = base;
  while (at < dayStartMin) at += 1440;
  return at;
}

const clampDur = (d) => {
  const n = Number(d);
  if (!Number.isFinite(n)) return RUNDOWN_TUNING.DEFAULT_DUR;
  return Math.max(RUNDOWN_TUNING.MIN_DUR, Math.min(RUNDOWN_TUNING.MAX_DUR, Math.round(n)));
};

// '2:15' / '2h15' / '135' / '45m' → minutes. What someone types into the
// duration field, which is a text input because a number spinner for 2h15 is
// a hostile way to enter two hours and fifteen minutes.
export function parseDuration(input) {
  const s = String(input == null ? '' : input).trim().toLowerCase();
  if (!s) return null;
  let m = /^(\d+):([0-5]?\d)$/.exec(s);                       // 2:15
  if (m) return +m[1] * 60 + +m[2];
  m = /^(\d+)\s*h(?:\s*(\d+)\s*m?)?$/.exec(s);                // 2h / 2h15 / 2h 15m
  if (m) return +m[1] * 60 + (m[2] ? +m[2] : 0);
  m = /^(\d+)\s*m$/.exec(s);                                  // 45m
  if (m) return +m[1];
  m = /^(\d+)$/.exec(s);                                      // bare number = minutes
  if (m) return +m[1];
  return null;
}

// 135 → '2:15'. Durations read as h:mm, never as '135 min' — every rundown tool
// and every AD writes them this way.
export function formatDuration(mins) {
  const n = Math.max(0, Math.round(Number(mins) || 0));
  return `${Math.floor(n / 60)}:${pad2(n % 60)}`;
}

// ── the cascade ─────────────────────────────────────────────────────────────
//
// One walk down the list carrying a clock. Everything the surface shows —
// every start time, the estimated wrap, the over/under, the gap and overlap
// warnings — comes out of here, so none of it can drift from the data.
//
//   items        [{ key, ord, dur, pin, kind, untimed, ...cellRecord }]
//   dayStart     'HH:MM' — boards.day_start for a dated cluster (0247)
//   plannedWrap  'HH:MM' — what the day was budgeted to end at
//
// Returns rows in display order plus the day's totals. `over` is null when
// there is nothing to compare against, NOT zero — "on time" and "no target"
// are different answers and a call sheet should not confuse them.
export function computeRundown(items, { dayStart = null, plannedWrap = null } = {}) {
  const all = (items || []).filter(Boolean);
  // Untimed rows (a note pinned to the day rather than to a moment) sit above
  // the clock and never consume it — the all-day band's job, without a slot.
  const untimed = all.filter((it) => it.untimed).sort(byOrder);
  const timed = all.filter((it) => !it.untimed).sort(byOrder);

  // Where the clock starts: the day's own start time, else the first pin, else
  // the default. Deriving it from the first pin is what makes a converted
  // legacy day open at the right hour with nothing configured.
  const firstPin = timed.find((it) => toMinutes(it.pin) !== null);
  const startMin = toMinutes(dayStart)
    ?? (firstPin ? toMinutes(firstPin.pin) : null)
    ?? toMinutes(RUNDOWN_TUNING.DEFAULT_START);

  let clock = startMin;
  const rows = [];
  timed.forEach((it, i) => {
    const dur = clampDur(it.dur);
    const pinAt = it.pin ? resolvePin(it.pin, startMin) : null;
    let gapBefore = 0, overlapBefore = 0;
    if (pinAt !== null) {
      // A hard start holds. What moves is the report of what it cost: dead air
      // in front of it, or the previous item running straight through it.
      if (i > 0) {
        if (clock < pinAt) gapBefore = pinAt - clock;
        else if (clock > pinAt) overlapBefore = clock - pinAt;
      }
      clock = pinAt;
    }
    const start = clock;
    clock += dur;
    rows.push({
      ...it,
      dur,
      pinned: pinAt !== null,
      startMin: start,
      endMin: clock,
      start: fromMinutes(start).clock,
      end: fromMinutes(clock).clock,
      startsNextDay: fromMinutes(start).day > 0,
      gapBefore,
      overlapBefore,
    });
  });

  const plannedMin = plannedWrap ? resolvePin(plannedWrap, startMin) : null;
  return {
    untimed,
    rows,
    startMin,
    start: fromMinutes(startMin).clock,
    wrapMin: clock,
    wrap: fromMinutes(clock).clock,
    wrapsNextDay: fromMinutes(clock).day > 0,
    total: clock - startMin,
    plannedWrap: plannedMin === null ? null : fromMinutes(plannedMin).clock,
    over: plannedMin === null ? null : clock - plannedMin,
  };
}

function byOrder(a, b) {
  const x = a.ord || '', y = b.ord || '';
  if (x !== y) return x < y ? -1 : 1;
  return String(a.key) < String(b.key) ? -1 : 1;   // deterministic tiebreak
}

// ── reading a day out of the cell map ───────────────────────────────────────
//
// Merges real rundown items with whatever the old hour-bucket model left
// behind. CONVERSION HAPPENS ON READ, not by migration: an item at 09:00 shows
// as a row pinned to 09:00, the old key stays exactly where it is, and an
// older client still renders it. Nothing can be lost by a conversion that
// turns out to be wrong, because nothing was rewritten.
//
// Returns { items, legacyKeys }. legacyKeys is what materialize() will
// rewrite the first time someone edits the day.
export function rundownFromCells(cells, dateIso) {
  const real = [];
  const legacy = [];
  const loose = [];
  for (const key in (cells || {})) {
    const rec = cells[key];
    if (!rec || !rec.type || rec.type === 'empty') continue;
    if (rec.type === 'image' && !rec.src) continue;

    const r = R_RE.exec(key);
    if (r && r[1] === dateIso) {
      real.push({ ...rec, key, ord: rec.ord || '', dur: clampDur(rec.dur) });
      continue;
    }
    const l = LEGACY_RE.exec(key);
    if (l && l[1] === dateIso) {
      legacy.push({
        ...rec, key,
        legacy: true,
        // Pinned, because 09:00 is exactly what the old key asserted. Nothing
        // is guessed here beyond the duration.
        pin: `${l[2]}:${l[3] || '00'}`,
        dur: clampDur(rec.dur ?? RUNDOWN_TUNING.DEFAULT_DUR),
        sortAt: (+l[2]) * 60 + (+(l[3] || 0)),
      });
      continue;
    }
    const o = LOOSE_RE.exec(key);
    if (o && o[1] === dateIso) {
      // Attached to the day, not to a moment. Shown above the clock rather than
      // dropped, or a day someone built last week opens looking half-empty.
      loose.push({ ...rec, key, legacy: true, untimed: true, dur: 0, ord: rec.ord || '' });
    }
  }

  // Untimed rows need order keys too — they sort among themselves, and
  // materialize() persists them, so leaving them blank would write a record
  // with no position in it.
  loose.sort((a, b) => (a.key < b.key ? -1 : 1));
  const looseOrds = sequence(loose.length);
  loose.forEach((x, i) => { if (!x.ord) x.ord = looseOrds[i]; });

  legacy.sort((a, b) => a.sortAt - b.sortAt || (a.key < b.key ? -1 : 1));
  // Legacy rows get synthetic order keys from their clock time. When the day
  // has never been edited this IS the whole rundown and the result is exactly
  // chronological. In the brief mixed state after a first edit, real rows sort
  // by their own keys and these interleave by value — stable, and resolved for
  // good the moment materialize() runs.
  const ords = sequence(legacy.length);
  legacy.forEach((it, i) => { it.ord = ords[i]; });

  return {
    items: [...loose, ...legacy, ...real],
    legacyKeys: [...legacy, ...loose].map((it) => it.key),
    hasLegacy: legacy.length > 0 || loose.length > 0,
  };
}

// The one-time rewrite, as a pure plan the caller applies in a single
// transaction: real keys to write, old keys to delete. Called on the first edit
// to a converted day, so the mixed state cannot persist.
export function materializeLegacy(cells, dateIso, mintUid) {
  const { items, legacyKeys } = rundownFromCells(cells, dateIso);
  const writes = {};
  items.filter((it) => it.legacy).forEach((it) => {
    const { key, legacy, sortAt, ...rec } = it;
    writes[rundownKey(dateIso, mintUid())] = rec;
  });
  return { writes, deletes: legacyKeys };
}

// ── editing ────────────────────────────────────────────────────────────────

// The order key for a row dropped at `index` in the current display order.
// Pass the rows computeRundown returned, which are already sorted.
export function ordForIndex(rows, index) {
  const list = rows || [];
  const i = Math.max(0, Math.min(list.length, Math.round(index)));
  const lo = i > 0 ? list[i - 1]?.ord : null;
  const hi = i < list.length ? list[i]?.ord : null;
  return between(lo || null, hi || null);
}

// Moving row `from` to position `to` in the display order. Returns the new ord,
// or null when the move is a no-op — so a caller can skip the transaction and
// avoid an undo entry for a drag that went nowhere.
export function ordForMove(rows, from, to) {
  const list = rows || [];
  if (from < 0 || from >= list.length) return null;
  if (to === from || to === from + 1) return null;
  const without = list.filter((_, i) => i !== from);
  const at = to > from ? to - 1 : to;
  return ordForIndex(without, at);
}
