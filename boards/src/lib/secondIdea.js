// secondIdea — when new things arrive on a pile from an earlier sitting, they
// may be the start of something else, and the canvas offers them a cluster of
// their own (CanvasSurface, behind clusterNudgesAllowed).
//
// Most people pile everything onto one board, and the second idea is where
// that stops working: "where else do I put this?" So the offer waits for the
// next idea to actually arrive — a paste or a drop onto a board that already
// holds a pile, hours after anything was last added to it. A drop in the
// middle of a sitting is more of the same thing, and gets nothing.
//
// Pure, so the rule is testable without a canvas.

// The pile: what a sweep would call loose (lib/clusterFromSelection) — not a
// cluster, not a starter card. The Studio bar's floor too.
export const SECOND_IDEA_MIN_PRIOR = 6;
// The sitting: nothing added to this board for this long.
export const SECOND_IDEA_GAP_MS = 3 * 60 * 60 * 1000;

const isClusterRef = (c) => c?.kind === 'board' || c?.kind === 'boardlink';
const isSeed = (c) => c?.seed === true || String(c?.id ?? '').startsWith('onb-');

// createdAt is an ISO string (App's stampCreate); a number is read as one.
// The oldest cards carry nothing, and are simply old.
export function stampMs(v) {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

// priorCards: the board as it was before this paste or drop. newCount: how
// many cards the gesture brings.
export function secondIdeaDue({
  priorCards, newCount, now = Date.now(),
  minPrior = SECOND_IDEA_MIN_PRIOR, gapMs = SECOND_IDEA_GAP_MS,
} = {}) {
  if (!(Number(newCount) >= 1)) return false;
  let pile = 0;
  let newest = null;
  for (const c of Array.isArray(priorCards) ? priorCards : []) {
    if (!c) continue;
    // Any add belongs to the sitting, a cluster's card included.
    const t = stampMs(c.createdAt);
    if (t != null && (newest == null || t > newest)) newest = t;
    if (!isClusterRef(c) && !isSeed(c)) pile += 1;
  }
  if (pile < minPrior) return false;
  if (newest == null) return true;
  // Number(null) is 0, a finite epoch: a null clock reads the real one.
  const at = now == null || !Number.isFinite(Number(now)) ? Date.now() : Number(now);
  // A card stamped ahead of this clock (another device's) is this sitting.
  return at - newest >= gapMs;
}
