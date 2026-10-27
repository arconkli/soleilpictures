// What a board room's document may forget (party/board.ts builds its
// documents with roomGcFilter). Plain JS in src/lib so it is tested
// (roomGc.test.mjs), as boardRoomState.js is.
//
// The room keeps deleted content because the R2 orphan sweep reads every
// stored board for the file keys in it (_r2_keys_in_doc): a deleted card's keys
// must stay readable there while undo, version history and the trash can still
// bring the card back, or the sweep deletes the files. So the room ran with gc
// off, which keeps EVERYTHING ever deleted, and that grows without bound. A note
// writes its whole html onto its card on every keystroke (NoteTiptapSurface's
// write-through), and each keystroke's copy stayed. On 2026-10-26 one cluster's
// state reached 12 MB, almost all of it old copies of two notes; the room wrote
// all of it to board_state every few seconds, and the database ran out of
// memory and restarted five times, taking the app down for everyone each time.
//
// A deleted item is collected only when nothing can need it:
//   - never a type (a card, a note's text, a paragraph): collecting one
//     collects everything under it without asking this filter;
//   - never anything under a deleted type: a deleted card keeps every field;
//   - never a value that names a file (r2:), so every key the sweep sees with gc
//     off it still sees;
//   - never content this can't read (binary, a subdocument).
// What goes is what any Yjs server forgets: an overwritten value on a live card
// (the note's html, its height, a position), a deleted stroke, deleted letters.

const JSON_CONTENT = 2;
const STRING = 4;
const EMBED = 5;
const FORMAT = 6;
const ANY = 8;

const FILE = 'r2:';

function namesFile(content, ref) {
  if (ref === STRING) return String(content.str).includes(FILE);
  if (ref === FORMAT) return String(content.key).includes(FILE) || JSON.stringify(content.value ?? null).includes(FILE);
  if (ref === EMBED) return JSON.stringify(content.embed ?? null).includes(FILE);
  return JSON.stringify(content.arr ?? null).includes(FILE);
}

// Yjs asks this before it collects a deleted item: true lets it go. Anything
// unexpected keeps the item, which is only ever the old behaviour.
export function roomGcFilter(item) {
  try {
    const content = item?.content;
    const ref = typeof content?.getRef === 'function' ? content.getRef() : -1;
    if (ref !== ANY && ref !== STRING && ref !== JSON_CONTENT && ref !== EMBED && ref !== FORMAT) return false;
    for (let t = item.parent; ; ) {
      if (!t || typeof t !== 'object' || !('_item' in t)) return false;
      const own = t._item;
      if (own === null) break;
      if (own.deleted) return false;
      t = own.parent;
    }
    return !namesFile(content, ref);
  } catch (_) {
    return false;
  }
}
