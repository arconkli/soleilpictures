// Open the review player from anywhere (components/film/PlayerHost.jsx):
//   openPlayer({ boardId, cardId, versionId?, frame?, time?, playing?, commentId?, card? })
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

// The board cards' own players, by card id, so an opener that isn't the card
// (its right-click menu) can start the review where the card is.
//   registerCardPlayer(cardId, { getState, pause }) → unregister
const cardPlayers = new Map();

export function registerCardPlayer(cardId, handle) {
  if (!cardId || !handle) return () => {};
  cardPlayers.set(cardId, handle);
  return () => { if (cardPlayers.get(cardId) === handle) cardPlayers.delete(cardId); };
}

// Where the card's player is ({ time, playing } or null), pausing it — the
// review carries on from there. A card nobody has played or moved says
// nothing, so the review starts the clip as it would from anywhere else.
export function takeCardPlayer(cardId) {
  const h = cardPlayers.get(cardId);
  const st = h?.getState?.() || null;
  if (!st || !Number.isFinite(st.time) || (!st.touched && !st.playing)) return null;
  try { h.pause?.(); } catch (_) {}
  return { time: st.time, playing: !!st.playing };
}
