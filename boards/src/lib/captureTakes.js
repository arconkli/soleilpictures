// captureTakes — camera moves, and named sequences of them.
//
// A single tweened move already beats scroll-wheeling to a card. But a demo
// clip is not one move, it is a SHAPE: establish, hold, go in on the thing that
// matters, hold, come back. Doing that by hand means hitting two buttons at the
// right moments while also recording, and getting it identical on the retake is
// luck. A take is that shape, written down.
//
// Everything here is pure data and pure functions — the player lives in
// CanvasSurface because that is what owns the camera. Keeping the vocabulary
// out here means the shot-list CLI and the HUD drive the same sequences the
// same way, and the timings can be asserted without a browser.

import { DEFAULT_EASE } from './captureCamera.js';

// ── Moves ──────────────────────────────────────────────────────────────────
//
//   fit        frame the whole board
//   selection  push in on what's selected (falls back to the board)
//   card       frame one card by id
//   hold       stay exactly where you are — the beat between two moves, and
//              the thing most home-made demos are missing
//   zoom       multiply the current zoom about the viewport centre
//   pan        translate by a distance in BOARD units, zoom unchanged
//   sweep      travel across the board's width at the current zoom
export const MOVE_TYPES = Object.freeze(['fit', 'selection', 'card', 'hold', 'zoom', 'pan', 'sweep']);

export const DEFAULT_MOVE_MS = 900;

export function isMove(m) {
  return !!m && MOVE_TYPES.includes(m.type);
}

/** Normalise one move: fill defaults, drop what isn't a move. */
export function normalizeMove(m) {
  if (!isMove(m)) return null;
  const ms = Number.isFinite(m.ms) && m.ms >= 0 ? Math.min(20000, m.ms) : DEFAULT_MOVE_MS;
  return { ...m, ms, ease: m.ease || DEFAULT_EASE };
}

export function normalizeMoves(moves) {
  return (Array.isArray(moves) ? moves : []).map(normalizeMove).filter(Boolean);
}

/** Total wall-clock of a sequence. The recorder needs this to know when to
 *  stop, so it is derived from the moves rather than guessed at the call site. */
export function takeDuration(moves) {
  return normalizeMoves(moves).reduce((sum, m) => sum + m.ms, 0);
}

// ── Takes ──────────────────────────────────────────────────────────────────
//
// Deliberately few. Five shapes that each answer a different question, rather
// than a menu of variations on one — a longer list would mostly be an
// invitation to pick badly.
export const TAKES = Object.freeze([
  {
    id: 'establish',
    label: 'Establish',
    blurb: 'Frame everything, hold, go in on the selection, hold, come back out.',
    moves: [
      { type: 'fit', ms: 1100, ease: 'settle' },
      { type: 'hold', ms: 1100 },
      { type: 'selection', ms: 1000, ease: 'smooth' },
      { type: 'hold', ms: 1600 },
      { type: 'fit', ms: 1100, ease: 'smooth' },
      { type: 'hold', ms: 700 },
    ],
  },
  {
    id: 'reveal',
    label: 'Reveal',
    blurb: 'Open tight on the work, then pull back to show how much there is.',
    moves: [
      { type: 'zoom', by: 2.4, ms: 0 },
      { type: 'hold', ms: 900 },
      { type: 'fit', ms: 1900, ease: 'settle' },
      { type: 'hold', ms: 1200 },
    ],
  },
  {
    id: 'sweep',
    label: 'Sweep',
    blurb: 'Travel across the board at reading size, then settle on the whole thing.',
    moves: [
      { type: 'fit', ms: 0 },
      { type: 'zoom', by: 1.9, ms: 700, ease: 'settle' },
      { type: 'hold', ms: 500 },
      { type: 'sweep', ms: 3400, ease: 'drift' },
      { type: 'hold', ms: 400 },
      { type: 'fit', ms: 1200, ease: 'smooth' },
      { type: 'hold', ms: 800 },
    ],
  },
  {
    id: 'drift',
    label: 'Drift',
    blurb: 'Barely-there ambient motion. Loops cleanly behind a title card.',
    // The only take that does NOT end on a hold, deliberately: its pans cancel
    // out, so the last frame is the first frame and two copies butt-splice
    // invisibly. A trailing beat would put a stutter at the seam.
    loop: true,
    moves: [
      { type: 'fit', ms: 0 },
      { type: 'zoom', by: 1.25, ms: 0 },
      { type: 'pan', dx: 160, dy: -60, ms: 4200, ease: 'drift' },
      { type: 'pan', dx: -160, dy: 60, ms: 4200, ease: 'drift' },
    ],
  },
  {
    id: 'punch',
    label: 'Punch in',
    blurb: 'One fast move onto the selection. For a clip that has to land in three seconds.',
    moves: [
      { type: 'fit', ms: 0 },
      { type: 'hold', ms: 500 },
      { type: 'selection', ms: 620, ease: 'snap' },
      { type: 'hold', ms: 1400 },
    ],
  },
]);

export function takeFor(id) {
  return TAKES.find(t => t.id === id) || null;
}

/** The moves for a take id, or [] — so a caller can always spread the result. */
export function resolveTake(id) {
  const t = takeFor(id);
  return t ? normalizeMoves(t.moves) : [];
}
