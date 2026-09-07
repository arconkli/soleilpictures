// syntheticPeers — a cast of collaborators, so you can film multiplayer alone.
//
// Collaboration is the hardest thing about this product to show and the hardest
// to stage: it needs two or three other people, on other machines, doing
// something plausible, at the same moment you are recording. In practice that
// means the feature never gets filmed.
//
// This generates the peers instead. Pure functions — `makeCast` builds the
// cast, `advanceCast` says where everyone is at time t — so there are no timers
// to leak, the motion is deterministic and replayable for a scripted shot, and
// the whole thing is testable without a DOM.
//
// The motion only has to be good enough that LiveCursor's own interpolator can
// take over: it Catmull-Rom smooths between reported positions with an 80ms
// render delay, so pushing waypoint-to-waypoint positions at ~10Hz comes out
// looking human without a second interpolator here.

import { personaFor, personaColor } from './captureIdentity.js';

// A cursor that never rests reads as a bot. Real people arrive somewhere, stop,
// look, and move on — the pauses are most of what makes it convincing.
const DWELL_MS = 900;
const LEG_MS = 2600;
// How long a peer keeps a card selected before letting go.
const SELECT_MS = 5200;

// Deterministic [0,1) from an integer seed. A hash rather than Math.random so a
// scripted shot replays identically — and because Math.random is unavailable to
// the workflow tooling that drives these runs.
function rand(seed) {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const lerp = (a, b, t) => a + (b - a) * t;
// Smoothstep on the leg itself, so a peer accelerates away from a dwell and
// decelerates into the next one instead of starting and stopping at full speed.
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Build `n` synthetic collaborators.
 *
 * `bounds` is the board-space rectangle they should wander — pass the real
 * board's bounds so the cast moves over the actual content rather than off in
 * empty canvas where nobody would ever be.
 */
export function makeCast(n, { seed = 1, bounds, cardIds = [] } = {}) {
  const count = Math.max(0, Math.min(8, Math.floor(n) || 0));
  const box = {
    x: Number.isFinite(bounds?.x) ? bounds.x : 0,
    y: Number.isFinite(bounds?.y) ? bounds.y : 0,
    w: Number.isFinite(bounds?.w) && bounds.w > 0 ? bounds.w : 1200,
    h: Number.isFinite(bounds?.h) && bounds.h > 0 ? bounds.h : 800,
  };

  const cast = [];
  for (let i = 0; i < count; i++) {
    const s = seed * 977 + i * 7919;
    const persona = personaFor(`cast:${seed}:${i}`);
    // Four waypoints each, inset from the edges so a cursor never parks in the
    // corner of frame where it reads as a rendering artefact.
    const waypoints = [];
    for (let k = 0; k < 4; k++) {
      waypoints.push({
        x: box.x + box.w * (0.12 + rand(s + k * 31) * 0.76),
        y: box.y + box.h * (0.12 + rand(s + k * 31 + 5) * 0.76),
      });
    }
    cast.push({
      // Well clear of any real y-awareness clientID, which is a random 32-bit
      // integer — a collision would make a real peer disappear behind a fake.
      clientId: 900000000 + seed * 100 + i,
      user: {
        id: `capture-cast-${seed}-${i}`,
        name: persona.name,
        color: personaColor(`cast:${seed}:${i}`),
      },
      waypoints,
      // Stagger so they don't all set off together like a marching band.
      phase: rand(s + 99),
      cardIds,
      cardPick: Math.floor(rand(s + 123) * 9973),
    });
  }
  return cast;
}

/**
 * Where the cast is at time `tMs`. Returns awareness-shaped states, ready to be
 * merged into what CanvasPresence reads.
 */
export function advanceCast(cast, tMs, boardId) {
  const t = Number.isFinite(tMs) ? tMs : 0;
  return (cast || []).map((peer) => {
    const cycle = LEG_MS + DWELL_MS;
    const total = peer.waypoints.length * cycle;
    const local = (t + peer.phase * total) % total;
    const leg = Math.floor(local / cycle);
    const inLeg = local - leg * cycle;

    const from = peer.waypoints[leg];
    const to = peer.waypoints[(leg + 1) % peer.waypoints.length];
    // Dwell first, then travel — so a peer is stationary when they arrive.
    const k = inLeg <= DWELL_MS ? 0 : smooth((inLeg - DWELL_MS) / LEG_MS);

    // Selections change on their own slower clock, so a peer's ring doesn't
    // flick on and off in step with their cursor.
    const ids = peer.cardIds || [];
    const slot = Math.floor(t / SELECT_MS);
    const holding = ids.length
      ? [ids[(peer.cardPick + slot) % ids.length]]
      : [];

    return {
      clientId: peer.clientId,
      state: {
        user: peer.user,
        canvasCursor: { boardId, x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k) },
        canvasSelection: { boardId, cardIds: holding, strokeIds: [], arrowIds: [] },
      },
    };
  });
}

export { DWELL_MS, LEG_MS, SELECT_MS };
