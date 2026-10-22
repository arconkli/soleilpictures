// The arrow keys of a toolbar, as rules on plain values (hooks/useToolbarRoving
// does the DOM). A bar across walks on ← →, the tool rail on ↑ ↓, Home and End
// go to either end, and it comes round from the last control to the first.

// +1, -1, 'first', 'last', or null: the key isn't the bar's.
export function rovingMove(key, orientation = 'horizontal') {
  const down = orientation === 'vertical';
  if (key === (down ? 'ArrowDown' : 'ArrowRight')) return 1;
  if (key === (down ? 'ArrowUp' : 'ArrowLeft')) return -1;
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  return null;
}

export function rovingIndex(i, n, move) {
  if (move === 'first') return 0;
  if (move === 'last') return n - 1;
  return (i + move + n) % n;
}

const TEXTLIKE = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number', '']);
const OWN_ARROWS = new Set(['range', 'radio']);

// Does the control the key was pressed in keep it for itself? A text field
// moves its caret on ← → until the caret is at the edge the key points past
// (with nothing selected), and keeps Home and End and ↑ ↓; a slider and a
// radio keep every arrow; a list keeps ↑ ↓, and gives up ← → Home End, which on
// Windows would change its value. A button keeps nothing.
export function fieldKeepsKey(el, key) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
  if (role === 'slider' || role === 'spinbutton' || role === 'radio') return true;
  if (tag === 'SELECT') return key === 'ArrowUp' || key === 'ArrowDown';
  const isText = tag === 'TEXTAREA' || (tag === 'INPUT' && TEXTLIKE.has(String(el.type || '').toLowerCase()));
  if (tag === 'INPUT' && OWN_ARROWS.has(String(el.type || '').toLowerCase())) return true;
  if (!isText) return false;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return true;
  const { selectionStart: start, selectionEnd: end } = el;
  // A field that won't say where its caret is (a number field) keeps them.
  if (start == null || end == null) return true;
  if (start !== end) return true;
  const len = String(el.value ?? '').length;
  return key === 'ArrowRight' ? end < len : start > 0;
}
