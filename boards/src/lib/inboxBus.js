// Process-wide pubsub for inbox-ping events.
//
// useInboxLive() owns the single Supabase channel for `user:{uid}` and
// pushes each payload through this bus. Multiple hooks (the inbox list,
// the unread badge, the toast host) subscribe to the same userId and
// react independently — no duplicate channels, no prop drilling.
//
// Pattern mirrors the listener-set in useBoardPreview.js — a Map of
// userId → Set<listener> with explicit subscribe / publish helpers.

const listeners = new Map(); // userId -> Set<fn(payload)>

export function subscribeInbox(userId, fn) {
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

export function publishInbox(userId, payload) {
  const set = listeners.get(userId);
  if (!set) return;
  for (const fn of set) {
    try { fn(payload); } catch (e) { console.warn('[inboxBus] listener threw', e); }
  }
}
