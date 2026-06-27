// Canonical "is the user actively typing in an editor?" predicate, shared by
// every window-level keyboard / paste / pointer guard so the behavior is
// identical across surfaces (canvas, app shell, notes, docs).
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

export function isEditableTarget(e) {
  // Ground-truth, race-free: scan the event's actual propagation path.
  if (typeof e?.composedPath === 'function') {
    const path = e.composedPath();
    if (path && path.length) {
      for (const el of path) {
        if (el === window || el === document) break;
        if (pathIsEditable(el)) return true;
      }
    }
  }

  const t = e?.target;
  const tag = t?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t?.isContentEditable) return true;
  if (t?.closest?.('[contenteditable="true"], [contenteditable=""]')) return true;
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
