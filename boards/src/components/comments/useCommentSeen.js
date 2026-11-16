import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  commentSeenKey, readCommentSeen, openCommentSeen, markCommentSeen,
  subscribeCommentSeen, commentSeenVersion, threadUnread, threadNewest,
} from '../../lib/commentSeen.js';

// What this person has not read in one card's comments (a doc's or a
// note's), kept on this device (lib/commentSeen.js). The first look sets the
// baseline, so nothing from before it is new.
//   → { unread(thread) → bool, seen(thread) }   thread: a commentModel Thread
export function useCommentSeen({ userId, boardId, cardId }) {
  const key = commentSeenKey({ userId, boardId, cardId });
  const v = useSyncExternalStore(subscribeCommentSeen, commentSeenVersion, commentSeenVersion);
  useEffect(() => { if (key) openCommentSeen(key); }, [key]);
  // v: the record changed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rec = useMemo(() => readCommentSeen(key), [key, v]);
  const unread = useCallback((thread) => !!thread && !thread.resolved && threadUnread(thread, rec, userId), [rec, userId]);
  const seen = useCallback((thread) => {
    if (key && thread) markCommentSeen(key, thread.id, { at: threadNewest(thread) ?? undefined });
  }, [key]);
  return { unread, seen };
}
