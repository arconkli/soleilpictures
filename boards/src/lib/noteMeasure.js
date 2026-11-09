// Offscreen text measurer for note cards. One source of truth for the
// "how tall does this note need to be at width W" question, shared by:
//   - the drag-resize reflow path (height follows width while resizing)
//   - the right-click "Fit to content" action
//   - the post-edit / font-load re-measure in RichNoteEditor
//
// The measurer lays the note's html out off-screen inside the same structure
// a read-mode note has: a shallow copy of the live .note (its classes and its
// inline font vars) around a fresh .note-body, so every .note-body rule
// (blank lines, list indents, heading sizes, checklists, preview cards)
// applies exactly as on the canvas. A classless copy missed all of them and
// measured short, so a resized or fitted note opened under "Show all".
// Create it once per gesture, call cardHeightAt() per move (one layout read
// on a single offscreen node), and destroy() when the gesture ends.

// .note chrome between card bounds and the text box: 14px padding on each
// side plus the 1px border (border-box sizing), per .note in styles.css.
export const NOTE_INNER_PAD = 30;

// Card height floor — keep in sync with MIN_H in CanvasSurface.
const MIN_CARD_H = 40;

export function createNoteMeasurer(bodyEl) {
  if (!bodyEl) return null;
  const note = bodyEl.closest?.('.note') || null;
  // While the note is being edited, its link-preview cards are drawn beside
  // the editor (.note-edit-previews), not in it; read mode draws them inside
  // .note-body (they are part of card.html), so that is where they go here.
  const previews = note?.querySelector('.note-edit-previews');
  // Shallow copy: classes and inline style (fontFamily, fontSize,
  // --note-font-size, is-balanced, has-bg…), no children, no React props.
  const shell = note ? note.cloneNode(false) : document.createElement('div');
  if (!note) shell.className = 'note';
  shell.removeAttribute('id');
  shell.classList.remove('is-editing', 'is-overflowing');
  shell.setAttribute('aria-hidden', 'true');
  // The face can come from the canvas (inherited) as well as from the card,
  // so pin what the live note resolved. Longhands, not the `font` shorthand:
  // getComputedStyle().font is "" in Chrome.
  const cs = window.getComputedStyle(note || bodyEl);
  Object.assign(shell.style, {
    position: 'absolute', left: '-99999px', top: '0',
    width: '1px', height: 'auto', minHeight: '0', maxHeight: 'none',
    visibility: 'hidden',
    pointerEvents: 'none',
    transition: 'none',
    fontFamily: cs.fontFamily,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    fontFeatureSettings: cs.fontFeatureSettings,
    fontVariantNumeric: cs.fontVariantNumeric,
  });
  const el = document.createElement('div');
  el.className = 'note-body';
  el.innerHTML = bodyEl.innerHTML + (previews ? previews.innerHTML : '');
  shell.appendChild(el);
  document.body.appendChild(shell);
  // The body's own content height. It is a block formatting context
  // (overflow-y: auto), so its children's margins are inside it; the larger
  // of the two reads never comes out a fraction of a pixel short.
  const contentH = () => Math.ceil(Math.max(el.scrollHeight, el.getBoundingClientRect().height));
  return {
    // True when the note has no text to reflow (empty sticky used as a
    // visual block) — callers should fall back to free resize.
    isEmpty: bodyEl.innerText.trim().length === 0,
    // Card height needed so the body fits its content at card width w. The
    // width is the card's (border-box .note), so the body gets w minus the
    // note's padding and border, as on the canvas.
    cardHeightAt(cardW) {
      shell.style.width = `${Math.max(NOTE_INNER_PAD + 1, cardW)}px`;
      return Math.max(MIN_CARD_H, contentH() + NOTE_INNER_PAD);
    },
    // Unwrapped longest-line content width (for "Fit to content").
    naturalWidth() {
      shell.style.width = 'max-content';
      return Math.ceil(el.scrollWidth);
    },
    destroy() { shell.remove(); },
  };
}

// Card height for a live .note-body element measured in place (no clone).
// Used by RichNoteEditor where the element itself already has the right
// width; scrollHeight there is the content height inside the padding box.
export function cardHeightForBody(bodyEl) {
  if (!bodyEl) return MIN_CARD_H;
  return Math.max(MIN_CARD_H, Math.ceil(bodyEl.scrollHeight) + NOTE_INNER_PAD);
}

// Card height for a live .note-body measured from its CONTENT, not its box.
// While a note is being edited the body is flex:1 and fills the card, so its
// scrollHeight is never below the card's own height: a note measured that way
// could only grow. The span from the first block's top margin edge to the last
// block's bottom margin edge, plus the body's padding, is what the text needs.
// Rects are divided by the body's on-screen scale so the canvas zoom (a CSS
// transform) cancels out, and the result is in layout px like card.h.
export function cardHeightForContent(bodyEl) {
  if (!bodyEl) return MIN_CARD_H;
  const first = bodyEl.firstElementChild;
  const last = bodyEl.lastElementChild;
  if (!first || !last || !bodyEl.offsetHeight) return cardHeightForBody(bodyEl);
  const scale = bodyEl.getBoundingClientRect().height / bodyEl.offsetHeight;
  if (!(scale > 0)) return cardHeightForBody(bodyEl);
  const px = (v) => parseFloat(v) || 0;
  const cs = window.getComputedStyle(bodyEl);
  const fcs = window.getComputedStyle(first);
  const lcs = last === first ? fcs : window.getComputedStyle(last);
  const span = (last.getBoundingClientRect().bottom - first.getBoundingClientRect().top) / scale;
  const content = span + px(fcs.marginTop) + px(lcs.marginBottom) + px(cs.paddingTop) + px(cs.paddingBottom);
  return Math.max(MIN_CARD_H, Math.ceil(content) + NOTE_INNER_PAD);
}
