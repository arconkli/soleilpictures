// Renaming a file in Files (InlineRename, F2, the right-click menu). Pure:
// which field a card's name lives in, and the patch a rename writes.
//
// The name shown for a card comes from a different field per kind
// (lib/listItem.js), so a rename writes that one. Renaming changes what the
// card is called — never the file: downloads keep the original upload's name
// (cardAssetName.assetFilename prefers `fileName`). A PDF's `name` IS its
// original filename, so the first rename keeps it as `fileName` first.
// Notes are named by their text and can't be renamed.

export const RENAME_FIELD = Object.freeze({
  image: 'title', video: 'title', audio: 'title', file: 'title', link: 'title',
  doc: 'title', palette: 'title', schedule: 'title', grid: 'title',
  pdf: 'name', shape: 'label',
});

export const NAME_MAX = 200;

export function canRename(card) {
  return !!card && Object.prototype.hasOwnProperty.call(RENAME_FIELD, card.kind);
}

// One line, no control characters, trimmed, capped.
export function cleanName(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

// The patch for renaming `card` to `raw`, or null when there's nothing to do
// (can't rename, empty, or unchanged from `current` — the name shown now).
export function renamePatch(card, raw, current = '') {
  if (!canRename(card)) return null;
  const name = cleanName(raw);
  if (!name || name === cleanName(current)) return null;
  const field = RENAME_FIELD[card.kind];
  const patch = { [field]: name };
  if (card.kind === 'pdf' && !card.fileName && typeof card.name === 'string' && card.name.trim()) {
    patch.fileName = card.name.trim();
  }
  return patch;
}
