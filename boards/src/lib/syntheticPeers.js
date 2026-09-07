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
// ── Why the first version looked fake ──────────────────────────────────────
// Everyone shared one leg duration and one dwell duration, so the cast differed
// only by phase — three cursors doing the identical dance a beat apart, which
// the eye reads as choreography instantly. Worse, selections ran off a GLOBAL
// clock (`floor(t / SELECT_MS)`), so every peer picked a new card on the same
// tick: three people clicking in perfect unison, which nothing alive does.
//
// So nothing is shared any more. Every peer has its own pace, its own dwell at
// every individual stop, its own selection clock at its own offset, and its own
// idle drift. The only global is the board they are moving over.
//
// The motion only has to be good enough that LiveCursor's own interpolator can
// take over: it Catmull-Rom smooths between reported positions with an 80ms
// render delay, so pushing positions at ~10Hz comes out looking human without a
// second interpolator here.

import { personaFor, personaColor } from './captureIdentity.js';

// Ranges, not constants. A cursor that never rests reads as a bot; a cast that
// all rests for the same 900ms reads as a screensaver.
const LEG_MS = [1500, 3600];      // how long a peer takes to cross to the next stop
const DWELL_MS = [500, 3200];     // how long it stays there — the wide spread is the point
const LINGER_CHANCE = 0.22;       // …and sometimes it just stops and reads something
const LINGER_MS = [2600, 6000];
const SELECT_MS = [3200, 7400];   // each peer changes selection on its OWN clock
const SELECT_CHANCE = 0.62;       // and often has nothing selected at all
const WAYPOINTS = [3, 6];
// A resting hand is not perfectly still. A couple of board units of drift is
// invisible as motion but kills the "frozen sprite" look during a dwell.
const DRIFT = [3, 9];

// Deterministic [0,1) from an integer seed. A hash rather than Math.random so a
// scripted shot replays identically — and because Math.random is unavailable to
// the workflow tooling that drives these runs.
function rand(seed) {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
const pick = (seed, [lo, hi]) => lo + rand(seed) * (hi - lo);
const lerp = (a, b, t) => a + (b - a) * t;
// Smoothstep on the leg, so a peer accelerates away from a stop and decelerates
// into the next one instead of starting and stopping at full speed.
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

    // Even the ROUTE LENGTH differs, so two peers never fall into step even if
    // their paces happen to land close together.
    const stops = Math.round(pick(s + 41, WAYPOINTS));
    const pace = pick(s + 53, [0.75, 1.35]);        // this peer's overall tempo

    const waypoints = [];
    const segs = [];
    for (let k = 0; k < stops; k++) {
      waypoints.push({
        // Inset from the edges so a cursor never parks in the corner of frame,
        // where it reads as a rendering artefact rather than a person.
        x: box.x + box.w * (0.12 + rand(s + k * 31) * 0.76),
        y: box.y + box.h * (0.12 + rand(s + k * 31 + 5) * 0.76),
      });
      // Per-STOP dwell: a person lingers on the thing they care about and
      // glances past the rest. A constant dwell is the tell.
      const linger = rand(s + k * 97 + 11) < LINGER_CHANCE;
      segs.push({
        dwell: pick(s + k * 61 + 3, linger ? LINGER_MS : DWELL_MS) * pace,
        leg: pick(s + k * 67 + 7, LEG_MS) * pace,
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
      segs,
      cycleMs: segs.reduce((a, g) => a + g.dwell + g.leg, 0),
      // Start each peer at an arbitrary point in its OWN route, not at stop 0.
      startMs: rand(s + 99) * segs.reduce((a, g) => a + g.dwell + g.leg, 0),
      // Selection gets its own period AND its own offset. Sharing either is
      // what made three cursors appear to click in unison.
      selectMs: pick(s + 131, SELECT_MS),
      selectOffset: rand(s + 137) * 5000,
      seed: s,
      cardIds,
      // Idle drift, at a frequency nobody else has.
      driftAmp: pick(s + 149, DRIFT),
      driftHz: pick(s + 151, [0.11, 0.29]),
      driftPhase: rand(s + 157) * Math.PI * 2,
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
    const stops = peer.waypoints.length;
    let local = ((t + peer.startMs) % peer.cycleMs + peer.cycleMs) % peer.cycleMs;

    // Walk this peer's own timeline to find which stop it is at or leaving.
    let i = 0;
    for (; i < stops; i++) {
      const span = peer.segs[i].dwell + peer.segs[i].leg;
      if (local < span) break;
      local -= span;
    }
    if (i >= stops) i = stops - 1;

    const seg = peer.segs[i];
    const from = peer.waypoints[i];
    const to = peer.waypoints[(i + 1) % stops];
    const resting = local < seg.dwell;
    const k = resting ? 0 : smooth(Math.min(1, (local - seg.dwell) / Math.max(1, seg.leg)));

    // Drift is at full amplitude while resting and damped in transit, where it
    // would only fight the interpolator.
    const damp = resting ? 1 : 0.25;
    const a = t / 1000 * peer.driftHz * Math.PI * 2 + peer.driftPhase;
    const dx = Math.sin(a) * peer.driftAmp * damp;
    const dy = Math.cos(a * 0.73 + 1.1) * peer.driftAmp * damp;

    // Selection on this peer's own clock, and frequently nothing at all —
    // people spend most of their time not having selected anything.
    const ids = peer.cardIds || [];
    const slot = Math.floor((t + peer.selectOffset) / peer.selectMs);
    const roll = rand(peer.seed ^ (slot * 2654435761));
    const holding = ids.length && roll < SELECT_CHANCE
      ? [ids[Math.floor(rand(peer.seed ^ (slot * 40503)) * ids.length) % ids.length]]
      : [];

    return {
      clientId: peer.clientId,
      state: {
        user: peer.user,
        canvasCursor: {
          boardId,
          x: lerp(from.x, to.x, k) + dx,
          y: lerp(from.y, to.y, k) + dy,
        },
        canvasSelection: { boardId, cardIds: holding, strokeIds: [], arrowIds: [] },
      },
    };
  });
}

export { LEG_MS, DWELL_MS, SELECT_MS, DRIFT };
