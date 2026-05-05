// Save/restore the active selection in a contenteditable so toolbar buttons
// (which steal focus) can apply formatting to whatever was selected.

let savedRange = null;
let savedRoot = null;

export function captureSelection() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const r = sel.getRangeAt(0);
  let node = r.commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentNode;
  const editable = node.closest && node.closest('[contenteditable="true"]');
  if (editable) {
    savedRange = r.cloneRange();
    savedRoot = editable;
  }
}

export function clearSelection() {
  savedRange = null;
  savedRoot = null;
}

export function restoreSelection() {
  if (!savedRange || !savedRoot || !document.contains(savedRoot)) return false;
  try { savedRoot.focus(); } catch (_) { return false; }
  const sel = window.getSelection();
  sel.removeAllRanges();
  try {
    sel.addRange(savedRange);
    return true;
  } catch (_) { return false; }
}

export function withSelection(fn) {
  if (!restoreSelection()) return false;
  fn();
  // Re-capture after the action so subsequent operations target the new range.
  captureSelection();
  return true;
}

// Wrap the current selection in a span with the given inline styles.
// Falls back to extract+wrap if the selection crosses element boundaries.
export function wrapSelectionStyle(style) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const span = document.createElement('span');
  Object.assign(span.style, style);
  try {
    range.surroundContents(span);
  } catch (_) {
    const contents = range.extractContents();
    span.appendChild(contents);
    range.insertNode(span);
  }
  // Re-select the new span content
  const newRange = document.createRange();
  newRange.selectNodeContents(span);
  sel.removeAllRanges();
  sel.addRange(newRange);
}
