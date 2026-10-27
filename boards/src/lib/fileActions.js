// What a file's own page can ask of a board: Quick look's "Put both on
// board" (an email's attachments) and "Unpack into clusters" (a zip). Each
// board on screen registers what it can do while it can be changed
// (CanvasSurface), and a page asks before it offers the button: nothing
// registered for that board, nothing offered.

const boards = new Map();

export function setFileActions(boardId, actions) {
  const mine = { ...actions };
  boards.set(boardId, mine);
  return () => { if (boards.get(boardId) === mine) boards.delete(boardId); };
}

export const canPutFiles = (boardId) => typeof boards.get(boardId)?.putFiles === 'function';
export const putFiles = (boardId, files) => boards.get(boardId)?.putFiles?.(files);
export const canUnpackZip = (boardId) => typeof boards.get(boardId)?.unpackZip === 'function';
export const unpackZip = (boardId, file) => boards.get(boardId)?.unpackZip?.(file);
