// Open the file-share dialog from anywhere (the host listens):
//   openFileShare({ boardId, cardId, card, boardName, surface })
// `card` is a snapshot for a cluster that isn't open in a pane.
import { docSharesAllowed, fileSharesAllowed } from './appHost.js';
import { isShareableCard, isShareableDoc } from './fileShares.js';

export const FILE_SHARE_EVENT = 'soleil-open-file-share';

// Edit rights for any cluster, registered by the signed-in app shell, so a
// viewer opened far from a pane (the tag view, a hover popover) can still
// offer Share. Public pages never register one, so they never offer it.
let rightsResolver = null;
export function setShareRightsResolver(fn) { rightsResolver = typeof fn === 'function' ? fn : null; }
export function canShareIn(boardId) {
  if (!boardId || !rightsResolver) return false;
  try { return !!rightsResolver(boardId); } catch (_) { return false; }
}

// A viewer's share target for a file known only by reference (an index row:
// its cluster, its card id, the stored ref), or null when it can't be shared
// from here.
export function shareTargetForRef({ boardId, cardId, kind = 'image', src = null, name = null } = {}, surface = null) {
  if (!boardId || !cardId || !fileSharesAllowed() || !canShareIn(boardId)) return null;
  const card = { id: cardId, kind, src, title: name || undefined };
  if (!isShareableCard(card)) return null;
  return { boardId, cardId, card, boardName: null, surface };
}

// A doc card's menu row (the canvas and the list), held with the rest of doc
// sharing: the label, or null when it can't be shared from here.
export function docShareLabel(card) {
  return docSharesAllowed() && isShareableDoc(card) ? 'Share doc…' : null;
}

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
