// Canonical "is the user actively typing in an editor?" predicate, shared by
// every window-level keyboard / paste guard so the behavior is identical
// across surfaces (canvas, app shell, notes, docs).
//
// TWO exports, and the difference matters. isEditableTarget answers "is the
// user typing" — it consults focus and the live selection, which is what a
// keystroke or a paste needs, because those events have no meaningful target.
// isEditablePointerTarget answers "did this happen inside an editor" from the
// event alone. Pointer and drag guards MUST use that one: they have a precise
// target, and the caret's whereabouts are none of their business.
//
// The naive `e.target.isContentEditable` check is brittle: in TipTap /
// ProseMirror the event target can be an element whose nearest ancestor is
// contenteditable but the target itself isn't, so a single check falls through
// (the canvas used to spawn a duplicate note from clipboard text). The
// remaining belt-and-suspenders signals — target's own contenteditable flag,
// nearest contenteditable ancestor, activeElement, and a live selection parked
// in a contenteditable — each depend on focus/selection having settled, which
// is exactly what races during a paste (the intermittent "blank note" bug).
//
// PRIMARY signal: the event's own composedPath(). That is the real propagation
// chain the browser delivered this event along, from the actual target up
// through every ancestor — ground truth for "where did this happen", and immune
// to the focus/selection timing race. We read it synchronously inside the
// handler, while the event is still dispatching, so it's fully populated. The
// older signals stay as fallback so the predicate only ever gets stricter.
function pathIsEditable(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (el.matches?.('[contenteditable="true"], [contenteditable=""]')) return true;
  return false;
}

// "Did this event HAPPEN inside an editor?" — decided purely from the event's
// own propagation path and target. Nothing about where focus or the caret
// currently sits.
//
// This is the right question for POINTER events, which carry a precise target.
// The focus/selection fallbacks in isEditableTarget below are about the caret,
// not the event, so they answer TRUE for a click anywhere on the page while an
// editor holds the caret. That is correct for a keystroke and badly wrong for a
// click: with a document docked beside the canvas — the entire point of the
// dock — parking the caret in the doc made every canvas click a no-op, and the
// board looked frozen until something stole focus back.
export function isEditablePointerTarget(e) {
  // Bare `window` / `document` would be a ReferenceError anywhere without a
  // DOM — which made this module impossible to unit-test, and it is exactly
  // the kind of predicate that deserves tests.
  const W = typeof window !== 'undefined' ? window : undefined;
  const D = typeof document !== 'undefined' ? document : undefined;
  // Ground-truth, race-free: scan the event's actual propagation path.
  if (typeof e?.composedPath === 'function') {
    const path = e.composedPath();
    if (path && path.length) {
      for (const el of path) {
        if ((W && el === W) || (D && el === D)) break;
        if (pathIsEditable(el)) return true;
      }
    }
  }

  const t = e?.target;
  const tag = t?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t?.isContentEditable) return true;
  if (t?.closest?.('[contenteditable="true"], [contenteditable=""]')) return true;
  return false;
}

export function isEditableTarget(e) {
  if (isEditablePointerTarget(e)) return true;
  const ae = (typeof document !== 'undefined') ? document.activeElement : null;
  if (ae && (ae.isContentEditable || ae.closest?.('[contenteditable="true"]'))) return true;
  if (typeof window !== 'undefined') {
    const sel = window.getSelection?.();
    const anchor = sel?.anchorNode;
    const anchorEl = anchor?.nodeType === 3 ? anchor.parentElement : anchor;
    if (anchorEl?.closest?.('[contenteditable="true"]')) return true;
  }
  return false;
}
