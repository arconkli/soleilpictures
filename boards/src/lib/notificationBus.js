// Process-wide pubsub for schedule-ping events.
//
// Twin of inboxBus.js, and it exists for one specific reason: the transport is
// SHARED. Schedule notifications arrive on `user:{uid}` — the same Supabase
// broadcast topic useInboxLive already owns for messages — because that topic
// already has the right RLS (0081: substring(topic from 6)::uuid = auth.uid())
// and an app-wide subscriber.
//
// A second supabase.channel('user:'+uid) is NOT an option. Supabase v2 dedupes
// channels by topic, so the second caller gets the SAME channel object back,
// and calling .on() on an already-subscribed channel throws — a hazard both
// useInboxLive and useBoardList carry warnings about. So useInboxLive adds the
// 'schedule-ping' listener alongside 'inbox-ping' and republishes here, and
// the bell subscribes to this instead of to Supabase.

const listeners = new Map(); // userId -> Set<fn(payload)>

export function subscribeNotifications(userId, fn) {
  if (!userId || typeof fn !== 'function') return () => {};
  let set = listeners.get(userId);
  if (!set) { set = new Set(); listeners.set(userId, set); }
  set.add(fn);
  return () => {
    const cur = listeners.get(userId);
    if (!cur) return;
    cur.delete(fn);
    if (cur.size === 0) listeners.delete(userId);
  };
}

export function publishNotification(userId, payload) {
  const set = listeners.get(userId);
  if (!set) return;
  for (const fn of set) {
    try { fn(payload); } catch (e) { console.warn('[notificationBus] listener threw', e); }
  }
}
