// A note's whole-note text size (card.fontSize) and whether it renders.
//
// For a long time it never did: .note-body set its own 15px, which beat the
// size inline on .note, so a whole-note size pick, the caret-only − / +, and
// Settings → Defaults → Notes all changed nothing on screen (NOTES-05). The
// size now reaches the text through --note-font-size (styles.css).
//
// But the stored values from that era were never seen by anyone. Some are
// workspace defaults copied onto every new note, some are the residue of
// clicking + again and again while nothing happened. Every such note was
// auto-fitted to its text at 15px, so rendering those sizes now would clip
// them under a "Show all" chip, or leave dead space, or blow one up, on boards
// nobody touched. So a size only renders when it was written by a build that
// renders it, which stamps `fontSizeV`. An unstamped fontSize keeps the look
// it has always had (15px text), until someone picks a size again.
//
// Kept free of React so the canvas chunk and the node tests can import it.

export const NOTE_FONT_SIZE_V = 2;

// The card patch for a whole-note size pick.
export function noteFontSizePatch(px) {
  return { fontSize: px, fontSizeV: NOTE_FONT_SIZE_V };
}

// A note's card-level font as inline style on .note. fontSize stays inline on
// .note exactly as before (whatever inherits from .note keeps it); only a
// stamped size goes out as --note-font-size, the one the text reads.
export function noteFontStyle(fontFamily, fontSize, fontSizeV) {
  const s = {};
  if (fontFamily) s.fontFamily = fontFamily;
  if (fontSize) {
    s.fontSize = `${fontSize}px`;
    if (fontSizeV === NOTE_FONT_SIZE_V) s['--note-font-size'] = `${fontSize}px`;
  }
  return s;
}
