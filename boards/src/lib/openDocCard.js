// Open a doc card that was just placed.
//
// Only a MOUNTED DocCard hears 'soleil-open-doc-card', and the canvas mounts
// only the cards in view — a document placed beside everything else on a board
// is usually off screen, and the event would reach nobody. So: centre it first
// (the canvas's 'soleil-flash-card', which selects and pans to a card), wait
// until its node is in the page, give its effects a beat to attach the
// listener, then open it — in the layout the person last chose (DocCard's
// openRemembered: full screen for anyone who has never docked).
//
// DOM only through `doc`, so it tests under node with a fake document.

export function openDocWhenMounted({
  boardId, cardId, doc = globalThis.document,
  schedule = (fn, ms) => setTimeout(fn, ms), tries = 40, every = 75,
} = {}) {
  if (!doc || !boardId || !cardId) return false;
  const emit = (type, detail) => doc.dispatchEvent(new CustomEvent(type, { detail }));
  emit('soleil-flash-card', { boardId, cardId });
  const esc = globalThis.CSS?.escape ? globalThis.CSS.escape(cardId) : String(cardId).replace(/["\\]/g, '\\$&');
  let n = 0;
  const tick = () => {
    if (doc.querySelector(`[data-card-id="${esc}"]`)) {
      schedule(() => emit('soleil-open-doc-card', { cardId, pageId: null, scrollTop: 0 }), 60);
      return;
    }
    if (n++ < tries) schedule(tick, every);
  };
  schedule(tick, 120);
  return true;
}
