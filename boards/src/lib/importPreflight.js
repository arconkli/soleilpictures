// importPreflight — decide what a bulk file import may place BEFORE it uploads.
//
// The canvas drop path (CanvasSurface.ingestFiles) used to classify, measure,
// lay out, upload and place a whole folder with no cap check at all — the list
// path already sliced (App.jsx), the canvas simply never did. So an over-cap
// folder drop rendered in full, uploaded in full, and was then withdrawn by the
// server trigger seconds later.
//
// The live traces are unambiguous: someone signs up, drops a folder of a
// hundred-odd photographs within minutes, and is left holding a fraction of it
// — a count BELOW their own cap, because the batch had not merely overflowed,
// it had failed whole. They lost the cards they were entitled to along with the
// overflow, and they did not come back.
//
// A folder drop is the highest-intent gesture a new user can make: it is them
// saying "this is my actual project". Refusing it after the fact refuses the
// qualification event and attaches the upgrade ask to a data-loss event. Asking
// first costs one dialog and destroys nothing.
//
// UNRESOLVED IS NOT UNCAPPED. This is the actual bug that let 76- and 85-card
// batches reach the server: capSource() reported `capped: myTier.tier ===
// 'demo'`, and useMyTier holds `tier: null` both while loading AND after a
// failed get_my_tier (the catch leaves the store EMPTY; only a window focus
// retries). A null tier therefore read as "not a demo user" and switched the
// gate off entirely. `resolved` is checked BEFORE `capped` here so that state
// can only ever produce 'unresolved' — never a silent all-clear. Same
// fail-open shape as the `isNew` bug fixed in abe729fa.
//
// Pure and dependency-free apart from evaluateDemoCap (which owns the cap
// arithmetic and must not be re-implemented), so this is unit-testable under
// node with no React/Yjs/backend — see the sibling .test.mjs.

import { evaluateDemoCap } from './demoCardCap.js';

// planImport({ capped, resolved, count, limit, requested }) -> plan
//
//   requested   how many cards this gesture would create
//   resolved    has the cap state actually loaded? (tier !== null / capacity in hand)
//   capped      is the paying subject on a limited tier?
//   count       cards already counted against the cap
//   limit       the effective cap (card_cap_base + bonus_card_credits)
//
// Returns { outcome, take, over, count, limit }:
//   'proceed'    — place all `take` of them, no UI (the overwhelmingly common path)
//   'partial'    — `take` fit and `over` do not; ask before touching anything
//   'blocked'    — no room at all; the caller shows the existing cap wall
//   'unresolved' — the cap isn't known yet; the caller must resolve and re-plan
//
// `take` is meaningful for every outcome, so a caller that ignores the dialog
// entirely (or whose resolve fails) can still slice safely instead of sending
// the whole batch at a server that will refuse it.
export function planImport(opts) {
  const o = opts || {};
  const requested = Math.max(0, Number(o.requested) | 0);

  // An empty gesture is not an import. Guarded first and unconditionally so a
  // no-op drop can never open a dialog — the same boundary evaluateDemoCap
  // draws for requested:0.
  if (requested <= 0) return plan('proceed', 0, 0, o);

  // Deliberately ahead of the `capped` test: see the header.
  if (!o.resolved) return plan('unresolved', 0, requested, o);

  if (!o.capped) return plan('proceed', requested, 0, o);

  const { accepted, capHit } = evaluateDemoCap({
    tier: 'demo',
    demoCardCount: o.count,
    requested,
    limit: o.limit,
  });

  if (!capHit) return plan('proceed', requested, 0, o);
  if (accepted <= 0) return plan('blocked', 0, requested, o);
  return plan('partial', accepted, requested - accepted, o);
}

function plan(outcome, take, over, o) {
  return {
    outcome,
    take,
    over,
    count: Math.max(0, Number(o.count) || 0),
    limit: Number.isFinite(Number(o.limit)) ? Number(o.limit) : null,
  };
}

// ── The drive ───────────────────────────────────────────────────────────────
//
// Since 0413 the owner's drive is the free plan's other wall, and the only byte
// limit on any plan. A drop that cannot fit in what is left would otherwise
// place optimistic cards and roll each one back on its own 402 — exactly the
// failure the card preflight above was written to end. So the drop is measured
// first: every surface holds the File objects before it uploads anything.
//
// A video or an audio file brings a small original of its own (the poster, the
// embedded cover), which counts too, so each of those is charged a little
// slack. Previews and thumbnails never count (0411), so images carry none.
export const MEDIA_SLACK_BYTES = 1024 * 1024;

// planBytes({ items, remaining }) -> { take, needed, resolved }
//
//   items      [{ bytes, kind }] in the order the drop would place them
//   remaining  bytes left on the drive the upload counts against, or null
//              when that is not known
//
// `take` is how many of `items`, from the front, fit. Unknown room is NOT
// "no room": it resolves to taking everything and letting the server decide,
// the same fail-open the card preflight uses when its RPC is down — a drop
// that silently does nothing is indistinguishable from a broken app.
export function planBytes(opts) {
  const o = opts || {};
  const list = Array.isArray(o.items) ? o.items : [];
  const room = o.remaining == null ? NaN : Number(o.remaining);
  let needed = 0;
  for (const it of list) needed += Math.max(0, Number(it?.bytes) || 0);
  if (!Number.isFinite(room)) return { take: list.length, needed, resolved: false };
  let used = 0;
  let take = 0;
  for (const it of list) {
    const slack = it?.kind === 'video' || it?.kind === 'audio' ? MEDIA_SLACK_BYTES : 0;
    const cost = Math.max(0, Number(it?.bytes) || 0) + slack;
    if (used + cost > room) break;
    used += cost;
    take++;
  }
  return { take, needed, resolved: true };
}
