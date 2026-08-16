// Pure layout + slot-key engine for the Schedule card (kind:'schedule' with a
// `schedView`) — the calendar sibling of lib/gridLayout.js. No React, no Yjs.
//
// SLOT KEY GRAMMAR — keys in the card's nested `gridCells` map are ITEMS; the
// slots themselves store no record:
//   day slot      d:2026-07-15
//   hour slot     d:2026-07-15/h:09
//   minute slot   d:2026-07-15/h:09/m:15     (m ∈ 00/15/30/45 at MINUTE_STEP 15)
//   item          <slotPath>/i:<uid>         (value = ONE standard grid cell record)
// Zero-padded segments make plain string sort chronological, so "every item
// under this slot" (a collapsed day aggregating its hour items) is a sorted
// prefix scan.
//
// Breakdown state ("day 15 shows hour rows inline") lives OUTSIDE this module
// in the card's gridMeta: expand = { '<slotPath>': 'hours' | 'minutes' }.
//
// computeSchedSlots() lays the BODY box (below the card's own header) out as a
// FLAT slot list — an expanded day emits its day slot (whole cell; the visible
// remainder is the date strip) plus hour rows positioned inside it, painted
// after so elementsFromPoint hits the row first. Rows can get arbitrarily
// small: inline they read as glanceable stripes, and the Day/Hour Peek
// (SchedulePeek.jsx) — which feeds this SAME engine a generous height — is
// how you actually work in them.

import {
  pad2, parseISO, formatISO, todayISO, daysInMonth, firstWeekdayOfMonth,
  startOfWeek, addDays, addMonths, monthTitle, hourLabel, timeLabel, shortDate,
  weekdayOf, WEEKDAYS,
} from './schedDates.js';

export const SCHED_TUNING = Object.freeze({
  HEADER_H: 44,       // in-card header (nav/title/view pill) — component subtracts it before calling computeSchedSlots; CSS mirror: .schedc-head flex-basis
  WEEKDAY_H: 22,      // Mon–Sun strip (month/week)
  DAY_LABEL_H: 22,    // date-number strip inside a day cell (month/week); CSS mirror: .schedc-slot-label line-height
  BAND_H: 28,         // the "All day" / whole-hour drop band (day/hour views)
  // ZERO. The old lattice painted the body in --line-1 and let 1px of it show
  // between opaque tiles — but --line-1 is LIGHTER than the tile fill, so the
  // grid read as inset tiles on light mortar (spreadsheet grammar), and in
  // light theme --bg-2 #ededf0 against --line-1 #ececef is 1.009:1, i.e. the
  // grid did not render at all. Cells now tile flush and transparent, and the
  // only rule is a border-top per slot — a continuous horizontal week
  // separator with no vertical rules, which is the month-view convention.
  GUTTER_PX: 0,
  INNER_GUTTER_PX: 0, // nested hour rows separate the same way
  CHIP_H: 22,         // CSS mirror: .schedc-chip flex-basis/line-height
  CHIP_GAP: 3,
  DAY_HOUR_FROM: 8,   // default visible hour window [FROM, TO)
  DAY_HOUR_TO: 18,
  MINUTE_STEP: 15,
  // ── The day rail ───────────────────────────────────────────────────────────
  // The card is two panes: a calendar that answers "what is the shape of this
  // schedule" and a rail that answers "what is actually happening". A month
  // grid is very good at the first question and structurally incapable of the
  // second — a day cell is ~90px wide, which is a day number and a dot, not a
  // call time and a location. Splitting them is what lets the grid go back to
  // being a grid.
  RAIL_W: 288,        // CSS mirror: .schedc-rail width
  RAIL_MIN_W: 620,    // card narrower than this → no side rail
  RAIL_MIN_H: 260,    // …or shorter than this (a week bar stays a week bar)
  RAIL_ROW_H: 56,     // two lines at a 44pt-safe target; CSS mirror: .schedc-dayrow
  RAIL_HEAD_H: 26,    // the sticky "September" / "Today" section label
  PEEK_W: 400,        // Day/Hour Peek panel (SchedulePeek.jsx) OUTER width.
  // What the slot engine is fed. The panel is border-box, so the usable row
  // width is PEEK_W − 2 (border) − 12 (body padding). Feeding it PEEK_W laid
  // every row out 14px wider than its container and `overflow:hidden` amputated
  // the right edge and radius of all of them.
  PEEK_CONTENT_W: 386,
  // Row heights are bounded by a real constraint: the DEFAULT hour window is
  // 8→18, so ten rows plus the head, the band and the body padding have to fit
  // inside a panel capped at 80% of the viewport. 48 + 12 + 28 + 10*54 = 628,
  // which clears PEEK_MAX_H below — so the panel no longer scrolls by a hair
  // and permanently masks the bottom of the last row to hide the overflow.
  PEEK_ROW_H: 54,
  PEEK_MINUTE_ROW_H: 64,
  PEEK_MAX_H: 640,
  // 24, not 28: two chips must still fit one hour row (h >= 2*chip + 5), and
  // 28px chips would have shown one item per hour with everything else behind
  // a "+N more". Legibility of the row beats the size of a secondary target.
  ROW_CHIP_H: 24,     // CSS mirror: .schedc-peekcontent/.is-view-day chip flex-basis
  LOD_NUM_PX: 13,     // LOD counter-scale TARGETS in *screen* px (layout px = target / canvasScale,
  LOD_DOT_PX: 4,      // clamped to the cell): MID date number, item dot, count badge,
  LOD_COUNT_PX: 10,   // and the FAR poster title. Tuned via the screenshot pass.
  LOD_TITLE_PX: 13,
  // Real negative space now that the body isn't painted in a line colour — it
  // used to render as a 10px slab of --line-1 that read as damage.
  MONTH_GAP_PX: 20,
  MONTH_CAPTION_H: 24, // per-block "August 2026" caption (CSS mirror: .schedc-mcap)
  DAYTILE_H: 24,      // a dated child cluster's tile inside a day cell (CSS mirror: .schedc-daytile)
  // Below DAYTILE_COMPACT_W a tile has no room for a word and renders as a bar
  // (CSS mirror: .schedc-daytile.is-compact) — 64px is where "Day 14" stops
  // fitting and starts being "Day…".
  DAYTILE_COMPACT_W: 64,
  DAYTILE_COMPACT_H: 12,
});

// ---------------------------------------------------------------------------
// Two panes
//
// Split the card body into the calendar box and the day rail. Pure, so the
// component, the thumbnail and the tests all agree on where the seam is.
//
// The rail only earns its space when there is space: below RAIL_MIN_W the
// calendar would be squeezed past legibility to make room for it, and a week
// card (420x170 by design) has no vertical room for rows at all. In those cases
// the card is calendar-only and the rail's job falls back to the peek — which
// is exactly the pre-rework behaviour, so nothing is lost by being small.
//
// `view` matters: day and hour views are already a list of rows, so a rail
// beside them would be two lists of the same thing.
//
// `months` matters more than it looks. A 3-month strip divides the CALENDAR
// PANE three ways, so taking 288px for a rail costs each month 96 — enough to
// push a perfectly readable strip below the LOD mid threshold and turn the
// whole card into a density map. So the pane has to clear that threshold per
// block, not in total, or the rail wins its space by making the calendar
// useless. Three months plus a rail genuinely needs a wide card.
export function splitSchedPanes({ view, w, h, months = 1, rail = true }) {
  const full = { x: 0, y: 0, w: Math.max(0, w), h: Math.max(0, h) };
  const railable = rail && (view === 'month' || view === 'week');
  if (!railable
      || full.w < SCHED_TUNING.RAIL_MIN_W
      || full.h < SCHED_TUNING.RAIL_MIN_H) {
    return { calRect: full, railRect: null };
  }
  const calW = full.w - SCHED_TUNING.RAIL_W;
  if (view === 'month' && months > 1) {
    const { cols } = monthGrid(months, calW, full.h);
    if (calW / cols < SCHED_LOD.month.midW) return { calRect: full, railRect: null };
  }
  return {
    calRect:  { x: 0, y: 0, w: calW, h: full.h },
    railRect: { x: calW, y: 0, w: SCHED_TUNING.RAIL_W, h: full.h },
  };
}

// The card size a month span actually needs, so that asking for three months
// gives you three readable months rather than a density map.
//
// This exists because the two constraints multiply: a 3-month strip divides the
// calendar pane three ways AND the pane is already 288px narrower than the
// card. At the default 920 that leaves each month 210px against a 330 mid
// threshold, so clicking "3" on a default card silently demoted the whole thing
// to dots — on the one view a production calendar exists for.
export function schedSizeForMonths(months, cur = {}) {
  const n = Math.max(1, Math.min(12, Math.round(months) || 1));
  const w0 = Math.max(0, cur.w || 0), h0 = Math.max(0, cur.h || 0);
  if (n === 1) return { w: Math.max(w0, 920), h: Math.max(h0, 580) };
  // Lay the blocks out in the pane we would get at a generous width, then
  // demand midW per column and midH per row — the same numbers schedLodTier
  // will judge it by, so the result is full-tier by construction.
  const { cols, rows } = monthGrid(n, 1200, 560);
  const calW = SCHED_LOD.month.midW * cols + SCHED_TUNING.MONTH_GAP_PX * (cols - 1);
  const bodyH = SCHED_LOD.month.midH * rows
    + (SCHED_TUNING.MONTH_CAPTION_H + SCHED_TUNING.WEEKDAY_H) * rows
    + SCHED_TUNING.MONTH_GAP_PX * (rows - 1);
  return {
    w: Math.max(w0, Math.round(calW + SCHED_TUNING.RAIL_W)),
    h: Math.max(h0, Math.round(bodyH + SCHED_TUNING.HEADER_H)),
  };
}

// ---------------------------------------------------------------------------
// Multi-month strip
//
// Principal photography is months long, so a production calendar wants the
// whole block visible at once rather than a month you have to page through.
// `months` tiles N month grids inside one card; every slot key stays a plain
// `d:YYYY-MM-DD`, so items, drops, expand state and the peek all work unchanged.

// How to arrange N month blocks in a w×h box. Tries every column count and
// keeps the one that yields the largest day cell, tie-breaking toward fewer
// rows so a wide card reads as a strip rather than a squat block. Pure and
// exported so the layout, the LOD tier and the tests all agree on one answer.
export function monthGrid(months, w, h) {
  const n = Math.max(1, Math.min(12, Math.round(months) || 1));
  if (n === 1) return { cols: 1, rows: 1 };
  const G = SCHED_TUNING.MONTH_GAP_PX;
  const chromeH = SCHED_TUNING.MONTH_CAPTION_H + SCHED_TUNING.WEEKDAY_H;
  let best = { cols: n, rows: 1, score: -Infinity };
  for (let cols = 1; cols <= n; cols++) {
    // Only EXACT arrangements. A ragged last row — three months in a 2x2 with
    // an empty quadrant — reads as a broken layout however big it makes the
    // cells, so 3 is a strip or a stack and never an L.
    if (n % cols !== 0) continue;
    const rows = n / cols;
    const blockW = (w - G * (cols - 1)) / cols;
    const blockH = (h - G * (rows - 1)) / rows;
    // Six week-rows is the worst case for any month.
    const cellW = (blockW - SCHED_TUNING.GUTTER_PX * 6) / 7;
    const cellH = (blockH - chromeH - SCHED_TUNING.GUTTER_PX * 5) / 6;
    const score = Math.min(cellW, cellH);
    if (score > best.score + 0.01 || (Math.abs(score - best.score) <= 0.01 && rows < best.rows)) {
      best = { cols, rows, score };
    }
  }
  return { cols: best.cols, rows: best.rows };
}

// ---------------------------------------------------------------------------
// LOD — how much detail the card can honestly render at its ON-SCREEN size
// (layout px × settled canvas scale). Per-view thresholds: a week card is
// 420×170 by design and must not demote at zoom 1 on a month-shaped H bar.
// 'full' = today's render · 'mid' = density map (big date numbers + dots) ·
// 'far' = poster (big title + dot lattice). Strict < demotes; edges stay up.

export const SCHED_LOD = Object.freeze({
  month: Object.freeze({ midW: 330, midH: 240, farW: 150, farH: 120 }),
  week:  Object.freeze({ midW: 330, midH: 96,  farW: 150, farH: 56  }),
  day:   Object.freeze({ midW: 210, midH: 250, farW: 120, farH: 120 }),
  hour:  Object.freeze({ midW: 200, midH: 180, farW: 120, farH: 100 }),
});

export function schedLodTier({ view, w, h, scale = 1, months = 1 }) {
  const t = SCHED_LOD[view] || SCHED_LOD.month;
  let sw = w * scale, sh = h * scale;
  // A 3-month strip at a month card's size gives each block a third of the
  // width, so the thresholds have to be read against ONE BLOCK. Measuring the
  // whole card would report 'full' while every cell was ~20px and unreadable.
  if (view === 'month' && months > 1) {
    const { cols, rows } = monthGrid(months, w, h);
    sw /= cols;
    sh /= rows;
  }
  if (sw < t.farW || sh < t.farH) return 'far';
  if (sw < t.midW || sh < t.midH) return 'mid';
  return 'full';
}

// Valid items per date (any depth) — the LOD dot/count source. Same validity
// rules as schedItems: tombstones and src-less images don't count.
export function schedDayCounts(cells) {
  const out = {};
  for (const k in cells || {}) {
    if (!isItemKey(k)) continue;
    const rec = cells[k];
    if (!rec || !rec.type || rec.type === 'empty') continue;
    if (rec.type === 'image' && !rec.src) continue;
    const slot = parseSlotKey(slotOfItem(k));
    if (!slot) continue;
    out[slot.date] = (out[slot.date] || 0) + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Key grammar

export function dayKey(iso) { return `d:${iso}`; }
export function hourKey(iso, h) { return `d:${iso}/h:${pad2(h)}`; }
export function minuteKey(iso, h, m) { return `d:${iso}/h:${pad2(h)}/m:${pad2(m)}`; }

const ITEM_RE = /\/i:[^/]+$/;
export function isItemKey(key) { return typeof key === 'string' && ITEM_RE.test(key); }
// An item key → its slot path; a slot path passes through unchanged.
export function slotOfItem(key) { return isItemKey(key) ? key.replace(ITEM_RE, '') : key; }
export function mintItemKey(slotPath, uid) { return `${slotPath}/i:${uid}`; }
export function newUid() { return Math.random().toString(36).slice(2, 9); }

export function parseSlotKey(key) {
  if (typeof key !== 'string' || isItemKey(key)) return null;
  const m = /^d:(\d{4}-\d{2}-\d{2})(?:\/h:(\d{2})(?:\/m:(\d{2}))?)?$/.exec(key);
  if (!m || !parseISO(m[1])) return null;
  const date = m[1];
  if (m[3] != null) {
    const hour = +m[2], minute = +m[3];
    if (hour > 23 || minute > 59) return null;
    return { kind: 'minute', date, hour, minute };
  }
  if (m[2] != null) {
    const hour = +m[2];
    if (hour > 23) return null;
    return { kind: 'hour', date, hour };
  }
  return { kind: 'day', date };
}

// Item keys belonging to a slot, chronological. deep=false → direct items only
// (`<slot>/i:*`); deep=true → every item anywhere under the slot (`<slot>/…`) —
// what a COLLAPSED slot aggregates so collapsing is visibly non-destructive.
export function itemsForSlot(slotPath, cellKeys, { deep = false } = {}) {
  const direct = `${slotPath}/i:`;
  const under = `${slotPath}/`;
  const out = [];
  for (const k of cellKeys || []) {
    if (!isItemKey(k)) continue;
    if (deep ? k.startsWith(under) : k.startsWith(direct)) out.push(k);
  }
  out.sort();
  return out;
}

// ---------------------------------------------------------------------------
// Hour window

// Visible hour rows for a broken-down day: the default working window, widened
// to include any hour that holds content (at any depth) or is itself expanded —
// a grafted 22:00 item must never be hidden.
export function hourWindowForDay(dateIso, cellKeys = [], expand = {}) {
  let from = SCHED_TUNING.DAY_HOUR_FROM, to = SCHED_TUNING.DAY_HOUR_TO;
  const prefix = `d:${dateIso}/h:`;
  const widen = (k) => {
    if (!k.startsWith(prefix)) return;
    const h = Number(k.slice(prefix.length, prefix.length + 2));
    if (!Number.isFinite(h) || h < 0 || h > 23) return;
    if (h < from) from = h;
    if (h + 1 > to) to = h + 1;
  };
  for (const k of cellKeys) widen(k);
  for (const k in expand) widen(k);
  return { from, to };
}

// ---------------------------------------------------------------------------
// Layout

function pushMinuteRows(slots, area, dateIso, h, gutter) {
  const n = Math.max(1, Math.floor(60 / SCHED_TUNING.MINUTE_STEP));
  const rowH = Math.max(0, (area.h - gutter * (n - 1)) / n);
  for (let i = 0; i < n; i++) {
    const m = i * SCHED_TUNING.MINUTE_STEP;
    slots.push({
      key: minuteKey(dateIso, h, m), kind: 'minute',
      rect: { x: area.x, y: area.y + i * (rowH + gutter), w: area.w, h: rowH },
      date: dateIso, hour: h, minute: m, label: `:${pad2(m)}`, expanded: null,
    });
  }
}

function pushHourRows(slots, area, dateIso, win, expand, gutter) {
  const rows = Math.max(1, win.to - win.from);
  const rowH = Math.max(0, (area.h - gutter * (rows - 1)) / rows);
  for (let i = 0; i < rows; i++) {
    const h = win.from + i;
    const hk = hourKey(dateIso, h);
    const rect = { x: area.x, y: area.y + i * (rowH + gutter), w: area.w, h: rowH };
    const expanded = expand[hk] === 'minutes' ? 'minutes' : null;
    slots.push({ key: hk, kind: 'hour', rect, date: dateIso, hour: h, label: hourLabel(h), expanded });
    if (expanded) pushMinuteRows(slots, rect, dateIso, h, gutter);
  }
}

// One month's day cells inside `rect`, for the multi-month strip. Unlike the
// single-month grid this emits ONLY days belonging to this month: across a
// strip, a leading/trailing day would collide with the same date's real cell in
// the neighbouring block, and two slots sharing a `d:` key would break
// data-cell-id hit-testing and drop routing.
function pushMonthBlock(slots, rules, { monthIso, rect, nRows, expand, cellKeys, todayIso }) {
  const G = SCHED_TUNING.GUTTER_PX;
  const t = parseISO(monthIso);
  const first = startOfWeek(formatISO(t.y, t.m, 1));
  const cw = (rect.w - G * 6) / 7;
  const ch = (rect.h - G * (nRows - 1)) / nRows;
  for (let r = 0; r < nRows; r++) {
    rules.push({ x: rect.x, y: rect.y + r * (ch + G), w: rect.w });
  }
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < 7; c++) {
      const date = addDays(first, r * 7 + c);
      const dt = parseISO(date);
      if (dt.m !== t.m || dt.y !== t.y) continue;      // no duplicate dates across blocks
      const key = dayKey(date);
      const cell = { x: rect.x + c * (cw + G), y: rect.y + r * (ch + G), w: cw, h: ch };
      const expanded = expand[key] === 'hours' ? 'hours' : null;
      slots.push({
        key, kind: 'day', rect: cell, date,
        outside: false, isToday: date === todayIso, weekend: c >= 5,
        label: String(dt.d), expanded,
      });
      if (expanded) {
        const inner = {
          x: cell.x, y: cell.y + SCHED_TUNING.DAY_LABEL_H,
          w: cell.w, h: Math.max(0, cell.h - SCHED_TUNING.DAY_LABEL_H),
        };
        pushHourRows(slots, inner, date, hourWindowForDay(date, cellKeys, expand), expand,
          SCHED_TUNING.INNER_GUTTER_PX);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The day rail's contents
//
// What period the card is showing, as an inclusive [from, to] of real dates.
// Month view means whole calendar months (not the padded week grid) — the rail
// lists September when the header says September, and a trailing Oct 1 in the
// bottom-right cell of the grid is grid padding, not part of the month.
export function schedVisibleRange({ view, anchor, months = 1, todayIso = todayISO() }) {
  const t = parseISO(anchor) || parseISO(todayIso);
  if (view === 'week') {
    const from = startOfWeek(formatISO(t.y, t.m, t.d));
    return { from, to: addDays(from, 6) };
  }
  if (view === 'day' || view === 'hour') {
    const d = formatISO(t.y, t.m, t.d);
    return { from: d, to: d };
  }
  const n = Math.max(1, Math.min(12, Math.round(months) || 1));
  const from = formatISO(t.y, t.m, 1);
  const lastIso = parseISO(addMonths(from, n - 1));
  return { from, to: formatISO(lastIso.y, lastIso.m, daysInMonth(lastIso.y, lastIso.m)) };
}

// One row per date that has anything on it — a dated cluster, loose Yjs items,
// or today. Dates with nothing are omitted on purpose: a rail padded out with
// sixty empty rows is a scrollbar, not a schedule, and the calendar pane beside
// it already shows the empty days.
//
// Today always gets a row even when empty, because "nothing is scheduled today"
// is an answer someone opened the card to get.
export function schedDayRows({
  from, to, shootDays = {}, dayCounts = {}, todayIso = todayISO(),
}) {
  if (!parseISO(from) || !parseISO(to) || to < from) return [];
  const rows = [];
  let d = from;
  // The bound matches daysBetween's: twelve months is ~366 rows, and a
  // mis-entered range must not spin.
  for (let i = 0; i < 400 && d <= to; i++) {
    const days = shootDays[d] || [];
    const loose = dayCounts[d] || 0;
    if (days.length || loose > 0 || d === todayIso) {
      rows.push({
        date: d,
        days,                       // dated child clusters, already date-sorted
        loose,                      // count of ad-hoc Yjs items on this date
        isToday: d === todayIso,
        weekend: weekdayOf(d) >= 5,
      });
    }
    if (d === to) break;
    d = addDays(d, 1);
  }
  return rows;
}

// The next dated cluster at or after `fromIso`, across the WHOLE production
// rather than the visible range — "what's next" must not go blank because you
// happen to be looking at last month. Cancelled days are skipped: they are kept
// on the calendar as a record, but they are not what happens next.
export function schedNextDay(shootDays, fromIso) {
  let best = null;
  for (const date in shootDays || {}) {
    if (date < fromIso) continue;
    for (const b of shootDays[date]) {
      if (b?.sched_status === 'cancelled') continue;
      if (!best || date < best.date) best = { date, board: b };
    }
  }
  return best;
}

// Slot rects for the body box (0,0 → w,h). Flat list; nested rows are emitted
// AFTER their containing day/hour slot so they paint (and hit-test) on top.
export function computeSchedSlots({
  view, anchor, anchorHour = 9, w, h, expand = {}, cellKeys = [], todayIso = todayISO(),
  months = 1,
}) {
  const slots = [];
  // Full-width horizontal week separators. Emitted as geometry rather than a
  // border on each slot so they don't go ragged where a month starts or ends
  // mid-week (the strip omits out-of-month days).
  const weekRules = [];
  const G = SCHED_TUNING.GUTTER_PX;
  const t = parseISO(anchor) || parseISO(todayIso);
  const safeAnchor = formatISO(t.y, t.m, t.d);

  // Multi-month strip. Deliberately a separate branch: the single-month path
  // below is load-bearing for every existing schedule card and stays untouched.
  const nMonths = Math.max(1, Math.min(12, Math.round(months) || 1));
  if (view === 'month' && nMonths > 1) {
    const { cols, rows } = monthGrid(nMonths, w, h);
    const MG = SCHED_TUNING.MONTH_GAP_PX;
    const chromeH = SCHED_TUNING.MONTH_CAPTION_H + SCHED_TUNING.WEEKDAY_H;
    const blockW = (w - MG * (cols - 1)) / cols;
    const blockH = (h - MG * (rows - 1)) / rows;

    const monthIsos = [];
    for (let i = 0; i < nMonths; i++) monthIsos.push(addMonths(formatISO(t.y, t.m, 1), i));
    // One shared week-row count so the blocks line up across the strip; a
    // per-month count would stagger the lattice and read as broken.
    const nRows = monthIsos.reduce((mx, iso) => {
      const m = parseISO(iso);
      return Math.max(mx, Math.ceil((firstWeekdayOfMonth(m.y, m.m) + daysInMonth(m.y, m.m)) / 7));
    }, 4);

    const monthBlocks = monthIsos.map((iso, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const bx = c * (blockW + MG), by = r * (blockH + MG);
      const gridRect = {
        x: bx, y: by + chromeH, w: blockW, h: Math.max(0, blockH - chromeH),
      };
      pushMonthBlock(slots, weekRules, { monthIso: iso, rect: gridRect, nRows, expand, cellKeys, todayIso });
      return {
        iso, label: monthTitle(iso),
        captionRect: { x: bx, y: by, w: blockW, h: SCHED_TUNING.MONTH_CAPTION_H },
        weekdayRect: { x: bx, y: by + SCHED_TUNING.MONTH_CAPTION_H, w: blockW, h: SCHED_TUNING.WEEKDAY_H },
        gridRect,
      };
    });

    return { slots, weekRules, weekdayLabels: null, monthBlocks };
  }

  if (view === 'month' || view === 'week') {
    const body = { x: 0, y: SCHED_TUNING.WEEKDAY_H, w, h: Math.max(0, h - SCHED_TUNING.WEEKDAY_H) };
    let first, nRows;
    if (view === 'month') {
      first = startOfWeek(formatISO(t.y, t.m, 1));
      nRows = Math.ceil((firstWeekdayOfMonth(t.y, t.m) + daysInMonth(t.y, t.m)) / 7);
    } else {
      first = startOfWeek(safeAnchor);
      nRows = 1;
    }
    const cw = (body.w - G * 6) / 7;
    const ch = (body.h - G * (nRows - 1)) / nRows;
    for (let r = 0; r < nRows; r++) {
      weekRules.push({ x: 0, y: body.y + r * (ch + G), w: body.w });
    }
    for (let r = 0; r < nRows; r++) {
      for (let c = 0; c < 7; c++) {
        const date = addDays(first, r * 7 + c);
        const dt = parseISO(date);
        const key = dayKey(date);
        const rect = { x: c * (cw + G), y: body.y + r * (ch + G), w: cw, h: ch };
        const expanded = expand[key] === 'hours' ? 'hours' : null;
        slots.push({
          key, kind: 'day', rect, date,
          outside: view === 'month' && dt.m !== t.m,
          isToday: date === todayIso,
          weekend: c >= 5, // Monday-first columns → 5/6 are Sat/Sun
          label: String(dt.d),
          expanded,
        });
        if (expanded) {
          const inner = { x: rect.x, y: rect.y + SCHED_TUNING.DAY_LABEL_H, w: rect.w, h: Math.max(0, rect.h - SCHED_TUNING.DAY_LABEL_H) };
          pushHourRows(slots, inner, date, hourWindowForDay(date, cellKeys, expand), expand, SCHED_TUNING.INNER_GUTTER_PX);
        }
      }
    }
    return { slots, weekRules, weekdayLabels: WEEKDAYS.slice(), monthBlocks: null };
  }

  if (view === 'day') {
    // "All day" band = the day slot itself (direct day items live here; the
    // hours below make it behave like an expanded day).
    slots.push({
      key: dayKey(safeAnchor), kind: 'day', band: true,
      rect: { x: 0, y: 0, w, h: SCHED_TUNING.BAND_H },
      date: safeAnchor, outside: false, isToday: safeAnchor === todayIso,
      label: 'All day', expanded: 'hours',
    });
    const area = { x: 0, y: SCHED_TUNING.BAND_H + G, w, h: Math.max(0, h - SCHED_TUNING.BAND_H - G) };
    pushHourRows(slots, area, safeAnchor, hourWindowForDay(safeAnchor, cellKeys, expand), expand, G);
    return { slots, weekRules, weekdayLabels: null, monthBlocks: null };
  }

  // view === 'hour' — whole-hour band + minute rows.
  const hh = Math.min(23, Math.max(0, Math.round(Number(anchorHour) || 0)));
  slots.push({
    key: hourKey(safeAnchor, hh), kind: 'hour', band: true,
    rect: { x: 0, y: 0, w, h: SCHED_TUNING.BAND_H },
    date: safeAnchor, hour: hh, label: hourLabel(hh), expanded: 'minutes',
  });
  const area = { x: 0, y: SCHED_TUNING.BAND_H + G, w, h: Math.max(0, h - SCHED_TUNING.BAND_H - G) };
  pushMinuteRows(slots, area, safeAnchor, hh, G);
  return { slots, weekRules, weekdayLabels: null, monthBlocks: null };
}

// How many item chips fit in a slot rect (stacked vertically); the component
// renders the overflow as a "+N more" drill-in chip. chipH is opt-in so
// day/hour rows can use the taller ROW_CHIP_H without touching day-cell math.
export function chipCapacity(rect, kind = 'day', { chipH = SCHED_TUNING.CHIP_H } = {}) {
  const labelH = kind === 'day' ? SCHED_TUNING.DAY_LABEL_H : 0;
  const usable = rect.h - labelH - 2;
  if (usable < chipH) return 0;
  return Math.floor((usable + SCHED_TUNING.CHIP_GAP) / (chipH + SCHED_TUNING.CHIP_GAP));
}

// ---------------------------------------------------------------------------
// Summary reads (thumbnails / list previews / search / public pages)

function itemTitle(rec) {
  if (!rec) return '';
  if (rec.type === 'text') return String(rec.html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim().slice(0, 140);
  if (rec.type === 'link') return rec.title || rec.source || rec.link || 'Link';
  if (rec.type === 'board') return rec.name || 'Cluster';
  if (rec.type === 'file') return rec.fileName || 'File';
  if (rec.type === 'image') return rec.title || 'Image';
  if (rec.type === 'video') return 'Video';
  return '';
}

// Flatten a schedule card's cells map into chronological display items — the
// shared summary read behind thumbnails, list previews, search indexing, and
// the public-page meta. Each: { key, date, hour?, minute?, type, title }.
export function schedItems(cells, { max = Infinity } = {}) {
  const out = [];
  for (const k of Object.keys(cells || {}).sort()) {
    if (!isItemKey(k)) continue;
    const rec = cells[k];
    if (!rec || !rec.type || rec.type === 'empty') continue;
    if (rec.type === 'image' && !rec.src) continue;
    const slot = parseSlotKey(slotOfItem(k));
    if (!slot) continue;
    out.push({ key: k, date: slot.date, hour: slot.hour ?? null, minute: slot.minute ?? null, type: rec.type, title: itemTitle(rec) });
    if (out.length >= max) break;
  }
  return out;
}

// Items → the legacy schedule row shape {day, what, loc}, so every renderer
// that already knows the rows table (list marks, public /c articles) shows a
// meaningful summary of a new-model card with zero changes.
export function schedLegacyRows(items) {
  return (items || []).map((it) => ({
    day: shortDate(it.date),
    what: it.title || it.type,
    loc: it.hour == null ? '' : timeLabel(it.hour, it.minute || 0),
  }));
}

// ---------------------------------------------------------------------------
// Move (pure)
//
// The calendar's central missing verb. Until now an item's date could only be
// changed by deleting it and making a new one, because the date lives IN the
// key — so a move is a re-key, not a field write.

// One item to another slot. The uid is preserved so the item keeps its identity
// across the move (undo, awareness, in-flight uploads all key off it); only the
// slot prefix changes. Returns null when the move is a no-op or the input isn't
// an item key, so callers can skip the transaction entirely.
export function reslotItemKey(itemKey, dstSlotPath) {
  if (!isItemKey(itemKey) || !dstSlotPath) return null;
  if (!parseSlotKey(dstSlotPath)) return null;
  const uid = itemKey.slice(itemKey.lastIndexOf('/i:') + 3);
  const next = mintItemKey(dstSlotPath, uid);
  return next === itemKey ? null : next;
}

// A whole slot's contents to another slot — "move this shoot day's items to
// Thursday", including anything broken out into hour/minute rows beneath it.
// graftKeyMap already does exactly this prefix rewrite for the cross-card
// graft, so this is that same rewrite pointed at one card, plus the list of
// source keys the caller must delete to make it a move rather than a copy.
export function moveSlotSubtree(cells = {}, expand = {}, srcSlotPath, dstSlotPath) {
  if (!srcSlotPath || !dstSlotPath || srcSlotPath === dstSlotPath) {
    return { cells: {}, expand: {}, removeKeys: [], removeExpand: [] };
  }
  const under = `${srcSlotPath}/`;
  const moved = {};
  const removeKeys = [];
  for (const k in cells) {
    if (!k.startsWith(under)) continue;
    moved[dstSlotPath + k.slice(srcSlotPath.length)] = cells[k];
    removeKeys.push(k);
  }
  const movedExpand = {};
  const removeExpand = [];
  for (const k in expand) {
    if (!expand[k]) continue;
    if (k === srcSlotPath) { movedExpand[dstSlotPath] = expand[k]; removeExpand.push(k); }
    else if (k.startsWith(under)) {
      movedExpand[dstSlotPath + k.slice(srcSlotPath.length)] = expand[k];
      removeExpand.push(k);
    }
  }
  return { cells: moved, expand: movedExpand, removeKeys, removeExpand };
}

// ---------------------------------------------------------------------------
// Graft (pure; shared by BOTH shells' graftScheduleIntoSlot mutators)

// Rewrite a source schedule card's cells/expand onto a host slot. srcPrefix is
// the slot path the source card's anchor addresses (`d:<anchor>` for a day
// card, `d:<anchor>/h:<HH>` for an hour card); dstSlotPath is the host slot
// receiving the graft. Deeper structure (hours/minutes) carries across with
// the prefix swapped. Cell keys NOT under srcPrefix come back as `strays` —
// the caller MUST refuse the graft (deleting the source would orphan them).
// Off-prefix expand flags are merely cosmetic and are dropped.
export function graftKeyMap(srcCells = {}, srcExpand = {}, srcPrefix, dstSlotPath) {
  const cells = {}, expand = {}, strays = [];
  const under = `${srcPrefix}/`;
  for (const k in srcCells) {
    if (k.startsWith(under)) cells[dstSlotPath + k.slice(srcPrefix.length)] = srcCells[k];
    else strays.push(k);
  }
  for (const k in srcExpand) {
    if (!srcExpand[k]) continue;
    if (k === srcPrefix) expand[dstSlotPath] = srcExpand[k];
    else if (k.startsWith(under)) expand[dstSlotPath + k.slice(srcPrefix.length)] = srcExpand[k];
  }
  return { cells, expand, strays };
}
