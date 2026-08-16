// Where each mounted schedule card is currently LOOKING.
//
// Navigation used to be a card write: clicking › ran updateCard({anchor}), so
// paging to next month moved the view for every collaborator and pushed an undo
// entry. That is merely annoying on a private board and unusable on a
// production calendar shared with a hundred crew, so anchor/anchorHour became
// local component state — the card field is now the SAVED DEFAULT, not the live
// position.
//
// That split breaks one thing, quietly. graftScheduleIntoSlot (App.jsx) drags a
// Day-view schedule card onto another card's day slot and lifts the source's
// items by computing a key prefix from the source's anchor — read off the Y.Map:
//
//     const srcAnchor = srcCy.get('anchor') || todayISO();
//
// With local navigation that field no longer says what the user can see. A card
// showing July 20 still persists July 1, so the graft would lift the wrong day's
// items, or find none under the prefix and silently refuse the drag. Neither
// failure is visible; both look like the drag "just didn't work".
//
// So mounted cards publish their live position here and the mutator reads it,
// falling back to the persisted field for cards that aren't mounted. Same shape
// as getCanvasScale(): a module singleton read at the moment of an interaction,
// deliberately not React state — the mutator runs outside the render tree.

const live = new Map(); // cardId -> { anchor, anchorHour }

export function setViewAnchor(cardId, view) {
  if (!cardId || !view || !view.anchor) return;
  live.set(cardId, { anchor: view.anchor, anchorHour: view.anchorHour ?? 9 });
}

export function clearViewAnchor(cardId) {
  if (cardId) live.delete(cardId);
}

// Null when the card isn't mounted (off-screen, another board, a headless
// write) — callers MUST fall back to the persisted card fields.
export function getViewAnchor(cardId) {
  return (cardId && live.get(cardId)) || null;
}

// Test seam: the QA bridge asserts that navigating a card updates what a graft
// would read, which is the whole point of this module existing.
export function __viewAnchorCount() { return live.size; }
