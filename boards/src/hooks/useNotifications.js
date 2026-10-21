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
// A line of its own: fileShareWiring.test.mjs pins the one above as it is.
import { editorLimitAllowed } from '../lib/appHost.js';
import { openSharedFile } from '../lib/sharedFileBus.js';
import { notificationTarget } from '../lib/notificationsBell.js';
import { noticeToastText, missedJoinedAsViewer } from '../lib/editorLimit.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

// Notices already toasted on this page, by id: realtime can deliver a ping
// twice, and the first load's look for missed ones can reach the same row.
const toasted = new Set();

export function useNotifications({ userId, feedback = null, onOpenBoard = null, onOpenSettings = null } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const onOpenRef = useRef(onOpenBoard);
  const onSettingsRef = useRef(onOpenSettings);
  const feedbackRef = useRef(feedback);
  const sweptFor = useRef(null);   // the userId whose first load was looked through
  useEffect(() => { onOpenRef.current = onOpenBoard; }, [onOpenBoard]);
  useEffect(() => { onSettingsRef.current = onOpenSettings; }, [onOpenSettings]);
  useEffect(() => { feedbackRef.current = feedback; }, [feedback]);

  // Optimistic: the badge should clear on click, not after a round trip. A
  // failed write reconciles on the next refresh rather than bouncing the UI.
  const markRead = useCallback(async (ids = null) => {
    const stamp = new Date().toISOString();
    setItems((prev) => prev.map((x) => (
      (!ids || ids.includes(x.id)) && !x.read_at ? { ...x, read_at: stamp } : x
    )));
    try { await markNotificationsRead(ids); } catch (e) { console.warn('[notifications] mark read failed', e); }
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) { setItems([]); return; }
    setLoading(true);
    try {
      const rows = await listNotifications({ limit: 50 });
      setItems(rows);
      // An edit link is claimed before the app subscribes to its pings, so
      // the notice that it let someone in as a viewer (0520) lands before
      // anyone listens. The first load shows the newest one missed, once.
      if (sweptFor.current !== userId) {
        sweptFor.current = userId;
        if (editorLimitAllowed()) {
          const missed = missedJoinedAsViewer(rows, { toasted });
          if (missed.length) {
            for (const n of missed) toasted.add(n.id);
            try { feedbackRef.current?.toast({ type: 'info', message: noticeToastText(missed[0]), ttl: 12000 }); } catch (_) {}
            markRead(missed.map((n) => n.id));
          }
        }
      }
    } catch (e) {
      console.warn('[notifications] list failed', e);
    } finally {
      setLoading(false);
    }
  }, [userId, markRead]);

  useEffect(() => { refresh(); }, [refresh]);

  // Live pings: prepend optimistically so the badge moves on the same frame.
  useEffect(() => {
    if (!userId) return undefined;
    return subscribeNotifications(userId, (payload) => {
      setItems((prev) => {
        if (prev.some((x) => x.id === payload.id)) return prev;   // realtime can double-deliver
        return [{ ...payload, read_at: null }, ...prev].slice(0, 50);
      });
      if (toasted.has(payload.id)) return;
      toasted.add(payload.id);
      const openIt = () => { try { onOpenRef.current?.(payload.board_id); } catch (_) {} };
      const fileToken = fileSharesAllowed() && String(payload.kind || '').startsWith('file.') ? payload.data?.token : null;
      // An editor-limit notice opens Settings › Members in its workspace.
      const target = notificationTarget(payload);
      const openSettings = target?.kind === 'settings'
        ? () => {
            try { logEvent(EV.EDITOR_LIMIT_NOTICE_OPEN, { via: 'toast' }); } catch (_) {}
            try { onSettingsRef.current?.(target.tab, target.workspaceId); } catch (_) {}
          }
        : null;
      try {
        feedbackRef.current?.toast({
          type: 'info',
          message: noticeToastText(payload),
          ttl: 8000,
          action: fileToken
            ? { label: 'Open', onClick: () => (sharedFilesAllowed()
                ? openSharedFile({ token: fileToken, via: 'toast' })
                : window.open('/f/' + encodeURIComponent(fileToken), '_blank', 'noopener')) }
            : openSettings ? { label: 'See who can edit', onClick: openSettings }
              : (payload.board_id ? { label: 'Open', onClick: openIt } : undefined),
        });
      } catch (_) {}
      // Only fires when the tab is hidden/unfocused and permission was granted.
      maybeShowNotification({ title: payload.title, body: payload.body || '', tag: `ntf:${payload.id}`, onClick: openIt });
    });
  }, [userId]);

  const unread = items.reduce((n, x) => n + (x.read_at ? 0 : 1), 0);

  return { items, unread, loading, refresh, markRead };
}
