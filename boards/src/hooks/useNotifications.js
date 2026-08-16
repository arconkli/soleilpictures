// The bell: persistent notifications + the caller's upcoming schedule.
//
// Reads public.notifications (0242), which unlike share_notifications and
// mention_notifications is NOT a toast queue — rows survive until read, so a
// crew member who missed the 21:40 call-sheet toast still finds it at 06:00.
//
// Live updates arrive through notificationBus rather than a Supabase channel of
// our own: schedule pings share the `user:{uid}` topic useInboxLive already
// owns, and opening a second channel on that topic would throw (v2 dedupes by
// topic and .on() after subscribe is an error).

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listNotifications, markNotificationsRead, listMySchedule,
} from '../lib/boardsApi.js';
import { subscribeNotifications } from '../lib/notificationBus.js';
import { maybeShowNotification } from '../lib/browserNotifications.js';

export function useNotifications({ userId, feedback = null, onOpenBoard = null } = {}) {
  const [items, setItems] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(false);

  const onOpenRef = useRef(onOpenBoard);
  const feedbackRef = useRef(feedback);
  useEffect(() => { onOpenRef.current = onOpenBoard; }, [onOpenBoard]);
  useEffect(() => { feedbackRef.current = feedback; }, [feedback]);

  const refresh = useCallback(async () => {
    if (!userId) { setItems([]); setSchedule([]); return; }
    setLoading(true);
    try {
      // Independent: an unreachable schedule must not blank the notification
      // list, and vice versa.
      const [n, s] = await Promise.allSettled([listNotifications({ limit: 50 }), listMySchedule(null, 90)]);
      if (n.status === 'fulfilled') setItems(n.value);
      else console.warn('[notifications] list failed', n.reason);
      if (s.status === 'fulfilled') setSchedule(s.value);
      else console.warn('[notifications] schedule failed', s.reason);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Live pings: prepend optimistically so the badge moves on the same frame,
  // then reconcile the schedule (a move changes a date the list is showing).
  const scheduleTimer = useRef(null);
  useEffect(() => {
    if (!userId) return undefined;
    return subscribeNotifications(userId, (payload) => {
      setItems((prev) => {
        if (prev.some((x) => x.id === payload.id)) return prev;   // realtime can double-deliver
        return [{ ...payload, read_at: null }, ...prev].slice(0, 50);
      });
      const openIt = () => { try { onOpenRef.current?.(payload.board_id); } catch (_) {} };
      try {
        feedbackRef.current?.toast({
          type: 'info',
          message: `${payload.title}${payload.body ? ` — ${payload.body}` : ''}`,
          ttl: 8000,
          action: payload.board_id ? { label: 'Open', onClick: openIt } : undefined,
        });
      } catch (_) {}
      // Only fires when the tab is hidden/unfocused and permission was granted.
      maybeShowNotification({ title: payload.title, body: payload.body || '', tag: `sched:${payload.board_id}`, onClick: openIt });
      clearTimeout(scheduleTimer.current);
      scheduleTimer.current = setTimeout(() => {
        listMySchedule(null, 90).then(setSchedule).catch(() => {});
      }, 400);
    });
  }, [userId]);
  useEffect(() => () => clearTimeout(scheduleTimer.current), []);

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

  return { items, schedule, unread, loading, refresh, markRead };
}
