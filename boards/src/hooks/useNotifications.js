// The bell: persistent notifications.
//
// Reads public.notifications (0242), which unlike share_notifications and
// mention_notifications is NOT a toast queue — rows survive until read, so
// someone who missed the toast for a file shared with them still finds it
// later. It also read the caller's upcoming schedule until schedules were
// retired (owner, 2026-10-20).
//
// Live updates arrive through notificationBus rather than a Supabase channel of
// our own: notification pings share the `user:{uid}` topic useInboxLive already
// owns, and opening a second channel on that topic would throw (v2 dedupes by
// topic and .on() after subscribe is an error).

import { useCallback, useEffect, useRef, useState } from 'react';
import { listNotifications, markNotificationsRead } from '../lib/boardsApi.js';
import { subscribeNotifications } from '../lib/notificationBus.js';
import { maybeShowNotification } from '../lib/browserNotifications.js';
import { fileSharesAllowed, sharedFilesAllowed } from '../lib/appHost.js';
import { openSharedFile } from '../lib/sharedFileBus.js';

export function useNotifications({ userId, feedback = null, onOpenBoard = null } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const onOpenRef = useRef(onOpenBoard);
  const feedbackRef = useRef(feedback);
  useEffect(() => { onOpenRef.current = onOpenBoard; }, [onOpenBoard]);
  useEffect(() => { feedbackRef.current = feedback; }, [feedback]);

  const refresh = useCallback(async () => {
    if (!userId) { setItems([]); return; }
    setLoading(true);
    try {
      setItems(await listNotifications({ limit: 50 }));
    } catch (e) {
      console.warn('[notifications] list failed', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Live pings: prepend optimistically so the badge moves on the same frame.
  useEffect(() => {
    if (!userId) return undefined;
    return subscribeNotifications(userId, (payload) => {
      setItems((prev) => {
        if (prev.some((x) => x.id === payload.id)) return prev;   // realtime can double-deliver
        return [{ ...payload, read_at: null }, ...prev].slice(0, 50);
      });
      const openIt = () => { try { onOpenRef.current?.(payload.board_id); } catch (_) {} };
      const fileToken = fileSharesAllowed() && String(payload.kind || '').startsWith('file.') ? payload.data?.token : null;
      try {
        feedbackRef.current?.toast({
          type: 'info',
          message: `${payload.title}${payload.body ? ` — ${payload.body}` : ''}`,
          ttl: 8000,
          action: fileToken
            ? { label: 'Open', onClick: () => (sharedFilesAllowed()
                ? openSharedFile({ token: fileToken, via: 'toast' })
                : window.open('/f/' + encodeURIComponent(fileToken), '_blank', 'noopener')) }
            : (payload.board_id ? { label: 'Open', onClick: openIt } : undefined),
        });
      } catch (_) {}
      // Only fires when the tab is hidden/unfocused and permission was granted.
      maybeShowNotification({ title: payload.title, body: payload.body || '', tag: `ntf:${payload.id}`, onClick: openIt });
    });
  }, [userId]);

  const unread = items.reduce((n, x) => n + (x.read_at ? 0 : 1), 0);

  // Optimistic: the badge should clear on click, not after a round trip. A
  // failed write reconciles on the next refresh rather than bouncing the UI.
  const markRead = useCallback(async (ids = null) => {
    const stamp = new Date().toISOString();
    setItems((prev) => prev.map((x) => (
      (!ids || ids.includes(x.id)) && !x.read_at ? { ...x, read_at: stamp } : x
    )));
    try { await markNotificationsRead(ids); } catch (e) { console.warn('[notifications] mark read failed', e); }
  }, []);

  return { items, unread, loading, refresh, markRead };
}
