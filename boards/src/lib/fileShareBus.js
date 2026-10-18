// Open the file-share dialog from anywhere (the host listens):
//   openFileShare({ boardId, cardId, card, boardName, surface })
// `card` is a snapshot for a cluster that isn't open in a pane.
export const FILE_SHARE_EVENT = 'soleil-open-file-share';

export function openFileShare(detail) {
  if (typeof document === 'undefined' || !detail?.boardId || !detail?.cardId) return;
  document.dispatchEvent(new CustomEvent(FILE_SHARE_EVENT, { detail }));
}
