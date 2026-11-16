// imageTierScheduler.js — decides WHEN and HOW MANY image cards may change
// their decoded variant: after a canvas zoom/pan settle, and after a wave of
// first paints goes quiet.
//
// Background: each canvas image card (R2Image) holds a decoded texture for its
// current rung (xs ~256w / sm 640w / lg 1280w / original). When the user
// zooms, the on-screen size of every card changes, so cards want to promote
// (zoomed in → sharper) or demote (zoomed out → smaller). The OLD design ran
// that decision per-card in its own effect on every settle: one settle woke
// ~70 effects in the same idle window → 70 forced layouts + 70 texture swaps,
// each re-rastering its slice of the single GPU-promoted .canvas layer. At
// fit-all (whole board visible) that was a multi-hundred-ms compositor raster
// storm — the "everything DIES" freeze, GPU-bound with an idle main thread.
//
// This module is the single coordinator. Cards REGISTER a handle and stop
// acting on their own; the scheduler drains tier transitions with a budget:
//   - Two triggers. onSettle (a gesture ended) schedules a promote drain
//     ~promoteDelayMs later and a demote drain after demoteIdleMs of quiet.
//     notePaint (a card painted its first picture — often the quick xs rung)
//     opens a "paint wave": every paint re-arms one quiet timer (paintQuietMs,
//     but never past paintQuietCapMs from the wave's first paint, so a board
//     that keeps streaming in still sharpens), and when it fires the wave's
//     cards climb to what the screen needs. A wave is not interaction: it
//     does not move the demote idle clock.
//   - PROMOTES go only to cards whose rect still intersects the viewport (a
//     card the cull is about to unmount never wastes a decode), nearest the
//     viewport centre first, so the middle of the screen sharpens first.
//   - DEMOTES are memory hygiene, not visual — they fire only after
//     demoteIdleMs of NO settle/gesture (every settle pushes the clock out),
//     so a thrash never demotes mid-interaction. Each demote probe-decodes its
//     target before the swap (the card's run() owns that), so a loaded image
//     never re-blurs. Largest on-screen area first.
//   - A drain is a worker pool: at most maxConcurrent transitions in flight,
//     the next starting as soon as any finishes (lock-step batches waited on
//     the slowest download of each batch). A committed swap holds its slot
//     batchGapMs (~1 frame) longer, so the compositor flushes between
//     invalidations.
//   - run() returning 'step' means the card climbed one rung on its way to a
//     bigger one (lg on the way to the original): the same drain measures it
//     again and keeps climbing, without waiting for the next settle.
//   - A card whose canvas scale moved <scaleEpsilon since its last evaluation
//     is skipped (a pan-only settle re-measures nothing — no 70 no-op gBCRs),
//     and a card whose transition is still running is never collected twice.
//   - A resumed gesture aborts the whole in-flight queue (onGesture); cards
//     keep their current tier, and the gesture's own settle reschedules. A
//     drain that bailed only because the gesture deadline was still running
//     (no onGesture/onSettle moved the generation) tries again by itself.
//   - nudge() / touch(cardId) ask for a fresh look without a settle: a card
//     whose box changed, or a freed original slot, opens a paint wave and the
//     card is measured again once it goes quiet.
//
// Pure + dependency-injected (clock, timers, idle, gesture probe) so the
// policy is unit-testable without a browser — see imageTierScheduler.test.mjs
// and image-tier-scheduler.spec.js. The card handle carries all DOM/meta
// knowledge; the scheduler owns only timing and budget.
//
// Card handle shape (provided by R2Image at register):
//   evaluate(): null | {
//     kind: 'promote' | 'demote',
//     area: number,        // on-screen device-px area (demotes: largest first)
//     dist: number,        // card centre → viewport centre (promotes: nearest first)
//     inViewport: boolean, // from the ONE gBCR it took at execution time
//     run: () => true | 'step' | false | Promise<…>,
//                          // true = committed; 'step' = committed one rung,
//                          // measure again; anything else = aborted, stays
//                          // re-evaluatable. Re-checks gesture internally.
//   }
//
// NOTE: this file imports NOTHING at module load — like partyTokenRefresh.js,
// the factory is pure so it unit-tests in the bare Node test process. The
// singleton's gesture probe and device checks are pulled in via lazy dynamic
// import()s that only fire when getImageTierScheduler() is first called in
// the browser.

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
  // A number, or a function returning one — read when each drain starts, so a
  // device check that lands late still counts.
  maxConcurrent = 4,
  promoteDelayMs = 150,
  demoteIdleMs = 1500,
  batchGapMs = 16,
  scaleEpsilon = 0.10,
  paintQuietMs = 300,
  paintQuietCapMs = 1500,
} = {}) {
  let disposed = false;
  // Generation: bumped on every settle, wave and gesture so any in-flight
  // drain from a superseded trigger bails on its next checkpoint.
  let gen = 0;
  let currentScale = 1;
  let lastSettleAt = 0;
  let promoteTimer = null;
  let demoteTimer = null;
  let promoteIdle = null;
  let demoteIdle = null;
  // The paint wave's quiet timer and first-paint time. Kept out of
  // clearTimers: a settle must not swallow a wave that is still arriving.
  let quietTimer = null;
  let waveStart = null;
  // The current generation's promote drain while it runs, so a card whose
  // swap finished under a superseded drain can join it.
  let activePromote = null;
  // cardId → { handle, lastEvalScale, running }. lastEvalScale advances ONLY
  // when a card needs no further action at the scale it was measured at
  // (intent 'none', or after a swap commits) — a card with a still-pending
  // promote/demote stays re-evaluatable, so a pan-only settle in the
  // demote-wait window can't silently cancel a queued demote, and a card that
  // loads/remounts AFTER the promote drain still gets demoted by the (fresh)
  // demote drain. `running` is true while its run() is in flight.
  const cards = new Map();

  function clearTimers() {
    if (promoteTimer != null) { clearTimer(promoteTimer); promoteTimer = null; }
    if (demoteTimer != null) { clearTimer(demoteTimer); demoteTimer = null; }
    if (promoteIdle != null) { try { cancelIdle(promoteIdle); } catch (_) {} promoteIdle = null; }
    if (demoteIdle != null) { try { cancelIdle(demoteIdle); } catch (_) {} demoteIdle = null; }
  }

  function readMax() {
    let n = maxConcurrent;
    try { if (typeof n === 'function') n = n(); } catch (_) { n = 4; }
    n = Math.floor(Number(n));
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }

  // Promotes: nearest the viewport centre first; an intent without a distance
  // falls back to largest area, after those that have one.
  function byDistance(a, b) {
    const da = Number.isFinite(a.intent.dist) ? a.intent.dist : null;
    const db = Number.isFinite(b.intent.dist) ? b.intent.dist : null;
    if (da != null && db != null) return da - db;
    if (da != null) return -1;
    if (db != null) return 1;
    return (b.intent.area || 0) - (a.intent.area || 0);
  }
  function byArea(a, b) { return (b.intent.area || 0) - (a.intent.area || 0); }

  function wanted(kind, intent) {
    return !!intent && intent.kind === kind && (kind !== 'promote' || !!intent.inViewport);
  }

  // Evaluate every epsilon-eligible card (one gBCR each) and collect the
  // intents matching this drain's kind. Promotes additionally require the card
  // to still be in the viewport (no wasted decode for a card the cull is about
  // to drop). lastEvalScale advances ONLY for cards that need no action this
  // scale — a card with a still-pending action stays re-evaluatable, so (a) a
  // pan-only settle can't cancel a queued demote, and (b) the demote drain
  // re-evaluates fresh at idle time, catching cards that loaded/remounted after
  // the promote drain ran. A card whose run() is in flight is left alone: it
  // is mid-swap, and is measured again when that lands.
  function collectIntents(kind, myGen) {
    const out = [];
    for (const [id, rec] of cards) {
      if (disposed || gen !== myGen) break;
      if (rec.running) continue;
      const last = rec.lastEvalScale;
      if (last != null && last > 0
          && Math.abs(currentScale - last) < scaleEpsilon * last) continue;
      const evalScale = currentScale;
      let intent = null;
      try { intent = rec.handle.evaluate(); } catch (_) { intent = null; }
      if (!intent) { rec.lastEvalScale = evalScale; continue; }   // settled at this scale
      // Action card (promote or demote): leave lastEvalScale stale until it
      // actually runs. Off-viewport promotes are dropped but also left stale,
      // so a pan onto screen re-evaluates them.
      if (!wanted(kind, intent)) continue;
      out.push({ id, rec, intent, evalScale });
    }
    out.sort(kind === 'promote' ? byDistance : byArea);
    return out;
  }

  // Whether a drain may start its next item: the checks the old lock-step
  // batches made before each batch, now made before each item.
  function mayContinue(d) {
    if (disposed || gen !== d.gen) return false;
    if (isGestureActive()) return false;
    // A demote that started before a fresh settle would race the next zoom —
    // bail and let the new settle's drain decide.
    if (d.kind === 'demote' && now() - lastSettleAt < demoteIdleMs) return false;
    return true;
  }

  // The worker pool over d.queue: start items while fewer than d.max are in
  // flight; each finished item frees its slot and pumps again, so one slow
  // download never holds up the rest of the drain.
  function pump(d) {
    while (d.inFlight < d.max && d.queue.length) {
      if (!mayContinue(d)) {
        d.queue.length = 0;
        rearmIfGestureOnly(d);
        break;
      }
      const item = d.queue.shift();
      const rec = cards.get(item.id);
      // Unregistered (unmounted) or re-registered since it was collected, or
      // mid-swap under another drain.
      if (!rec || rec !== item.rec || rec.running) continue;
      d.inFlight += 1;
      runItem(d, item, rec);
    }
    if (!d.done && d.inFlight === 0 && d.queue.length === 0) {
      d.done = true;
      if (activePromote === d) activePromote = null;
      d.resolve();
    }
  }

  async function runItem(d, item, rec) {
    rec.running = true;
    let result = false;
    try { result = await item.intent.run(); } catch (_) { result = false; } finally { rec.running = false; }
    const committed = result === true || result === 'step';
    // Advance lastEvalScale ONLY when the swap committed for good, and to the
    // scale the card was measured at (a zoom since leaves it eligible). A swap
    // that aborts (target won't presign/decode, or a gesture superseded it)
    // must stay re-evaluatable — otherwise the card is epsilon-skipped forever
    // at this scale and stuck on the wrong tier. A 'step' stays stale too:
    // the card is not where it wants to be yet.
    if (result === true) rec.lastEvalScale = item.evalScale;
    // Hold the slot one frame after a committed swap so the compositor
    // flushes between invalidations. A plain promise, not a stored timer:
    // several workers wait at once, and the pump re-checks everything after.
    if (committed && !disposed) await new Promise((resolve) => { setTimer(resolve, batchGapMs); });
    if (committed && !disposed && cards.get(item.id) === rec) {
      if (gen === d.gen) {
        if (result === 'step') requeue(d, item.id, rec);
      } else {
        rejoin(item.id, rec);
      }
    }
    d.inFlight -= 1;
    pump(d);
  }

  // A 'step' in a live drain: measure again at once and, if the card still
  // wants the same kind of move, put it at the front so the climb continues
  // (it was nearest the centre a moment ago).
  function requeue(d, id, rec) {
    if (!mayContinue(d)) { rearmIfGestureOnly(d); return; }
    const evalScale = currentScale;
    let next = null;
    try { next = rec.handle.evaluate(); } catch (_) { next = null; }
    if (!next) { rec.lastEvalScale = evalScale; return; }
    if (wanted(d.kind, next)) d.queue.unshift({ id, rec, intent: next, evalScale });
  }

  // A swap that committed under a superseded drain: the drain that superseded
  // it skipped the card while it ran. Hand it to the current promote drain if
  // one is running, or start one if none is on its way, so the card is never
  // left below its need until some later settle.
  function rejoin(id, rec) {
    if (disposed) return;
    if (activePromote && activePromote.gen === gen && !activePromote.done) {
      requeue(activePromote, id, rec);
      pump(activePromote);
      return;
    }
    if (promoteTimer != null || promoteIdle != null) return;   // one is coming and will collect it
    idlePromote(gen);
  }

  function drain(items, myGen, kind) {
    return new Promise((resolve) => {
      const d = { gen: myGen, kind, queue: items, inFlight: 0, max: readMax(), done: false, resolve };
      if (kind === 'promote') activePromote = d;
      pump(d);
    });
  }

  // A drain that bailed ONLY because a gesture deadline was still running (the
  // generation is unchanged, so no settle is coming to reschedule it) tries
  // again after the same delay its trigger used. It stops as soon as the
  // generation moves on or dispose runs: clearTimers clears these timers, and
  // the callbacks re-check the generation before doing anything.
  function rearmAfterGesture(kind, myGen) {
    if (disposed || gen !== myGen) return;
    if (kind === 'promote') {
      if (promoteTimer != null || promoteIdle != null) return;
      promoteTimer = setTimer(() => {
        promoteTimer = null;
        idlePromote(myGen);
      }, promoteDelayMs);
    } else {
      if (demoteTimer != null || demoteIdle != null) return;
      demoteTimer = setTimer(() => {
        demoteTimer = null;
        idleDemote(myGen);
      }, demoteIdleMs);
    }
  }

  function rearmIfGestureOnly(d) {
    if (!disposed && gen === d.gen && isGestureActive()) rearmAfterGesture(d.kind, d.gen);
  }

  async function runPromoteDrain(myGen) {
    promoteIdle = null;
    if (disposed || gen !== myGen) return;
    if (isGestureActive()) { rearmAfterGesture('promote', myGen); return; }
    await drain(collectIntents('promote', myGen), myGen, 'promote');
  }

  async function runDemoteDrain(myGen) {
    demoteIdle = null;
    if (disposed || gen !== myGen) return;
    if (isGestureActive()) { rearmAfterGesture('demote', myGen); return; }
    // Only when genuinely idle: a settle since this was scheduled moved the
    // clock forward, so we're still mid-interaction — skip. Re-evaluate fresh
    // (not a promote-time snapshot) so late-loading / remounted cards demote.
    if (now() - lastSettleAt < demoteIdleMs) return;
    await drain(collectIntents('demote', myGen), myGen, 'demote');
  }

  // Keep the idle id only while the callback is still pending: an idle that
  // runs synchronously (the fakes) must not leave a stale id that reads as
  // "a drain is on its way".
  function idlePromote(myGen) {
    let ran = false;
    const id = requestIdle(() => { ran = true; runPromoteDrain(myGen); });
    if (!ran) promoteIdle = id;
  }
  function idleDemote(myGen) {
    let ran = false;
    const id = requestIdle(() => { ran = true; runDemoteDrain(myGen); });
    if (!ran) demoteIdle = id;
  }

  function scheduleDemote(myGen) {
    demoteTimer = setTimer(() => {
      demoteTimer = null;
      idleDemote(myGen);
    }, demoteIdleMs);
  }

  // A paint wave went quiet: climb now. Like a settle minus the interaction:
  // lastSettleAt stays put (a wave is not the user moving) and the promote
  // drain skips promoteDelayMs (nothing is about to move again).
  function kick() {
    if (disposed) return;
    gen += 1;
    const myGen = gen;
    clearTimers();
    idlePromote(myGen);
    scheduleDemote(myGen);
  }

  function notePaint(scale) {
    if (disposed) return;
    if (typeof scale === 'number' && scale > 0) currentScale = scale;
    const t = now();
    if (waveStart == null) waveStart = t;
    if (quietTimer != null) clearTimer(quietTimer);
    const wait = Math.max(0, Math.min(paintQuietMs, waveStart + paintQuietCapMs - t));
    quietTimer = setTimer(() => {
      quietTimer = null;
      waveStart = null;
      kick();
    }, wait);
  }

  return {
    register(cardId, handle) {
      if (disposed || !cardId || !handle) return () => {};
      const rec = { handle, lastEvalScale: null, running: false };
      cards.set(cardId, rec);
      // Drop only this registration: a remount that re-registered the same id
      // must not lose its record to the old mount's cleanup.
      return () => { if (cards.get(cardId) === rec) cards.delete(cardId); };
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
        idlePromote(myGen);
      }, promoteDelayMs);
      scheduleDemote(myGen);
    },

    // A card painted its first picture at canvas scale `scale`. The first
    // paint opens a wave; each paint re-arms the quiet timer for paintQuietMs,
    // never past paintQuietCapMs after the wave began.
    notePaint,

    // Ask for a fresh look without a paint or a settle: opens or extends a
    // paint wave exactly like notePaint, leaving the canvas scale alone, so
    // the cards climb (or demote) in one coalesced kick once it goes quiet.
    // For a freed original slot.
    nudge() { notePaint(); },

    // A registered card's box changed (a grid cell's crop zoom, Fit/Fill, a
    // resize) at the same canvas scale: forget the scale it was last measured
    // at, so the next drain evaluates it, and nudge. Unknown ids and a
    // disposed scheduler are ignored.
    touch(cardId) {
      if (disposed) return;
      const rec = cards.get(cardId);
      if (!rec) return;
      rec.lastEvalScale = null;
      notePaint();
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
      if (quietTimer != null) { clearTimer(quietTimer); quietTimer = null; }
      waveStart = null;
      activePromote = null;
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
  // Lazily resolve the real gesture deadline, settle signal and device checks
  // via dynamic import, so this file imports nothing at module load (the
  // factory unit-tests in bare Node). All land in a microtask — long before
  // any zoom settle, and settles only fire after the user interacts.
  let gestureProbe = () => false;
  import('./perfReport.js')
    .then((m) => {
      gestureProbe = () => {
        try { return performance.now() < m.getGestureActiveUntil(); } catch (_) { return false; }
      };
    })
    .catch(() => {});
  // Constrained devices (low memory, Save-Data or 2G) run two transitions at
  // once instead of four; four until device.js lands.
  let constrained = () => false;
  import('./device.js')
    .then((d) => {
      constrained = () => {
        try { return d.lowMemoryDevice() || d.constrainedConnection(); } catch (_) { return false; }
      };
    })
    .catch(() => {});
  const sched = createImageTierScheduler({
    isGestureActive: () => gestureProbe(),
    maxConcurrent: () => (constrained() ? 2 : 4),
  });
  _singleton = sched;
  // ONE settle subscription for the whole app (vs the old ~70 per-card ones):
  // every canvas gesture settle drives one onSettle with the settled scale.
  import('./canvasScale.js')
    .then((cs) => { cs.onCanvasSettle(() => sched.onSettle(cs.getImageTierScale())); })
    .catch(() => {});
  return _singleton;
}
