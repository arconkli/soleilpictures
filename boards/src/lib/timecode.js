// Frames, seconds and SMPTE timecode — the arithmetic a film player rests on.
// Pure, so every rounding decision is unit-tested (timecode.test.mjs).
//
// A frame rate is a rational [num, den]: 24000/1001 is 23.976, 30000/1001 is
// 29.97. Floating "23.976" is how off-by-one frames happen, so it's never used
// for arithmetic here.
//
// Seconds ↔ frames:
//   timeToFrame  the frame on screen at media time t — floor, because frame n
//                is on screen from its start until frame n+1's start.
//   frameCentre  where to SEEK to show frame n: its middle, never its edge, so
//                a decoder's rounding can't land on the neighbour.
// `t0` is the media time of frame 0 (an edit list or composition offset can
// make it non-zero); the player measures it once and passes it in.

export const COMMON_RATES = [
  [12, 1], [15, 1], [24000, 1001], [24, 1], [25, 1], [30000, 1001], [30, 1],
  [48000, 1001], [48, 1], [50, 1], [60000, 1001], [60, 1], [100, 1],
  [120000, 1001], [120, 1], [240, 1],
];

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

// A rate as [num, den] from [num, den], a number, or a timescale/delta pair.
export function toRate(fps) {
  if (Array.isArray(fps) && fps.length === 2 && fps[0] > 0 && fps[1] > 0) return [fps[0], fps[1]];
  if (Number.isFinite(fps) && fps > 0) return snapFps(fps);
  return null;
}

export function rateValue(fps) {
  const r = toRate(fps);
  return r ? r[0] / r[1] : NaN;
}

// The NEAREST standard rate when within 0.04% (an encoder's 23.9760001 is
// 24000/1001), else the exact fraction reduced. Nearest, and that tight,
// because 24 and 23.976 are only 0.1% apart — a looser first-match made an
// exact 24 fps clip read as 23.976.
export function snapFps(value, den = 1) {
  const v = typeof value === 'number' && den !== 1 ? value / den : value;
  if (!Number.isFinite(v) || v <= 0) return null;
  let best = null, bestDiff = Infinity;
  for (const c of COMMON_RATES) {
    const cv = c[0] / c[1];
    const diff = Math.abs(v - cv) / cv;
    if (diff < bestDiff) { best = c; bestDiff = diff; }
  }
  if (best && bestDiff <= 0.0004) return [best[0], best[1]];
  if (den !== 1 && Number.isInteger(value) && Number.isInteger(den)) {
    const g = gcd(value, den);
    return [value / g, den / g];
  }
  // An arbitrary measured rate: keep three decimals.
  const num = Math.round(v * 1000);
  const g = gcd(num, 1000);
  return [num / g, 1000 / g];
}

// The frame count a timecode second holds: 30 for 29.97, 24 for 23.976.
export function nominalRate(fps) {
  const v = rateValue(fps);
  return Number.isFinite(v) ? Math.round(v) : NaN;
}

// Drop-frame timecode exists only for the NTSC rates 29.97 and 59.94.
export function canDropFrame(fps) {
  const r = toRate(fps);
  if (!r) return false;
  const n = nominalRate(r);
  return r[1] === 1001 && (n === 30 || n === 60);
}

export function timeToFrame(t, fps, t0 = 0) {
  const r = toRate(fps);
  if (!r || !Number.isFinite(t)) return 0;
  // A presented frame's time is its start, and the browser reports it to the
  // microsecond: 5/24 s comes back as 0.208333, a hair under the edge. Two
  // hundredths of a frame of slack lands it on its own frame at any rate (a
  // seek aims at a frame's centre, so it never comes near the edge).
  return Math.max(0, Math.floor(((t - t0) * r[0]) / r[1] + 0.02));
}

export function frameStart(n, fps, t0 = 0) {
  const r = toRate(fps);
  return r ? t0 + (n * r[1]) / r[0] : NaN;
}

export function frameCentre(n, fps, t0 = 0, duration = Infinity) {
  const r = toRate(fps);
  if (!r) return NaN;
  const t = t0 + ((Math.max(0, n) + 0.5) * r[1]) / r[0];
  // The last frame's centre can sit past a container's rounded duration.
  return Number.isFinite(duration) ? Math.min(t, Math.max(0, duration - 1e-3)) : t;
}

export function frameCount(duration, fps) {
  const r = toRate(fps);
  if (!r || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(1, Math.round((duration * r[0]) / r[1]));
}

const pad = (n) => String(n).padStart(2, '0');

// Frame number → "HH:MM:SS:FF" (";" before the frames in drop-frame).
//   opts.df     drop-frame counting (29.97 / 59.94 only)
//   opts.start  frames to add first — a clip's start timecode (01:00:00:00)
export function frameToTC(frame, fps, { df = false, start = 0 } = {}) {
  const nom = nominalRate(fps);
  if (!Number.isFinite(nom) || nom <= 0) return '';
  let total = Math.max(0, Math.floor(frame) + Math.floor(start || 0));
  const drop = df && canDropFrame(fps) ? Math.round(nom / 15) : 0;   // 2 at 29.97, 4 at 59.94
  if (drop) {
    const per10 = nom * 600 - drop * 9;          // 17982 at 29.97
    const perMin = nom * 60 - drop;              // 1798
    const d = Math.floor(total / per10);
    const m = total % per10;
    total += drop * 9 * d + (m > drop ? drop * Math.floor((m - drop) / perMin) : 0);
  }
  const ff = total % nom;
  const s = Math.floor(total / nom);
  return `${pad(Math.floor(s / 3600) % 24)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}${drop ? ';' : ':'}${pad(ff)}`;
}

// "HH:MM:SS:FF" (or with ";") → frame number, or null when it isn't one.
export function tcToFrame(tc, fps, { df = false } = {}) {
  const m = String(tc || '').trim().match(/^(\d{1,2})[:;.](\d{1,2})[:;.](\d{1,2})[:;.](\d{1,3})$/);
  if (!m) return null;
  const nom = nominalRate(fps);
  if (!Number.isFinite(nom) || nom <= 0) return null;
  const [hh, mm, ss, ff] = m.slice(1).map(Number);
  if (mm > 59 || ss > 59 || ff >= nom) return null;
  const drop = (df || tc.includes(';')) && canDropFrame(fps) ? Math.round(nom / 15) : 0;
  const totalMin = hh * 60 + mm;
  return (hh * 3600 + mm * 60 + ss) * nom + ff - drop * (totalMin - Math.floor(totalMin / 10));
}

// What someone typed into the timecode field → the frame to go to, or null.
//   01:00:10:12   a timecode (a clip's start timecode is subtracted)
//   240 · f240    a frame number
//   10.5s         seconds
//   +12 · -1s     relative to the current frame
export function parseJump(input, { fps, current = 0, startFrames = 0, df = false, frames = Infinity } = {}) {
  const s = String(input || '').trim().toLowerCase();
  if (!s || !toRate(fps)) return null;
  const clamp = (n) => Math.max(0, Math.min(Number.isFinite(frames) ? frames - 1 : n, Math.round(n)));
  const rel = s[0] === '+' || s[0] === '-' ? (s[0] === '-' ? -1 : 1) : 0;
  const body = rel ? s.slice(1).trim() : s;
  let n = null;
  let m;
  if ((m = body.match(/^(\d+(?:\.\d+)?)\s*s$/))) n = Number(m[1]) * rateValue(fps);
  else if ((m = body.match(/^f?\s*(\d+)$/))) n = Number(m[1]);
  else if (!rel) {
    const f = tcToFrame(body, fps, { df });
    if (f != null) n = f - (startFrames || 0);
  }
  if (n == null || !Number.isFinite(n)) return null;
  return clamp(rel ? current + rel * n : n);
}
