import { useCallback, useEffect, useMemo, useReducer } from 'react';
import * as userProfiles from '../../lib/userProfiles.js';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { canvasThreads, threadUnread } from '../../lib/commentPins.js';

// The cluster's comments as the comment parts read them: the conversations
// (who wrote what, what is unread) and the box each hangs from. The pins,
// the open conversation and the list each build these on their own from the
// same rows. They arrive with the pins; the canvas itself reads only
// lib/commentCanvas.js.

// Who wrote it: me as the app knows me, anyone else from the profile cache.
function personFor(id, currentUser) {
  if (id && currentUser && id === currentUser.id) {
    return {
      name: currentUser.name || (currentUser.email ? currentUser.email.split('@')[0] : null) || 'You',
      color: currentUser.color || pickPresenceColor(id),
    };
  }
  const p = userProfiles.resolve(id);
  return {
    name: p?.name || (p?.email ? p.email.split('@')[0] : null) || 'Member',
    avatar: p?.avatar_url || p?.avatar || null,
    color: p?.color || pickPresenceColor(id || ''),
  };
}

// The cluster's conversations, oldest first, as the comment parts read them.
// A conversation put away by the old per-comment Hide reads as resolved (it
// lists under Resolved, and Reopen brings it back). `unread` is for open ones,
// and only once "when I last looked" is known: `viewsByRootId` is null until
// it has come back (and stays null if it could not be fetched), and until
// then nothing is unread.
export function useCanvasThreads({ comments, currentUser, viewsByRootId }) {
  const [tick, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => userProfiles.subscribe(bump), []);
  const meId = currentUser?.id || null;
  const meName = currentUser?.name || null;
  const meColor = currentUser?.color || null;
  return useMemo(() => {
    const me = meId ? { id: meId, name: meName, color: meColor } : null;
    return canvasThreads(comments, (id) => personFor(id, me)).map((t) => {
      const resolved = t.resolved || !!t.root.meta?.hidden;
      return { ...t, resolved, unread: !resolved && !!meId && !!viewsByRootId && threadUnread(t, meId, viewsByRootId?.get?.(t.id)) };
    });
    // tick: a name or a colour arrived in the profile cache
  }, [comments, viewsByRootId, meId, meName, meColor, tick]);
}

// A lookup of the canvas's cards, and the box each conversation hangs from.
export function useAnchorBoxes(cards, groupBox) {
  const byId = useMemo(() => {
    const m = new Map();
    for (const c of cards || []) if (c && c.id != null) m.set(c.id, c);
    return m;
  }, [cards]);
  const cardBox = useCallback((id) => {
    const c = byId.get(id);
    return c ? { x: c.x, y: c.y, w: c.w, h: c.h, rot: c.rotation || 0 } : null;
  }, [byId]);
  const resolvers = useMemo(() => ({ cardBox, groupBox }), [cardBox, groupBox]);
  return { byId, resolvers };
}
