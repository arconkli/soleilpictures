// Open the file-share dialog from anywhere (the host listens):
//   openFileShare({ boardId, cardId, card, boardName, surface })
// `card` is a snapshot for a cluster that isn't open in a pane.
export const FILE_SHARE_EVENT = 'soleil-open-file-share';

export function openFileShare(detail) {
  if (typeof document === 'undefined' || !detail?.boardId || !detail?.cardId) return;
  document.dispatchEvent(new CustomEvent(FILE_SHARE_EVENT, { detail }));
}

// A share's settings changed (the dialog wrote one): every "Share / Shared"
// button and the /f/ page for that file re-read.
export const FILE_SHARE_CHANGED_EVENT = 'soleil-file-share-changed';

export function notifyFileShareChanged({ boardId, cardId } = {}) {
  if (typeof document === 'undefined' || !boardId || !cardId) return;
  document.dispatchEvent(new CustomEvent(FILE_SHARE_CHANGED_EVENT, { detail: { boardId, cardId } }));
}
