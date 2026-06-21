// demoCardCap — the single source of truth for the demo-tier card cap.
//
// Demo accounts are limited to DEMO_CARD_LIMIT cards total across every board
// they created. This pure helper decides how many of a requested batch are
// allowed; the callers (addCard / addCards / duplicateCards in App.jsx) own the
// side effects (opening the cap-hit upgrade modal, the approaching-limit toast,
// the actual Y.Doc writes). Keeping the math here — with no React/Yjs deps —
// means it is unit-testable without a backend (see demoCardCap.test.mjs).
//
// NOTE: this mirrors the client-cached count. The authoritative backstop is the
// server BEFORE-INSERT trigger on card_index (migration 0091), which does a live
// COUNT; this client gate is what users actually see.

export const DEMO_CARD_LIMIT = 100;

// evaluateDemoCap({ tier, demoCardCount, requested, limit }) -> { accepted, capHit, remaining }
//   accepted  — how many of `requested` may be created (0..requested)
//   capHit    — true when at least one requested card was refused (caller opens
//               the cap-hit modal). false for non-demo tiers and for requests
//               that fit. requested:0 -> { accepted:0, capHit:false } so an
//               empty/no-op request never spuriously triggers the modal.
//   remaining — room left before the cap (Infinity for non-demo tiers)
//   limit     — the effective cap (default DEMO_CARD_LIMIT). Referral bonus cards
//               raise it: the server returns 100 + bonus_card_credits via
//               get_my_tier().effective_card_limit; callers thread that through.
export function evaluateDemoCap({ tier, demoCardCount, requested, limit = DEMO_CARD_LIMIT }) {
  const req = Math.max(0, requested | 0);
  if (tier !== 'demo') return { accepted: req, capHit: false, remaining: Infinity };
  const cap = Number.isFinite(limit) && limit > 0 ? (limit | 0) : DEMO_CARD_LIMIT;
  const remaining = Math.max(0, cap - (demoCardCount || 0));
  if (req > remaining) return { accepted: remaining, capHit: true, remaining };
  return { accepted: req, capHit: false, remaining };
}
