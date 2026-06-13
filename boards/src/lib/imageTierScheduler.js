// imageTierScheduler.js — decides WHEN and HOW MANY image cards may change
// their decoded variant after a canvas zoom/pan settle.
//
// Background: each canvas image card (R2Image) holds a decoded texture for its
// current tier (sm 640w / preview 1280w / original). When the user zooms, the
// on-screen size of every card changes, so cards want to promote (zoomed in →
// sharper) or demote (zoomed out → smaller). The OLD design ran that decision
// per-card in its own effect on every settle: one settle woke ~70 effects in
// the same idle window → 70 forced layouts + 70 texture swaps, each
// re-rastering its slice of the single GPU-promoted .canvas layer. At fit-all
// (whole board visible) that was a multi-hundred-ms compositor raster storm —
// the "everything DIES" freeze, GPU-bound with an idle main thread.
//
// This module is the single coordinator. Cards REGISTER a handle and stop
// acting on their own; the scheduler drains tier transitions with a budget:
//   - PROMOTES fire ~promoteDelayMs after a settle, only for cards whose rect
//     still intersects the viewport (a card the cull is about to unmount never
//     wastes an original decode), largest on-screen area first.
//   - DEMOTES are memory hygiene, not visual — they fire only after
//     demoteIdleMs of NO settle/gesture (every settle pushes the clock out),
//     so a thrash never demotes mid-interaction. Each demote probe-decodes its
//     target before the swap (the card's run() owns that), so a loaded image
//     never re-blurs.
//   - At most maxConcurrent src swaps commit per drain tick, batchGapMs (~1
//     frame) apart, so the compositor flushes between invalidations.
//   - A card whose canvas scale moved <scaleEpsilon since its last evaluation
//     is skipped (a pan-only settle re-measures nothing — no 70 no-op gBCRs).
//   - A resumed gesture aborts the whole in-flight queue (onGesture); cards
//     keep their current tier, and the gesture's own settle reschedules.
//
// Pure + dependency-injected (clock, timers, idle, gesture probe) so the
// policy is unit-testable without a browser — see image-tier-scheduler.spec.js.
// The card handle carries all DOM/meta knowledge; the scheduler owns only
// timing and budget.
//
// Card handle shape (provided by R2Image at register):
//   evaluate(): null | {
//     kind: 'promote' | 'demote',
//     area: number,        // on-screen device-px area, for largest-first order
//     inViewport: boolean, // from the ONE gBCR it took at execution time
//     run: () => void | Promise<any>,  // commit the swap (promote sync;
//                                       // demote presigns + probe-decodes then
//                                       // swaps; re-checks gesture internally)
//   }
//
// NOTE: this file imports NOTHING at module load — like partyTokenRefresh.js,
// the factory is pure so it unit-tests in the bare Node test process. The
// singleton's gesture probe is pulled in via a lazy dynamic import() that only
// fires when getImageTierScheduler() is first called in the browser.

export function createImageTierScheduler({
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  requestIdle = (typeof window !== 'undefined' && window.requestIdleCallback)
    ? (fn) => window.requestIdleCallback(fn, { timeout: 500 })
    : (fn) => setTimeout(fn, 0),
  cancelIdle = (typeof window !== 'undefined' && window.cancelIdleCallback)
    ? (id) => window.cancelIdleCallback(id)
    : (id) => clearTimeout(id),
  isGestureActive = () => false,
  maxConcurrent = 3,
  promoteDelayMs = 150,
  demoteIdleMs = 1500,
  batchGapMs = 16,
  scaleEpsilon = 0.10,
} = {}) {
  let disposed = false;
  // Generation: bumped on every settle and every gesture so any in-flight
  // drain/batch from a superseded settle bails on its next checkpoint.
  let gen = 0;
  let currentScale = 1;
  let lastSettleAt = 0;
  let promoteTimer = null;
  let demoteTimer = null;
  let batchTimer = null;
  let promoteIdle = null;
  let demoteIdle = null;
  // cardId → { handle, lastEvalScale }. lastEvalScale advances ONLY when a card
  // needs no further action at the current scale (intent 'none', or after a
  // swap actually runs) — a card with a still-pending promote/demote stays
  // re-evaluatable, so a pan-only settle in the demote-wait window can't
  // silently cancel a queued demote, and a card that loads/remounts AFTER the
  // promote drain still gets demoted by the (fresh) demote drain.
  const cards = new Map();

  function clearTimers() {
    if (promoteTimer != null) { clearTimer(promoteTimer); promoteTimer = null; }
    if (demoteTimer != null) { clearTimer(demoteTimer); demoteTimer = null; }
    if (batchTimer != null) { clearTimer(batchTimer); batchTimer = null; }
    if (promoteIdle != null) { try { cancelIdle(promoteIdle); } catch (_) {} promoteIdle = null; }
    if (demoteIdle != null) { try { cancelIdle(demoteIdle); } catch (_) {} demoteIdle = null; }
  }

  // Evaluate every epsilon-eligible card (one gBCR each) and collect the
  // intents matching this drain's kind, largest on-screen area first. Promotes
  // additionally require the card to still be in the viewport (no wasted
  // original decode for a card the cull is about to drop). lastEvalScale
  // advances ONLY for cards that need no action this scale — a card with a
  // still-pending action stays re-evaluatable, so (a) a pan-only settle can't
  // cancel a queued demote, and (b) the demote drain re-evaluates fresh at idle
  // time, catching cards that loaded/remounted after the promote drain ran.
  function collectIntents(kind, myGen) {
    const out = [];
    for (const [id, rec] of cards) {
      if (disposed || gen !== myGen) break;
      const last = rec.lastEvalScale;
      if (last != null && last > 0
          && Math.abs(currentScale - last) < scaleEpsilon * last) continue;
      let intent = null;
      try { intent = rec.handle.evaluate(); } catch (_) { intent = null; }
      if (!intent) { rec.lastEvalScale = currentScale; continue; }   // settled at this scale
      // Action card (promote or demote): leave lastEvalScale stale until it
      // actually runs (advanced in drainBatches). Off-viewport promotes are
      // dropped but also left stale, so a pan onto screen re-evaluates them.
      if (intent.kind !== kind) continue;
      if (kind === 'promote' && !intent.inViewport) continue;
      out.push({ id, intent });
    }
    out.sort((a, b) => (b.intent.area || 0) - (a.intent.area || 0));
    return out;
  }

  async function drainBatches(items, myGen, kind) {
    let i = 0;
    while (i < items.length) {
      if (disposed || gen !== myGen) return;
      if (isGestureActive()) return;
      // A demote that started before a fresh settle would race the next zoom —
      // bail and let the new settle's drain decide.
      if (kind === 'demote' && now() - lastSettleAt < demoteIdleMs) return;
      const batch = items.slice(i, i + maxConcurrent);
      i += maxConcurrent;
      await Promise.all(batch.map(async ({ id, intent }) => {
        if (disposed || gen !== myGen) return;
        const rec = cards.get(id);
        if (!rec) return;                    // unregistered (unmounted) mid-drain
        let committed = false;
        try { committed = (await intent.run()) === true; } catch (_) {}
        // Advance lastEvalScale ONLY when the swap actually committed. A demote
        // that aborts (target won't presign/decode, or a gesture superseded it
        // mid-batch) must stay re-evaluatable — otherwise the card is
        // epsilon-skipped forever at this scale and stuck on the larger tier.
        if (committed) rec.lastEvalScale = currentScale;
      }));
      if (i < items.length && !disposed && gen === myGen) {
        await new Promise((resolve) => { batchTimer = setTimer(resolve, batchGapMs); });
      }
    }
  }

  async function runPromoteDrain(myGen) {
    promoteIdle = null;
    if (disposed || gen !== myGen || isGestureActive()) return;
    await drainBatches(collectIntents('promote', myGen), myGen, 'promote');
  }

  async function runDemoteDrain(myGen) {
    demoteIdle = null;
    if (disposed || gen !== myGen || isGestureActive()) return;
    // Only when genuinely idle: a settle since this was scheduled moved the
    // clock forward, so we're still mid-interaction — skip. Re-evaluate fresh
    // (not a promote-time snapshot) so late-loading / remounted cards demote.
    if (now() - lastSettleAt < demoteIdleMs) return;
    await drainBatches(collectIntents('demote', myGen), myGen, 'demote');
  }

  return {
    register(cardId, handle) {
      if (disposed || !cardId || !handle) return () => {};
      cards.set(cardId, { handle, lastEvalScale: null });
      return () => { cards.delete(cardId); };
    },

    // Called once per gesture settle with the settled canvas scale. Supersedes
    // any pending drains (gen bump + clear) and (re)schedules a promote drain
    // at +promoteDelayMs and a demote drain at +demoteIdleMs. Rapid settles
    // (thrash) keep pushing both out, so nothing swaps until interaction stops.
    onSettle(scale) {
      if (disposed) return;
      if (typeof scale === 'number' && scale > 0) currentScale = scale;
      lastSettleAt = now();
      gen += 1;
      const myGen = gen;
      clearTimers();
      promoteTimer = setTimer(() => {
        promoteTimer = null;
        promoteIdle = requestIdle(() => { runPromoteDrain(myGen); });
      }, promoteDelayMs);
      demoteTimer = setTimer(() => {
        demoteTimer = null;
        demoteIdle = requestIdle(() => { runDemoteDrain(myGen); });
      }, demoteIdleMs);
    },

    // A gesture (re)started: abort everything in flight. The gesture's own
    // settle (always emitted at gesture end) reschedules the drains.
    onGesture() {
      if (disposed) return;
      gen += 1;
      clearTimers();
    },

    dispose() {
      disposed = true;
      clearTimers();
      cards.clear();
    },
  };
}

// App-wide singleton — one coordinator for every canvas image card. Lazily
// constructed (with the browser deps + the real gesture probe) so importing
// this module costs nothing until the first card registers.
let _singleton = null;
export function getImageTierScheduler() {
  if (_singleton) return _singleton;
  // Lazily resolve the real gesture deadline + settle signal via dynamic
  // import, so this file imports nothing at module load (the factory unit-tests
  // in bare Node). Both land in a microtask — long before any zoom settle, and
  // settles only fire after the user interacts.
  let gestureProbe = () => false;
  import('./perfReport.js')
    .then((m) => {
      gestureProbe = () => {
        try { return performance.now() < m.getGestureActiveUntil(); } catch (_) { return false; }
      };
    })
    .catch(() => {});
  const sched = createImageTierScheduler({ isGestureActive: () => gestureProbe() });
  _singleton = sched;
  // ONE settle subscription for the whole app (vs the old ~70 per-card ones):
  // every canvas gesture settle drives one onSettle with the settled scale.
  import('./canvasScale.js')
    .then((cs) => { cs.onCanvasSettle(() => sched.onSettle(cs.getCanvasScale())); })
    .catch(() => {});
  return _singleton;
}
