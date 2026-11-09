// Typing a note on a phone or tablet. NoteTiptapSurface uses all of it; the
// canvas uses revealDelta; the keyboard keeper (cards.jsx, step 4) uses
// noteTypingAttrs so the field that raises the keyboard types the same way.
// Pure apart from the window and elements it is handed.

import { wordAt } from './noteEntryPoint.js';

export function coarsePointer(win = typeof window !== 'undefined' ? window : null) {
  try { return !!win?.matchMedia?.('(pointer: coarse)')?.matches; } catch (_) { return false; }
}

// The note editor's typing attributes. On a computer native spellcheck stays
// off: its squiggles don't follow the board's zoom (NoteTiptapSurface explains).
// On a phone or tablet the keyboard's autocorrect, capitals and spellcheck are
// how people type, so they are on there. Grammarly is off everywhere (the
// editor sets that itself).
export function noteTypingAttrs(win = typeof window !== 'undefined' ? window : null) {
  return coarsePointer(win)
    ? { spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' }
    : { spellcheck: 'false' };
}

// Where the line being typed can be seen, in client px: inside the visual
// viewport (the keyboard is laid over the page and shrinks it, see
// lib/keyboardInset.js), inside the board, and above the note bar, which sits
// on the keyboard on touch. `margin` keeps the line off those edges. null when
// there is no room, and while the page is pinch-zoomed (keyboardInset's rule).
export function typingBand(win, boardEl, barEl, margin = 12) {
  if (!win) return null;
  const vv = win.visualViewport;
  if (vv && (vv.scale || 1) > 1.01) return null;
  let top = vv ? vv.offsetTop : 0;
  let bottom = vv ? vv.offsetTop + vv.height : win.innerHeight;
  const b = boardEl?.getBoundingClientRect?.();
  if (b && b.height > 0) { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
  // A bar in the lower half of what shows covers everything under it.
  const bar = barEl?.getBoundingClientRect?.();
  if (bar && bar.height > 0 && bar.top < bottom && bar.top > top + (bottom - top) / 2) bottom = bar.top;
  top += margin;
  bottom -= margin;
  return bottom > top ? { top, bottom } : null;
}

// The caret's rect held inside the note's box. In a note that scrolls, the
// note's own scroll shows the caret; the board only ever brings the note's
// edge into view.
export function clampToBox(rect, box) {
  if (!rect) return null;
  if (!box) return { top: rect.top, bottom: rect.bottom };
  const clamp = (v) => Math.min(Math.max(v, box.top), box.bottom);
  return { top: clamp(rect.top), bottom: clamp(rect.bottom) };
}

// How far the board moves (px, + is down) so [rect.top, rect.bottom] sits in
// the band; 0 when it already does. A caret taller than the band shows its top.
export function revealDelta(rect, band) {
  if (!rect || !band) return 0;
  let dy = 0;
  if (rect.bottom > band.bottom) dy = band.bottom - rect.bottom;
  if (rect.top + dy < band.top) dy = band.top - rect.top;
  return Math.abs(dy) < 1 ? 0 : Math.round(dy);
}

// Whether the keyboard starts on a capital for typing at a point in a note's
// text: 'sentences' at the start of a line or after the end of a sentence,
// 'none' inside one. `before` is the line's text up to the point, `after` the
// text right after it. The keyboard keeper (lib/touchKeyboard.js) is an empty
// field, so a phone capitalises the first thing typed into it; the editor
// itself knows the text around its caret and needs none of this. A point
// inside a word goes to the word's nearer edge (a tie to its end), as the
// editor puts the caret, by the editor's own idea of a word (wordAt, in
// lib/noteEntryPoint.js: "don't" is one word).
export function keeperCapitals(before = '', after = '') {
  const text = before + after;
  let at = before.length;
  const w = wordAt(text, at);
  if (w && at > w[0] && at < w[1]) at = at - w[0] < w[1] - at ? w[0] : w[1];
  const upTo = text.slice(0, at);
  return !/\S/u.test(upTo) || /[.!?…]["'”’)\]]*\s*$/u.test(upTo) ? 'sentences' : 'none';
}

// What ends a line in a note's reading body, walking back from a point.
const LINE_EDGE = /^(BR|P|DIV|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE|TABLE|TR|TD|TH|HR)$/;

// keeperCapitals for a client point over a note's reading body (the tap that
// opens it): the text of its line before the point, back to a line break or
// the start of its block, and the text right after it. 'sentences' when no
// note text is under the point.
export function keeperCapitalsAt(doc, x, y) {
  try {
    let node = null;
    let offset = 0;
    if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(x, y);
      node = p?.offsetNode;
      offset = p?.offset || 0;
    } else if (doc.caretRangeFromPoint) {
      const r = doc.caretRangeFromPoint(x, y);
      node = r?.startContainer;
      offset = r?.startOffset || 0;
    }
    if (!node || node.nodeType !== 3) return 'sentences';
    const body = node.parentElement?.closest('.note-body');
    if (!body) return 'sentences';
    let before = node.data.slice(0, offset);
    const after = node.data.slice(offset);
    const edge = (n) => n.nodeType === 1 && (LINE_EDGE.test(n.nodeName) || n.classList?.contains('ck-box'));
    let n = node;
    for (let guard = 0; guard < 500; guard++) {
      if (n.previousSibling) {
        n = n.previousSibling;
        while (n.nodeType === 1 && !edge(n) && n.lastChild) n = n.lastChild;
        if (edge(n)) break;
        if (n.nodeType === 3) before = n.data + before;
      } else {
        n = n.parentNode;
        if (!n || n === body || edge(n)) break;
      }
    }
    return keeperCapitals(before, after);
  } catch (_) {
    return 'sentences';
  }
}
