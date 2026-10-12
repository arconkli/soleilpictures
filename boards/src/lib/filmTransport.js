// The film player's transport decisions, kept pure so they're unit-tested
// (filmTransport.test.mjs): J/K/L shuttle, reverse play, frame stepping, in/out
// loops, jumping between comments. The component (components/film/) owns the
// <video>; this owns the arithmetic.
import { rateValue } from './timecode.js';

export const SHUTTLE_RATES = [1, 2, 4, 8];

// J / K / L, as an editor's keyboard does it:
//   L  play forward; again doubles (1× → 2× → 4× → 8×)
//   J  play backward; again doubles; pressed while going forward it reverses at 1×
//   K  stop
// state: { dir: -1 | 0 | 1, rate }
export function shuttle(state, key) {
  const s = state || { dir: 0, rate: 1 };
  const k = String(key || '').toLowerCase();
  if (k === 'k') return { dir: 0, rate: 1 };
  const want = k === 'l' ? 1 : k === 'j' ? -1 : 0;
  if (!want) return s;
  if (s.dir === want) {
    const i = SHUTTLE_RATES.indexOf(s.rate);
    return { dir: want, rate: SHUTTLE_RATES[Math.min(SHUTTLE_RATES.length - 1, i < 0 ? 0 : i + 1)] };
  }
  return { dir: want, rate: 1 };
}

// Reverse play: browsers can't play backwards (Chrome has no negative
// playbackRate), so the player seeks back repeatedly. How many frames back the
// next seek goes, for the time since the last one landed — at least one, so a
// slow decoder still moves, and never more than a second's worth at once.
export function reverseStepFrames(elapsedMs, rate, fps) {
  const v = rateValue(fps);
  if (!Number.isFinite(v) || v <= 0) return 1;
  const n = Math.floor((Math.max(0, elapsedMs) / 1000) * v * Math.max(1, rate || 1));
  return Math.max(1, Math.min(Math.ceil(v * Math.max(1, rate || 1)), n));
}

export function clampFrame(frame, frames) {
  const max = Number.isFinite(frames) && frames > 0 ? frames - 1 : Infinity;
  return Math.max(0, Math.min(max, Math.round(frame)));
}

// In and out points, in order, inside the clip. Either can be missing.
export function normalizeRange(inF, outF, frames) {
  let a = Number.isFinite(inF) ? clampFrame(inF, frames) : null;
  let b = Number.isFinite(outF) ? clampFrame(outF, frames) : null;
  if (a != null && b != null && b < a) [a, b] = [b, a];
  return { in: a, out: b };
}

// While looping, the frame to show instead of `frame` (null: keep playing).
//   forward past the out point → back to the in point
//   backward before the in point → the out point
export function loopTarget(frame, { in: a, out: b }, dir = 1, frames = Infinity) {
  const start = a ?? 0;
  const end = b ?? (Number.isFinite(frames) ? frames - 1 : null);
  if (end == null) return null;
  if (dir >= 0 && frame > end) return start;
  if (dir < 0 && frame < start) return end;
  return null;
}

// The next marker after (dir 1) or before (dir -1) the current frame, from a
// list of marker frames in any order; null when there is none that way.
export function nextMarker(markers, current, dir = 1) {
  let best = null;
  for (const m of markers || []) {
    if (!Number.isFinite(m)) continue;
    if (dir > 0 && m > current && (best == null || m < best)) best = m;
    if (dir < 0 && m < current && (best == null || m > best)) best = m;
  }
  return best;
}

// Where a pointer at clientX lands on a timeline showing [viewStart, viewEnd)
// frames across `width` pixels — snapped to a whole frame.
export function frameAtX(x, { left = 0, width, viewStart = 0, viewEnd, frames }) {
  if (!(width > 0) || !(viewEnd > viewStart)) return 0;
  const f = viewStart + ((x - left) / width) * (viewEnd - viewStart);
  return clampFrame(Math.floor(f), frames);
}

export function xOfFrame(frame, { width, viewStart = 0, viewEnd }) {
  if (!(width > 0) || !(viewEnd > viewStart)) return 0;
  return ((frame - viewStart) / (viewEnd - viewStart)) * width;
}

// Zoom the visible window around a frame (the pointer's), keeping that frame
// under the pointer. factor < 1 zooms in. The window never shows less than
// 24 frames, or more than the clip.
export function zoomWindow({ viewStart, viewEnd, frames }, anchor, factor) {
  const span = viewEnd - viewStart;
  const minSpan = Math.min(24, frames);
  const next = Math.max(minSpan, Math.min(frames, span * factor));
  const t = span > 0 ? (anchor - viewStart) / span : 0.5;
  let start = anchor - t * next;
  start = Math.max(0, Math.min(frames - next, start));
  return { viewStart: start, viewEnd: start + next };
}

// ── The review player's decisions (components/film/) ───────────────────────

// Playback speeds the speed menu offers, and ⇧< / ⇧> step through.
export const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

// The next speed down (dir -1) or up (dir 1) from `rate`; it stays put at
// either end.
export function stepRate(rate, dir) {
  const i = RATES.findIndex((r) => Math.abs(r - rate) < 1e-6);
  if (i < 0) {
    const up = RATES.find((r) => r > rate);
    const down = [...RATES].reverse().find((r) => r < rate);
    return dir > 0 ? (up ?? RATES[RATES.length - 1]) : (down ?? RATES[0]);
  }
  return RATES[Math.max(0, Math.min(RATES.length - 1, i + (dir > 0 ? 1 : -1)))];
}

// Looping between in and out while playing forward: is the NEXT frame past
// the out point? Asked for every presented frame, so the jump back happens on
// the out frame, not a frame or two after it.
export function shouldLoopNow({ frame, rate = 1, outFrame }) {
  if (!Number.isFinite(frame) || !Number.isFinite(outFrame)) return false;
  return frame + Math.max(1, Math.round(rate || 1)) > outFrame;
}

// Reverse play is seek-driven; frames owed accumulate with time so a slow
// decoder doesn't make it run slower than the asked-for speed.
//   → { n: whole frames to go back now, owed: the fraction left over }
export function reverseAdvance(owed, elapsedMs, fpsValue, rate = 1) {
  if (!(fpsValue > 0)) return { n: 1, owed: 0 };
  const total = (owed || 0) + (Math.max(0, elapsedMs) / 1000) * fpsValue * Math.max(0.05, rate);
  const n = Math.min(Math.floor(total), Math.ceil(fpsValue * Math.max(1, rate)));
  return { n, owed: total - n };
}

// Where Play starts from: null to play on from here. At the end, back to the
// in point (or the top); looping, from the in point when outside the range.
export function playStartFrame({ here, range = {}, looping = false, frames }) {
  const a = range.in ?? null, b = range.out ?? null;
  if (Number.isFinite(frames) && frames > 0 && here >= frames - 1) return a ?? 0;
  if (looping && b != null && (here >= b || here < (a ?? 0))) return a ?? 0;
  return null;
}

// While zoomed in and playing, keep the playhead in view: page on when it
// passes 92% of the window; recentre when it lands outside it.
export function followView({ viewStart, viewEnd }, head, frames) {
  const span = viewEnd - viewStart;
  if (!(span > 0) || !(frames > span)) return null;
  const clampStart = (s) => Math.max(0, Math.min(frames - span, s));
  if (head < viewStart || head > viewEnd) {
    const s = clampStart(head - span / 2);
    return { viewStart: s, viewEnd: s + span };
  }
  if (head > viewStart + span * 0.92) {
    const s = clampStart(viewStart + span * 0.8);
    return s === viewStart ? null : { viewStart: s, viewEnd: s + span };
  }
  return null;
}

// Scrubbing: the pointer sets the frame, or — with ⇧ held — moves it one frame
// per FINE_PX pixels from where ⇧ was pressed. Rebased whenever ⇧ changes, so
// pressing or letting go of it never makes the playhead jump.
export const FINE_PX = 6;
export function scrubFrame(state, { x, shift, geo }) {
  const coarse = frameAtX(x, geo);
  let s = state;
  if (!s || s.fine !== !!shift) {
    s = { fine: !!shift, anchorX: x, anchorFrame: s ? s.frame : coarse, frame: s ? s.frame : coarse };
  }
  const frame = s.fine
    ? clampFrame(s.anchorFrame + Math.round((x - s.anchorX) / FINE_PX), geo.frames)
    : coarse;
  return { ...s, frame };
}

// The ruler over a zoomed timeline: labelled ticks at whole seconds, minutes
// apart as needed so labels never crowd (≥ 80px), and a tick per frame once a
// frame is wide enough to see (≥ 6px).
const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
export function rulerTicks({ viewStart, viewEnd }, fpsValue, width) {
  const span = viewEnd - viewStart;
  if (!(fpsValue > 0) || !(span > 0) || !(width > 0)) return { major: [], minor: [] };
  const pxPerSec = (width / span) * fpsValue;
  const step = RULER_STEPS.find((s) => s * pxPerSec >= 80) ?? RULER_STEPS[RULER_STEPS.length - 1];
  const major = [];
  const firstSec = Math.ceil(viewStart / fpsValue / step) * step;
  for (let sec = firstSec; sec * fpsValue <= viewEnd && major.length < 200; sec += step) {
    major.push({ frame: Math.round(sec * fpsValue), sec });
  }
  const minor = [];
  if (width / span >= 6) {
    for (let f = Math.ceil(viewStart); f <= Math.floor(viewEnd) && minor.length < 800; f++) minor.push(f);
  }
  return { major, minor };
}

// The hover preview's size: 240px wide (160 in a small player, 320 when
// zoomed to frames), its height following the clip, never taller than 160.
export function previewSize(ar, playerWidth, { fine = false } = {}) {
  const a = ar > 0 ? ar : 16 / 9;
  let w = playerWidth && playerWidth < 1000 ? 160 : fine ? 320 : 240;
  let h = w / a;
  if (h > 160) { h = 160; w = h * a; }
  return { w: Math.round(w), h: Math.round(h) };
}

// The in/out region on a track `width` wide: clamped to the visible window.
export function clampRegion(range, view, width, frames) {
  if (!range || (range.in == null && range.out == null) || !(width > 0)) return null;
  const a = range.in ?? 0;
  const b = (range.out ?? frames - 1) + 1;
  const x0 = xOfFrame(a, { width, ...view });
  const x1 = xOfFrame(b, { width, ...view });
  const left = Math.max(0, Math.min(width, x0));
  const right = Math.max(0, Math.min(width, x1));
  return { left, width: Math.max(0, right - left), inX: x0, outX: x1 };
}
