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
  startOfWeek, addDays, hourLabel, timeLabel, shortDate, WEEKDAYS,
} from './schedDates.js';

export const SCHED_TUNING = Object.freeze({
  HEADER_H: 32,       // in-card header (nav/title/view pill) — component subtracts it before calling computeSchedSlots; CSS mirror: .schedc-head flex-basis
  WEEKDAY_H: 16,      // Mon–Sun strip (month/week)
  DAY_LABEL_H: 14,    // date-number strip inside a day cell (month/week); CSS mirror: .schedc-slot-label line-height
  BAND_H: 22,         // the "All day" / whole-hour drop band (day/hour views)
  HOUR_LABEL_W: 44,   // time gutter painted inside hour/minute rows (day/hour views); CSS mirror: the left:44px gutter rules
  GUTTER_PX: 1,       // spacing between top-level slots — 1px so the body bg reads as a hairline lattice
  INNER_GUTTER_PX: 1, // spacing between rows nested inside a day cell
  CHIP_H: 18,         // CSS mirror: .schedc-chip flex-basis/line-height
  CHIP_GAP: 2,
  DAY_HOUR_FROM: 8,   // default visible hour window [FROM, TO)
  DAY_HOUR_TO: 18,
  MINUTE_STEP: 15,
  COMPACT_W: 90,      // below either → slot gets the pop-out menu trigger (local px,
  COMPACT_H: 40,      // zoom-independent — same reasoning as GRID_TUNING.PILL_MIN_*)
  PEEK_W: 380,        // Day/Hour Peek panel (SchedulePeek.jsx): width, per-row
  PEEK_ROW_H: 44,     // heights (hour rows / minute rows) and max panel height —
  PEEK_MINUTE_ROW_H: 56, // the panel feeds computeSchedSlots a GENEROUS height so
  PEEK_MAX_H: 560,    // rows come out big; overflow scrolls natively.
});

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

// Slot rects for the body box (0,0 → w,h). Flat list; nested rows are emitted
// AFTER their containing day/hour slot so they paint (and hit-test) on top.
export function computeSchedSlots({
  view, anchor, anchorHour = 9, w, h, expand = {}, cellKeys = [], todayIso = todayISO(),
}) {
  const slots = [];
  const G = SCHED_TUNING.GUTTER_PX;
  const t = parseISO(anchor) || parseISO(todayIso);
  const safeAnchor = formatISO(t.y, t.m, t.d);

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
    return { slots, weekdayLabels: WEEKDAYS.slice() };
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
    return { slots, weekdayLabels: null };
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
  return { slots, weekdayLabels: null };
}

// How many item chips fit in a slot rect (stacked vertically); the component
// renders the overflow as a "+N more" drill-in chip.
export function chipCapacity(rect, kind = 'day') {
  const labelH = kind === 'day' ? SCHED_TUNING.DAY_LABEL_H : 0;
  const usable = rect.h - labelH - 2;
  if (usable < SCHED_TUNING.CHIP_H) return 0;
  return Math.floor((usable + SCHED_TUNING.CHIP_GAP) / (SCHED_TUNING.CHIP_H + SCHED_TUNING.CHIP_GAP));
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
