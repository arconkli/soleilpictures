// Canonical "is the user actively typing in an editor?" predicate, shared by
// every window-level keyboard / paste / pointer guard so the behavior is
// identical across surfaces (canvas, app shell, notes, docs).
//
// The naive `e.target.isContentEditable` check is brittle: in TipTap /
// ProseMirror the event target can be an element whose nearest ancestor is
// contenteditable but the target itself isn't, so a single check falls through
// (the canvas used to spawn a duplicate note from clipboard text). Four
// belt-and-suspenders signals cover it: form fields, the target's own
// contenteditable flag, the nearest contenteditable ancestor, the active
// element, and a live selection parked inside a contenteditable (covers cases
// where both target and activeElement are document.body but the caret is
// inside an editor).
export function isEditableTarget(e) {
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
