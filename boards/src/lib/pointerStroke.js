// Hardened window-level pointer tracking for canvas tool gestures — freehand
// draw, erase, marquee-select, shape-drag, free-arrow.
//
// The card-drag path was already hardened against high-frequency input; these
// simpler tool gestures were not, which is exactly what froze Apple Pencil input
// on iPad:
//
//   • pointerId filtering — a resting palm or a second finger landing mid-stroke
//     fired pointermove/up too, corrupting the stroke and ending it early.
//   • rAF coalescing — a 240Hz Pencil drove one React setState + a full SVG
//     <path> rebuild on EVERY native event (O(n²) over a stroke) → the canvas
//     progressively slowed to a freeze.
//   • pointercancel — iOS Safari dispatches this (NOT pointerup) on palm
//     rejection / system gestures; the old handlers only listened for pointerup,
//     so on a cancel the window listeners leaked and the canvas stayed stuck in
//     draw mode forever.
//
// Contract:
//   onSample(ev)            — invoked at most once per animation frame with the
//                             latest pointermove. Expand ev.getCoalescedEvents()
//                             inside it to keep a Pencil line smooth (Safari and
//                             Chrome dispatch ~one move per frame and stash the
//                             high-frequency samples there).
//   onEnd(ev, { canceled }) — fires exactly once, on pointerup OR pointercancel.
//                             The caller does its own commit/abort here; check
//                             `canceled` to decide whether to keep partial work.
//   returns dispose()       — for an external abort (Escape). Tears down the
//                             listeners WITHOUT calling onEnd, so the caller can
//                             run its own abort cleanup alongside it.

export function trackStroke({ pointerId = null, onSample, onEnd }) {
  let rafId = 0;
  let pendingEv = null;
  let done = false;

  const flush = () => {
    rafId = 0;
    const ev = pendingEv;
    pendingEv = null;
    if (ev && !done) { try { onSample?.(ev); } catch (_) {} }
  };

  const onMove = (ev) => {
    if (done) return;
    if (pointerId != null && ev.pointerId !== pointerId) return; // palm / 2nd finger
    pendingEv = ev;
    if (!rafId) rafId = requestAnimationFrame(flush);
  };

  const teardown = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  };

  const finish = (ev, canceled) => {
    if (done) return;
    // pointerup/cancel for a different pointer (e.g. a palm lifting) must not
    // end the active stroke. pointercancel always carries the canceled pointer's
    // id, so this stays correct for genuine cancels.
    if (pointerId != null && ev && ev.pointerId !== pointerId) return;
    done = true;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    // Apply the final queued move synchronously so the committed result reflects
    // the last pointer position (the queued rAF was just canceled above).
    if (pendingEv) { try { onSample?.(pendingEv); } catch (_) {} pendingEv = null; }
    teardown();
    try { onEnd?.(ev, { canceled }); } catch (_) {}
  };

  const onUp = (ev) => finish(ev, false);
  const onCancel = (ev) => finish(ev, true);

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);

  return function dispose() {
    if (done) return;
    done = true;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    teardown();
  };
}
