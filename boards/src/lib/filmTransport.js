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
