// interactionClassify.js — the shared "was that click wasted?" core.
//
// Two signals, one implementation:
//   • DEAD — the click produced nothing. The single strongest "this looked
//            clickable and wasn't" evidence we have.
//   • RAGE — ≥3 clicks on the same target inside 1s, emitted once per burst.
//
// WHY THIS MODULE EXISTS: both lived inside landingMetrics.js, so only the
// PUBLIC pages could see a wasted click. journey.js recorded every in-app click
// as a plain 'click', which meant the product itself — the canvas, the thing
// people actually use — was the one surface that could not report its own
// friction. Extracted rather than copied so the two traces stay comparable:
// lp_trace and ps_trace share a record vocabulary, and one query spans both.
//
// TWO WAYS TO SPOT A DEAD CLICK, because the two surfaces are not alike:
//
//   1. STRUCTURAL (isInteractiveTarget) — is anything within 4 ancestor hops a
//      native control? Right for public marketing pages, which are documents:
//      real controls there really are <a>/<button>.
//
//   2. OUTCOME (createDeadClickWatcher) — did the app visibly change? Required
//      for the canvas, where nearly every real control is a <div> with a React
//      handler. The structural test would call all of them dead and bury the
//      true signal in noise. Instead: snapshot a cheap fingerprint, re-read it
//      once the app has had a beat to react, and only call the click dead if
//      nothing moved. It cannot produce a false positive from an unannotated
//      element, which is what makes the signal worth acting on.
//
// Pure + node-importable (no imports, DOM access guarded) — same discipline as
// journey.js and frictionSignal.js. Never throws into callers.

export const RAGE_WINDOW_MS  = 1000;   // ≥RAGE_MIN_CLICKS on one target inside this = rage
export const RAGE_MIN_CLICKS = 3;
export const DEAD_SETTLE_MS  = 180;    // give the app a beat to react before judging a click dead

const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY', 'LABEL']);

// Structural classifier (surface 1). A click is "dead" when nothing within 4
// ancestor hops is interactive — the visitor tried to act on something inert
// (screenshot-like image, plain heading).
export function isInteractiveTarget(el) {
  try {
    let node = el && el.nodeType === 1 ? el : (el ? el.parentElement : null);
    for (let i = 0; node && i < 4; i++) {
      const tag = node.tagName ? node.tagName.toUpperCase() : '';
      if (INTERACTIVE_TAGS.has(tag)) return true;
      const get = node.getAttribute ? (k) => node.getAttribute(k) : () => null;
      if (get('role') === 'button' || get('data-lp-cta') != null) return true;
      node = node.parentElement;
    }
  } catch (_) {}
  return false;
}

// Same-target burst counter. Returns the burst size on the click that TIPS it
// into rage (so the caller emits exactly one record per burst), else 0.
export function createRageDetector(now = () => Date.now()) {
  let tgt = null;
  let times = [];
  let fired = false;
  return function recordClick(target) {
    const t = now();
    if (tgt !== target) { tgt = target; times = []; fired = false; }
    times = times.filter((x) => t - x < RAGE_WINDOW_MS);
    if (times.length === 0) fired = false;   // burst over → a new one may fire again
    times.push(t);
    if (times.length >= RAGE_MIN_CLICKS && !fired) {
      fired = true;
      return times.length;
    }
    return 0;
  };
}

// A cheap, app-agnostic "did anything happen?" fingerprint, read straight off
// the DOM so no component has to be annotated (and no missing annotation can
// invent a dead click). Covers the outcomes a click in this app can have:
// navigation, selection, an overlay opening or closing, cards appearing or
// disappearing, and focus moving. Returns null when there is no DOM, which the
// watcher treats as "cannot judge" — never as "dead".
export function domActivityFingerprint() {
  if (typeof document === 'undefined') return null;
  try {
    const d = document;
    const sel      = d.querySelectorAll('.is-selected').length;
    const overlays = d.querySelectorAll('.modal-bg, .ctx-menu, .lightbox, [role="dialog"], .toast').length;
    const cards    = d.querySelectorAll('[data-card-id]').length;
    const ae = d.activeElement;
    const path = (typeof location !== 'undefined') ? (location.pathname + location.search) : '';
    return `${path}|${sel}|${overlays}|${cards}|${ae ? ae.tagName : ''}|${ae && ae.id ? ae.id : ''}`;
  } catch (_) { return null; }
}

// Outcome classifier (surface 2). `judge(cb)` samples the fingerprint now,
// re-samples after settleMs, and hands the caller 'dead' or 'click'.
//
// The caller is expected to stamp the record with the ORIGINAL click time — the
// verdict arrives late, but it describes the moment of the click.
export function createDeadClickWatcher({
  probe = domActivityFingerprint,
  schedule = (fn, ms) => setTimeout(fn, ms),
  settleMs = DEAD_SETTLE_MS,
} = {}) {
  return function judge(cb) {
    let before;
    try { before = probe(); } catch (_) { before = null; }
    // No fingerprint means no evidence. Report a plain click rather than
    // guessing — a false 'dead' costs more than a missed one.
    if (before == null) { cb('click'); return; }
    schedule(() => {
      let after;
      try { after = probe(); } catch (_) { after = null; }
      cb(after != null && after === before ? 'dead' : 'click');
    }, settleMs);
  };
}
