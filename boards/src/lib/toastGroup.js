// Toasts that say the same thing once.
//
// Twenty-five photos dropped, then a network drop: every in-flight upload is
// refused on its own, and each refusal posted its own "Upload failed" toast —
// a column of identical red toasts down the right of the screen. A toast with
// a `group` key now joins the one already showing for that key: same toast,
// a count, the newest action, and its timer starts again (AppFeedback).
//
// `groups` is the provider's Map of group key -> { id, count } for the toasts
// still on screen. It is a plain synchronous Map rather than React state so
// two failures in the same tick still land on one toast.

// Where an incoming toast goes. Returns the toast id to use (newId for a fresh
// toast, the live one's id when merging), the count, and the message to show.
export function placeGroupedToast(groups, { group = null, message, groupMessage = null } = {}, newId) {
  const live = group ? groups.get(group) : null;
  if (!live) {
    if (group) groups.set(group, { id: newId, count: 1 });
    return { id: newId, count: 1, message, merged: false };
  }
  live.count += 1;
  const text = typeof groupMessage === 'function' ? groupMessage(live.count) : message;
  return { id: live.id, count: live.count, message: text || message, merged: true };
}

// A toast is leaving: whatever group it held is free, so the next toast for
// that key starts a new one instead of reviving a toast on its way out.
export function releaseToastGroup(groups, id) {
  for (const [key, v] of groups) if (v.id === id) groups.delete(key);
}
