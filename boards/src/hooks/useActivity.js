// What this tab is moving (lib/activity.js), for components. Each hook returns
// a value that stays the same until what it names changes.

import { useSyncExternalStore } from 'react';
import { subscribeActivity, activitySnapshot, cardTransferKey, transferCardIds } from '../lib/activity.js';

export function useActivity() {
  return useSyncExternalStore(subscribeActivity, activitySnapshot, activitySnapshot);
}

export function useCardTransferKey(cardId) {
  return useSyncExternalStore(subscribeActivity, () => cardTransferKey(cardId), () => '');
}

// The clusters this tab is still sending something to (waiting, running or
// finishing, not parked), as one sorted, comma-joined string: a primitive, so
// progress ticks don't re-render. Workspace presence carries it (App).
const ACTIVE = new Set(['waiting', 'running', 'finishing']);
let boardsMemo = { snap: null, key: '' };
function uploadingBoardsKey() {
  const snap = activitySnapshot();
  if (boardsMemo.snap === snap) return boardsMemo.key;
  const ids = new Set();
  for (const it of snap.items) {
    if (it.boardId && ACTIVE.has(it.state) && !it.parked) ids.add(it.boardId);
  }
  boardsMemo = { snap, key: [...ids].sort().join(',') };
  return boardsMemo.key;
}
export function useUploadingBoardIds() {
  return useSyncExternalStore(subscribeActivity, uploadingBoardsKey, () => '');
}

export function useTransferCardIds() {
  return useSyncExternalStore(subscribeActivity, transferCardIds, transferCardIds);
}
