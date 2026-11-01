// videoSync — every autoplay clip on a board at the same frame, for everyone
// looking at it.
//
// A board has one start time (its "epoch", in server milliseconds). Each
// autoplay clip shows (now − epoch) into itself: wrapped round for a loop,
// held on its last frame once a play-once clip is done. The first person to
// open a board sets the epoch to the moment they opened it, so its clips all
// start from the beginning together; anyone who joins takes the earliest epoch
// already on the board (CanvasSurface shares it over live presence as
// `videoEpoch`), so they land on the frame everyone else is seeing.
//
// "now" is the server's clock, not the device's: a laptop a few seconds off
// would otherwise be a few seconds out of step. /api/time (worker.js) answers
// with the server's time; the best of three round trips sets the offset.

// ── The server clock ────────────────────────────────────────────────────────
let offsetMs = 0;
let clockPromise = null;

/** The server's time now, in ms, as best this device knows it. */
export function serverNow() { return Date.now() + offsetMs; }

/** From timed samples [{ sent, received, t }], the device→server offset of the
 * one with the shortest round trip (the least room for one-way delay). */
export function offsetFromSamples(samples) {
  let best = null;
  for (const s of samples || []) {
    if (!s || !Number.isFinite(s.t) || !Number.isFinite(s.sent) || !Number.isFinite(s.received)) continue;
    const rtt = s.received - s.sent;
    if (rtt < 0) continue;
    if (!best || rtt < best.rtt) best = { rtt, offset: s.t + rtt / 2 - s.received };
  }
  return best ? best.offset : null;
}

/** Ask the server for its time (once per page); resolves when the offset is
 * set, or left at 0 where there is no /api/time (the local harness). */
export function syncServerClock(fetchImpl = (typeof fetch === 'function' ? fetch : null)) {
  if (clockPromise) return clockPromise;
  clockPromise = (async () => {
    if (!fetchImpl) return offsetMs;
    const samples = [];
    for (let i = 0; i < 3; i++) {
      try {
        const sent = Date.now();
        const res = await fetchImpl('/api/time', { cache: 'no-store' });
        const received = Date.now();
        if (!res?.ok) break;
        const body = await res.json();
        samples.push({ sent, received, t: Number(body?.t) });
      } catch (_) { break; }
    }
    const off = offsetFromSamples(samples);
    if (off != null) offsetMs = off;
    return offsetMs;
  })();
  return clockPromise;
}

// ── Where a clip should be ──────────────────────────────────────────────────

/** Where a clip should be at `now` (ms) on a board whose epoch is `epoch`
 * (ms): `{ time, ended }` in seconds, or null when it can't say yet. */
export function syncTarget({ now, epoch, dur, loop }) {
  if (!Number.isFinite(now) || !Number.isFinite(epoch) || !Number.isFinite(dur) || dur <= 0) return null;
  const elapsed = Math.max(0, (now - epoch) / 1000);
  if (loop) return { time: elapsed % dur, ended: false };
  return elapsed >= dur ? { time: dur, ended: true } : { time: elapsed, ended: false };
}

/** How far `current` is behind `target` (positive: behind), in seconds. A loop
 * takes the short way round, so 0.1s before the seam and 0.1s after it are
 * 0.2s apart, not a whole clip. */
export function timeDiff(target, current, dur, loop) {
  let d = target - current;
  if (loop && Number.isFinite(dur) && dur > 0) {
    d = ((d % dur) + dur) % dur;
    if (d > dur / 2) d -= dur;
  }
  return d;
}

export const SEEK_OVER_S = 0.35;   // further out than this: jump there
export const NUDGE_OVER_S = 0.04;  // between the two: play a touch fast or slow
export const NUDGE_RATE = 0.05;
export const SEEK_LEAD_S = 0.1;    // a jump lands this far ahead, for the time the seek itself takes

/** What to do about a drift of `diff` seconds: `{ seek: true }`, or the
 * playback rate that closes it without a visible jump. */
export function driftFix(diff) {
  if (!Number.isFinite(diff)) return { rate: 1 };
  const a = Math.abs(diff);
  if (a > SEEK_OVER_S) return { seek: true };
  if (a > NUDGE_OVER_S) return { rate: diff > 0 ? 1 + NUDGE_RATE : 1 - NUDGE_RATE };
  return { rate: 1 };
}

/** The board's epoch: the earliest of ours and the ones peers share. */
export function earliestEpoch(own, peers) {
  let best = Number.isFinite(own) ? own : null;
  for (const p of peers || []) if (Number.isFinite(p) && (best == null || p < best)) best = p;
  return best;
}

// ── Each board's epoch (set by CanvasSurface, read by VideoCard) ────────────
const epochs = new Map();
const listeners = new Map();

export function getBoardEpoch(boardId) { return boardId ? (epochs.get(boardId) ?? null) : null; }

export function setBoardEpoch(boardId, ms) {
  if (!boardId) return;
  const next = Number.isFinite(ms) ? ms : null;
  if ((epochs.get(boardId) ?? null) === next) return;
  if (next == null) epochs.delete(boardId); else epochs.set(boardId, next);
  for (const fn of listeners.get(boardId) || []) { try { fn(next); } catch (_) {} }
}

export function subscribeBoardEpoch(boardId, fn) {
  if (!boardId) return () => {};
  let set = listeners.get(boardId);
  if (!set) { set = new Set(); listeners.set(boardId, set); }
  set.add(fn);
  return () => { set.delete(fn); if (!set.size) listeners.delete(boardId); };
}
