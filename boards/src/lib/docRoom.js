// How much room a doc has where it is shown, decided from what DocSurface
// measures rather than from the device: a doc docked beside the board, or one
// of two side by side (lib/docPanes.js), can be as narrow as a phone's on any
// screen. A script's sheet keeps its true width wherever it is (its 6.0in
// column is what the paginator and the PDF count on), so a narrow paper fits
// the column instead, and prose takes the narrow margins.
//
// Each line gives a little on the way back (GIVE), so a scrollbar coming and
// going, or a pane a hair from the line, can't flip a layout back and forth.

export const SHEET_W = 816;       // 8.5in at 96dpi: DocPagination's PAGE_W
export const PAPER_PAD_X = 48;    // .doc-paper's own padding, 24px a side
export const TIGHT_W = 640;       // as narrow as a phone's: its margins (styles.css)
export const RAIL_ROOM_W = 840;   // the page list's 240px beside a 600px page
export const GIVE = 24;

// The paper, by its clientWidth: 'page' while an actual-size sheet fits it,
// 'narrow' once it doesn't, 'tight' when it is as narrow as a phone's. A paper
// not laid out yet (no width) keeps what it had.
export function paperRoom(width, prev = 'page') {
  if (!(width > 0)) return prev;
  const fits = SHEET_W + PAPER_PAD_X + (prev === 'page' ? 0 : GIVE);
  if (width >= fits) return 'page';
  return width <= TIGHT_W + (prev === 'tight' ? GIVE : 0) ? 'tight' : 'narrow';
}

// The surface, by its width: whether the page list fits beside a page.
export function railRoom(width, prev = true) {
  if (!(width > 0)) return prev;
  return width >= RAIL_ROOM_W + (prev ? 0 : GIVE);
}
