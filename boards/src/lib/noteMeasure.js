// Offscreen text measurer for note cards. One source of truth for the
// "how tall does this note need to be at width W" question, shared by:
//   - the drag-resize reflow path (height follows width while resizing)
//   - the right-click "Fit to content" action
//   - the post-edit / font-load re-measure in RichNoteEditor
//
// The measurer clones the live .note-body HTML into a hidden node that
// inherits the same computed font metrics, so wrapping matches what the
// canvas renders. Create it once per gesture (clone + style copy are the
// expensive part), call cardHeightAt() per move (one cheap layout read on
// a single offscreen node), and destroy() when the gesture ends.

// .note chrome between card bounds and the text box: 14px padding on each
// side plus the 1px border (border-box sizing), per .note in styles.css.
export const NOTE_INNER_PAD = 30;

// Card height floor — keep in sync with MIN_H in CanvasSurface.
const MIN_CARD_H = 40;

export function createNoteMeasurer(bodyEl) {
  if (!bodyEl) return null;
  const cs = window.getComputedStyle(bodyEl);
  const el = document.createElement('div');
  el.innerHTML = bodyEl.innerHTML;
  Object.assign(el.style, {
    position: 'absolute', left: '-99999px', top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    maxWidth: 'none',
    boxSizing: 'content-box',
    // Longhands, not the `font` shorthand — getComputedStyle().font is ""
    // in Chrome, which silently measured with the default UA font.
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing,
    wordSpacing: cs.wordSpacing,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  });
  document.body.appendChild(el);
  return {
    // True when the note has no text to reflow (empty sticky used as a
    // visual block) — callers should fall back to free resize.
    isEmpty: bodyEl.innerText.trim().length === 0,
    // Card height needed so the body fits its content at card width w.
    cardHeightAt(cardW) {
      el.style.width = `${Math.max(1, cardW - NOTE_INNER_PAD)}px`;
      return Math.max(MIN_CARD_H, Math.ceil(el.scrollHeight) + NOTE_INNER_PAD);
    },
    // Unwrapped longest-line content width (for "Fit to content").
    naturalWidth() {
      el.style.width = 'max-content';
      return Math.ceil(el.scrollWidth);
    },
    destroy() { el.remove(); },
  };
}

// Card height for a live .note-body element measured in place (no clone).
// Used by RichNoteEditor where the element itself already has the right
// width; scrollHeight there is the content height inside the padding box.
export function cardHeightForBody(bodyEl) {
  if (!bodyEl) return MIN_CARD_H;
  return Math.max(MIN_CARD_H, Math.ceil(bodyEl.scrollHeight) + NOTE_INNER_PAD);
}
