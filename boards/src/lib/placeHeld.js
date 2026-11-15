// placeHeld.js — "Your place is held".
//
// Coming back to a cluster after a real break, the canvas shows the whole
// cluster, then glides to the card you last worked on, and a quiet slate beside
// the cluster's name reads "Day 3 · last worked Tuesday evening". Nobody asked
// the app to remember where they were; this is it remembering.
//
// The store is per device: one localStorage key per person (PLACE_HELD_KEY +
// uid) holding, per cluster, when it was last opened, when you last worked on it
// and the days you did. "Last worked" reads the person's OWN edit stamps on the
// cards (createdBy / updatedBy), so it stays true across devices; the store only
// fills in what the stamps can't, such as a card since deleted. This file is the
// pure logic, no React and no DOM, and node-testable; App.jsx and CanvasSurface.jsx
// own the listeners, the camera and the UI.
import { RESUME_GAP_MS } from './resumeSitting.js';
import { isSeedCard } from './firstValueTrigger.js';

export const PLACE_HELD_KEY = 'soleil.placeHeld:';
export const PLACE_HELD_MAX_BOARDS = 200;
export const PLACE_HELD_MAX_DAYS = 400;
export const PLACE_HELD_HOLD_MS = 650;   // the whole cluster shows this long before the glide
export const SLATE_LONG_MS = 4500;       // how long the slate stays before it quiets
export const WORK_STAMP_EVERY_MS = 60000; // at most one stored work stamp a minute
export const PLACE_SHARE = 0.45;         // the held card fills this much of the view

// Page-lifetime state. "Once per cluster per page" cannot live in a React ref:
// App keys its <Workspace> on the workspace id, so a switch remounts it and a ref
// would forget (see resumeSitting.js). Module scope lives as long as the page.
const held = new Set();
export function heldOnce(boardId) {
  if (!boardId || held.has(boardId)) return false;
  held.add(boardId);
  return true;
}
// A held open that never finished (the cluster was left mid-hold) gives its turn back.
export function releaseHeld(boardId) { held.delete(boardId); }
export function __resetPlaceHeldPage() { held.clear(); }

// --- time (local, never UTC, except dayDiff which only counts calendar days) ---

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n, w = 2) => String(n).padStart(w, '0');
const dayOf = (d) => `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function stampMs(v) {
  if (typeof v === 'string') return Date.parse(v);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return NaN;
}

function dateOf(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function localDay(ms) {
  const d = dateOf(ms);
  return d ? dayOf(d) : null;
}

// Midnight of the day the hours before 5am still belong to.
function effectiveDate(ms) {
  const d = dateOf(ms);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getHours() < 5 ? 1 : 0));
}

// 2am work is still "yesterday's" work.
export function effectiveDay(ms) {
  const d = effectiveDate(ms);
  return d ? dayOf(d) : null;
}

function dayUTC(s) {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return NaN;
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function dayDiff(a, b) {
  return Math.round((dayUTC(b) - dayUTC(a)) / 86400000);
}

export function partOf(ms) {
  const d = dateOf(ms);
  if (!d) return null;
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'late';
}

// --- the store: { v: 1, b: { [boardId]: { l, w, d, o } } } ---
//   l last opened, w last worked (ms), d days worked (YYYY-MM-DD, sorted),
//   o how many older days were dropped from d to keep it small.

export function emptyPlaceHeld() { return { v: 1, b: {} }; }

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function unionDays(a, b) {
  const ok = (x) => typeof x === 'string' && DAY_RE.test(x);
  return [...new Set([...(Array.isArray(a) ? a : []).filter(ok), ...(Array.isArray(b) ? b : []).filter(ok)])].sort();
}

function cleanEntry(e) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  return { l: num(e.l), w: num(e.w), d: unionDays(e.d, []), o: Number.isInteger(e.o) && e.o >= 0 ? e.o : 0 };
}

export function parsePlaceHeld(raw) {
  let j;
  try { j = JSON.parse(raw); } catch { return emptyPlaceHeld(); }
  if (!isObj(j) || j.v !== 1 || !isObj(j.b)) return emptyPlaceHeld();
  const b = Object.fromEntries(
    Object.entries(j.b).filter(([, e]) => isObj(e)).map(([id, e]) => [id, cleanEntry(e)]),
  );
  return { v: 1, b };
}

export function readPlaceHeld(storage, uid) {
  if (!storage || !uid) return emptyPlaceHeld();
  try { return parsePlaceHeld(storage.getItem(PLACE_HELD_KEY + uid)); } catch { return emptyPlaceHeld(); }
}

// Keep the clusters touched most recently.
export function prunePlaceHeld(state, max = PLACE_HELD_MAX_BOARDS) {
  const score = (e) => Math.max(e?.l || 0, e?.w || 0);
  const kept = Object.entries(state?.b || {}).sort((x, y) => score(y[1]) - score(x[1])).slice(0, max);
  return { v: 1, b: Object.fromEntries(kept) };
}

export function writePlaceHeld(storage, uid, state) {
  if (!storage || !uid) return false;
  try {
    storage.setItem(PLACE_HELD_KEY + uid, JSON.stringify(prunePlaceHeld(state)));
    return true;
  } catch { return false; }
}

export function entryOf(state, boardId) {
  const e = state?.b && Object.hasOwn(state.b, boardId) ? state.b[boardId] : null;
  return {
    l: Number.isFinite(e?.l) ? e.l : 0,
    w: Number.isFinite(e?.w) ? e.w : 0,
    d: Array.isArray(e?.d) ? [...e.d] : [],
    o: Number.isFinite(e?.o) ? e.o : 0,
  };
}

// Past the cap the oldest days go, and o remembers how many, so the count only
// ever goes up.
function capDays(e) {
  if (e.d.length <= PLACE_HELD_MAX_DAYS) return e;
  const drop = e.d.length - PLACE_HELD_MAX_DAYS;
  return { ...e, d: e.d.slice(drop), o: e.o + drop };
}

const put = (state, boardId, entry) => ({ v: 1, b: { ...state?.b, [boardId]: entry } });

export function withVisit(state, boardId, atMs) {
  if (!boardId || !Number.isFinite(atMs)) return state;
  return put(state, boardId, { ...entryOf(state, boardId), l: atMs });
}

export function withWork(state, boardId, atMs) {
  if (!boardId || !Number.isFinite(atMs)) return state;
  const e = entryOf(state, boardId);
  return put(state, boardId, capDays({ ...e, w: Math.max(e.w, atMs), d: unionDays(e.d, [localDay(atMs)]) }));
}

export function withDays(state, boardId, days) {
  if (!boardId) return state;
  const e = entryOf(state, boardId);
  return put(state, boardId, capDays({ ...e, d: unionDays(e.d, days) }));
}

// --- days of work on a cluster (the "Day N" count; it only ever counts up) ---

// Every day the cluster shows work on: the stored days plus any day a placed card
// was made or edited, by anyone. Today is not added here (dayNumber does that).
export function clusterDays({ entry, cards, boardCreatedAt, nowMs } = {}) {
  const stored = unionDays(entry?.d, []);
  // Older days were dropped into o; card stamps from before d's first day are
  // already counted there.
  const floor = entry?.o > 0 ? stored[0] : undefined;
  const days = new Set(stored);
  if (Array.isArray(cards)) {
    for (const c of cards) {
      if (!c || c.unplaced === true) continue;
      for (const v of [c.createdAt, c.updatedAt]) {
        const day = localDay(stampMs(v));
        if (day && !(floor && day < floor)) days.add(day);
      }
    }
  }
  const first = localDay(stampMs(boardCreatedAt));
  const last = localDay(nowMs);
  return [...days].filter((x) => (!first || x >= first) && (!last || x <= last)).sort();
}

export function dayNumber({ days, entry, nowMs } = {}) {
  const set = new Set(Array.isArray(days) ? days : []);
  const today = localDay(nowMs);
  if (today) set.add(today);
  return (entry?.o || 0) + set.size;
}

// --- my own last touch (someone else's edit to a card is not my work) ---

export function myTouchMs(card, uid) {
  if (!card || !uid) return -Infinity;
  let best = -Infinity;
  if (card.updatedBy === uid) { const t = stampMs(card.updatedAt); if (t > best) best = t; }
  if (card.createdBy === uid) { const t = stampMs(card.createdAt); if (t > best) best = t; }
  return best;
}

export function myLastTouch(cards, uid) {
  if (!uid || !Array.isArray(cards)) return null;
  let card = null;
  let at = -Infinity;
  for (const c of cards) {
    // An onboarding seed card carries my stamps but was never my work.
    if (!c || !c.id || c.unplaced === true || isSeedCard(c)) continue;
    const t = myTouchMs(c, uid);
    if (Number.isFinite(t) && t > at) { card = c; at = t; }
  }
  return card ? { card, at } : null;
}

export function lastWorkedAt({ cards, uid, storedW } = {}) {
  const t = myLastTouch(cards, uid)?.at;
  const s = Number.isFinite(storedW) && storedW > 0 ? storedW : -Infinity;
  const best = Math.max(Number.isFinite(t) ? t : -Infinity, s);
  return Number.isFinite(best) ? best : null;
}

// --- the slate's "last worked" words ---

// yesterday, or a weekday within the last week; the UI formats the weekday name
// from dayMs (local noon of that day) with Intl. Today, or a week or more ago,
// says nothing.
export function lastWorkedLabel({ atMs, nowMs } = {}) {
  const a = effectiveDate(atMs);
  const n = effectiveDate(nowMs);
  if (!a || !n) return null;
  const diff = dayDiff(dayOf(a), dayOf(n));
  if (!(diff >= 1 && diff <= 6)) return null;
  const dayMs = new Date(a.getFullYear(), a.getMonth(), a.getDate(), 12).getTime();
  return { when: diff === 1 ? 'yesterday' : 'weekday', part: partOf(atMs), dayMs };
}

export function lastWorkedBucket(label) {
  if (label?.when === 'yesterday') return 'yesterday';
  if (label?.when === 'weekday') return 'week';
  return null;
}

// What the slate reads for one cluster, from its stored entry and its cards: the
// days worked (for noteDays), the day number, and the last-worked words, or null
// when there are none to say (nothing of mine, today, or a week or more ago).
export function slateFor({ entry, cards, uid, boardCreatedAt, nowMs } = {}) {
  const days = clusterDays({ entry, cards, boardCreatedAt, nowMs });
  const n = dayNumber({ days, entry, nowMs });
  const atMs = lastWorkedAt({ cards, uid, storedW: entry?.w });
  return { days, n, label: atMs === null ? null : lastWorkedLabel({ atMs, nowMs }) };
}

// --- the device side: what App writes as you go ---

// localStorage can be missing or throw (a private window, blocked site data).
// Null means nothing is kept, and every writer below does nothing with it.
export function deviceStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

// The cluster was opened, or the page was left with it open.
export function noteVisit(storage, uid, boardId, nowMs) {
  if (!storage || !uid || !boardId || !Number.isFinite(nowMs)) return false;
  return writePlaceHeld(storage, uid, withVisit(readPlaceHeld(storage, uid), boardId, nowMs));
}

// Every card save stamps work, and a drag saves many a second. A stored stamp a
// minute is plenty for a day count and a last-worked time, so the throttle sits in
// memory and a skipped stamp reads and writes nothing. The first stamp of a new
// local day always goes through, so a day is never missed. The time is taken
// before the write, so a full disk is tried once a minute, not on every save.
const worked = new Map();
export function __resetPlaceHeldWrites() { worked.clear(); }

export function noteWork(storage, uid, boardId, nowMs) {
  if (!storage || !uid || !boardId || !Number.isFinite(nowMs)) return false;
  const key = `${uid}|${boardId}`;
  const last = worked.get(key);
  // The subtraction first: a drag saves many cards a second, and most calls end here.
  if (last !== undefined && nowMs - last < WORK_STAMP_EVERY_MS && localDay(last) === localDay(nowMs)) return false;
  worked.set(key, nowMs);
  return writePlaceHeld(storage, uid, withWork(readPlaceHeld(storage, uid), boardId, nowMs));
}

// Keep the days the cluster shows work on, so the count survives a card being
// deleted. It runs on every open, so it writes only when a day or the dropped
// count changed.
export function noteDays(storage, uid, boardId, days) {
  if (!storage || !uid || !boardId) return false;
  const before = readPlaceHeld(storage, uid);
  const after = withDays(before, boardId, days);
  const a = entryOf(before, boardId);
  const b = entryOf(after, boardId);
  if (a.o === b.o && a.d.length === b.d.length && a.d.every((day, i) => day === b.d[i])) return false;
  return writePlaceHeld(storage, uid, after);
}

// --- when the held place opens, and where the camera lands ---

// A real break is half an hour since the cluster was last opened here or last
// touched by me. Never seen on this device and nothing of mine counts as one.
export function isRealBreak({ nowMs, lastVisitMs, myTouchMs: touchMs } = {}) {
  if (!Number.isFinite(nowMs)) return false;
  const seen = [lastVisitMs, touchMs].filter((t) => Number.isFinite(t) && t > 0);
  if (!seen.length) return true;
  return nowMs - Math.max(...seen) >= RESUME_GAP_MS;
}

// The card to glide to, or null: not on a public view, not on a deep link, and
// only after a real break to a card of mine that has a size.
export function planHeldOpen({ uid, cards, nowMs, lastVisitMs, isPublic, deepLink } = {}) {
  if (isPublic || deepLink || !uid) return null;
  const touch = myLastTouch(cards, uid);
  if (!touch) return null;
  if (!isRealBreak({ nowMs, lastVisitMs, myTouchMs: touch.at })) return null;
  const { w, h } = touch.card;
  if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)) return null;
  return { card: touch.card, at: touch.at };
}

// Centre the card in the area right of the rail, sized to fill `share` of it but
// never zoomed out past the fit view and never in past maxZoom. The canvas's
// convention: screen = world * zoom + pan.
export function settleCamera({ card, fitZoom, viewW, viewH, railDx = 0, maxZoom = 1, share = PLACE_SHARE } = {}) {
  const vw = viewW - railDx;
  const ok = [card?.x, card?.y, card?.w, card?.h, fitZoom, viewW, viewH, vw].every(Number.isFinite);
  if (!ok || card.w <= 0 || card.h <= 0 || vw <= 0 || viewH <= 0) return null;
  const zoom = Math.max(fitZoom, Math.min(maxZoom, (share * viewH) / card.h, (share * vw) / card.w));
  if (!Number.isFinite(zoom)) return null;
  return {
    zoom,
    pan: {
      x: railDx + (vw - card.w * zoom) / 2 - card.x * zoom,
      y: (viewH - card.h * zoom) / 2 - card.y * zoom,
    },
  };
}

// --- day-one greeting news: pictures searchable by what is in them ---

const KEYWORD_RE = /^[\p{L}\p{N}][\p{L}\p{N} '\-]*$/u;

function cleanKeywords(list) {
  const seen = new Set();
  const out = [];
  for (const k of Array.isArray(list) ? list : []) {
    if (typeof k !== 'string') continue;
    const s = k.trim();
    if (s.length < 3 || s.length > 24 || !KEYWORD_RE.test(s)) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// { word, n } when three or more of my pictures on this cluster have all been
// read: the word most of them share (a tie goes to the newest picture's first),
// or null. rows come from image_seen_for_board.
export function searchNews({ rows, myPictures } = {}) {
  if (!Array.isArray(rows) || !Array.isArray(myPictures) || myPictures.length < 3) return null;
  const byCard = new Map();
  for (const r of rows) {
    if (r && !byCard.has(String(r.card_id))) byCard.set(String(r.card_id), r.keywords);
  }
  if (!myPictures.every((p) => byCard.has(String(p?.id)))) return null;
  const pics = myPictures.map((p) => ({ at: p?.at, words: cleanKeywords(byCard.get(String(p.id))) }));
  const counts = new Map();
  for (const p of pics) for (const w of p.words) counts.set(w.toLowerCase(), (counts.get(w.toLowerCase()) || 0) + 1);
  if (!counts.size) return null;
  const top = Math.max(...counts.values());
  // newest first; a picture with no time goes last (sort is stable)
  const fin = (t) => Number.isFinite(t);
  pics.sort((a, b) => (fin(a.at) && fin(b.at) ? b.at - a.at : fin(b.at) - fin(a.at)));
  for (const p of pics) {
    const word = p.words.find((w) => counts.get(w.toLowerCase()) === top);
    if (word) return { word, n: myPictures.length };
  }
  return null;
}
