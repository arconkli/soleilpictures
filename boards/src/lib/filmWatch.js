// filmWatch.js — what one viewing of a clip in the film player came to, for
// EV.FILM_PLAY and EV.FILM_WATCH: whether it played, for how long, and how far
// into the clip it got.
//
// A viewing is one player face on one clip (a card's compact player, Quick
// look, the review player, the /f/ page). It starts at the first play, and is
// summed up once, when the player lets go of the clip. Loop jumps, seeks and
// A/B flips are not new plays. How far is the furthest point the playhead
// reached while playing, so scrubbing to the end of a clip nobody played is
// no watch at all.

export const WATCH_PCT_BUCKETS = [0, 10, 25, 50, 75, 90, 100];
// Within half a second of the end is the end: a clip's last timeupdate rarely
// lands on its duration exactly.
const END_SLOP_S = 0.5;
const MAX_PLAYED_S = 24 * 3600;

export function createWatch() {
  return { started: false, playing: false, since: 0, playedMs: 0, maxT: 0, dur: 0, done: false };
}

/** Playback started at `now` (ms). True only for the viewing's first play. */
export function watchPlay(w, now) {
  if (!w || w.done || w.playing || !Number.isFinite(now)) return false;
  w.playing = true;
  w.since = now;
  if (w.started) return false;
  w.started = true;
  return true;
}

/** Where the playhead is (s), and the clip's length when known. Counts only while playing. */
export function watchTick(w, t, dur) {
  if (!w || w.done) return;
  if (Number.isFinite(dur) && dur > 0) w.dur = dur;
  if (w.playing && Number.isFinite(t) && t > w.maxT) w.maxT = t;
}

/** Playback stopped at `now`, with the playhead at `t`. */
export function watchPause(w, now, t) {
  if (!w || w.done || !w.playing) return;
  watchTick(w, t);
  if (Number.isFinite(now)) w.playedMs += Math.max(0, now - w.since);
  w.playing = false;
}

/** It played to the end. */
export function watchEnded(w, dur) {
  if (!w || w.done || !w.started) return;
  if (Number.isFinite(dur) && dur > 0) { w.dur = dur; w.maxT = Math.max(w.maxT, dur); }
}

function bucket(pct) {
  let out = 0;
  for (const b of WATCH_PCT_BUCKETS) if (pct >= b) out = b;
  return out;
}

/**
 * The viewing, summed up: {played_s, pct, dur_s}, or null when it never
 * played or was already summed up. pct is a bucket from WATCH_PCT_BUCKETS, or
 * null when the clip's length never became known.
 */
export function watchSummary(w, now) {
  if (!w || w.done || !w.started) return null;
  watchPause(w, now, NaN);
  w.done = true;
  const dur = w.dur;
  let pct = null;
  if (dur > 0) pct = dur - w.maxT <= END_SLOP_S ? 100 : bucket(Math.min(100, (w.maxT / dur) * 100));
  return {
    played_s: Math.min(MAX_PLAYED_S, Math.round(w.playedMs / 1000)),
    pct,
    dur_s: dur > 0 ? Math.round(dur) : null,
  };
}
