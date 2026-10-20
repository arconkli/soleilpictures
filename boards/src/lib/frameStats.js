// frameStats.js — how smoothly the app ran while someone was using it, for the
// session's summary row (EV.SESSION_SUMMARY `perf`).
//
// perfReport.js already times frames while a pointer or the wheel moved in the
// last second, but only to report a stall. This keeps the whole distribution of
// those frames, so a session can say what share of its interaction ran smooth,
// not only whether it once broke down: each frame's gap is counted under the
// first bound it fits (≤20ms is a full-rate frame at 60Hz and above). Long
// main-thread tasks (50ms or more, where the browser reports them, which Safari
// does not) are counted with their total time.
//
// Totals run from the page load. The summary takes the difference from where
// its session began (frameStatsSince), so a rotated session never inherits the
// frames of the one before it.

export const FRAME_BUCKETS = [20, 34, 50, 100, 350];   // upper bounds, ms
const NAMES = ['le20', 'le34', 'le50', 'le100', 'le350', 'gt350'];

export function createFrameStats() {
  return { f: NAMES.map(() => 0), ms: 0, lt_n: 0, lt_ms: 0 };
}

/** One frame's gap, in ms. Never throws; anything not a positive number is ignored. */
export function noteFrame(st, gap) {
  if (!st || !Number.isFinite(gap) || gap <= 0) return st;
  let i = FRAME_BUCKETS.findIndex((b) => gap <= b);
  if (i < 0) i = FRAME_BUCKETS.length;
  st.f[i] += 1;
  st.ms += gap;
  return st;
}

/** One long task's duration, in ms. */
export function noteLongTask(st, ms) {
  if (!st || !Number.isFinite(ms) || ms <= 0) return st;
  st.lt_n += 1;
  st.lt_ms += ms;
  return st;
}

/** A copy that later frames can't move. */
export function snapshotFrameStats(st) {
  return st ? { f: [...st.f], ms: st.ms, lt_n: st.lt_n, lt_ms: st.lt_ms } : createFrameStats();
}

/** The summary's `perf`: what happened after `base`, or null when nothing did. */
export function frameStatsSince(now, base) {
  if (!now || !Array.isArray(now.f)) return null;
  const b = base && Array.isArray(base.f) ? base : createFrameStats();
  const f = NAMES.map((_, i) => Math.max(0, (now.f[i] || 0) - (b.f[i] || 0)));
  const frames = f.reduce((sum, n) => sum + n, 0);
  const ltN = Math.max(0, (now.lt_n || 0) - (b.lt_n || 0));
  if (!frames && !ltN) return null;
  return {
    frames: Object.fromEntries(NAMES.map((k, i) => [k, f[i]])),
    frame_ms: Math.round(Math.max(0, (now.ms || 0) - (b.ms || 0))),
    lt_n: ltN,
    lt_ms: Math.round(Math.max(0, (now.lt_ms || 0) - (b.lt_ms || 0))),
  };
}
