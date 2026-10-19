// moveFailure — a move into another cluster that fails (App.jsx's
// 'soleil-card-into-board-drop' listener, and the local harness's twin of it).
//
// It says so ONCE, here: the side the cards came from keeps them and adds
// nothing — it used to add a second error under the first. A cluster made for
// these cards ("New cluster from N cards", the top bar's popover, the Studio
// bar) goes too, so a failed try leaves no empty cluster behind. It goes to
// the trash FIRST, and only then does its card leave the source (the caller
// drops it when the error says `createdBoardTrashed`): App's drift reconcile
// puts back the card of any live child that has none. A cluster the trash
// refused stays, card and all, and the message is the step's own.

export const MOVE_FAIL_TTL = 8000;

export const madeClusterFailMessage = (name) =>
  `Couldn’t make “${name || 'Untitled cluster'}”. Your cards are still here — try again.`;

// Resolves to the error to reject the move with. `acked`: the source was
// already told it may let go, so the cluster holds the cards and stays.
export async function failMove({
  err, message, createdBoardId = null, createdBoardName = null, acked = false, trash = null, toast,
}) {
  let trashed = false;
  if (createdBoardId && !acked && typeof trash === 'function') {
    try { await trash(createdBoardId); trashed = true; } catch (_) { /* it stays, and the step's message says why */ }
  }
  try {
    toast?.({ type: 'error', ttl: MOVE_FAIL_TTL, message: trashed ? madeClusterFailMessage(createdBoardName) : message });
  } catch (_) {}
  const out = err instanceof Error ? err : new Error(String(err ?? 'move failed'));
  out.createdBoardTrashed = trashed;
  return out;
}
