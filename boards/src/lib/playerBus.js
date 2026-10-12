// Open the review player from anywhere (components/film/PlayerHost.jsx):
//   openPlayer({ boardId, cardId, versionId?, frame?, commentId?, card? })
// `card` is a snapshot for a cluster that isn't open in a pane.
export const PLAYER_EVENT = 'soleil-open-player';

export function openPlayer(detail) {
  if (typeof document === 'undefined' || !detail?.boardId || !detail?.cardId) return;
  document.dispatchEvent(new CustomEvent(PLAYER_EVENT, { detail }));
}

export function closePlayer() {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent(PLAYER_EVENT, { detail: { close: true } }));
}
