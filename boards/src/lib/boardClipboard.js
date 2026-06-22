// In-memory clipboard for a single BOARD. Survives within a tab session; not
// synced across tabs/devices. Stores lightweight board METADATA only — the
// Y.Doc snapshot is re-read from storage at paste time (see pasteBoardInto in
// App.jsx) so the paste always reflects the board's latest saved state.
//
// Unlike clipboard.js (cards), there's no OS-clipboard sentinel: board paste is
// menu-driven (right-click → "Paste into this board"), not ⌘V-driven, so we
// never need to disambiguate it from something the user copied in another app.

let _board = null;   // { boardId, name, view, cover, meta } | null
let _copiedAt = 0;   // Date.now() of the last setBoardClipboard call

export function setBoardClipboard(board) {
  _board = board ? { ...board } : null;
  _copiedAt = Date.now();
}

export function getBoardClipboard() {
  return _board ? { ..._board } : null;
}

export function boardClipboardSize() { return _board ? 1 : 0; }
export function boardClipboardCopiedAt() { return _copiedAt; }

export function clearBoardClipboard() {
  _board = null;
  _copiedAt = 0;
}
