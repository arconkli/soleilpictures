// How long after sending a message its author can still edit it. The app
// enforces this (the Edit button, the `e` key, ↑ in an empty box); the docs
// read it as {{fact:messageEditWindowMin}}.
export const MESSAGE_EDIT_WINDOW_MIN = 15;

export function withinEditWindow(createdAt, now = Date.now()) {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && now - t < MESSAGE_EDIT_WINDOW_MIN * 60 * 1000;
}

// The message ↑ edits from an empty composer: your newest one that can still
// be edited — sent (not on its way, not failed), a message rather than a
// system line, and inside the window. Null when there's none.
export function lastEditableMessage(rows, selfId, now = Date.now()) {
  for (let i = (rows?.length || 0) - 1; i >= 0; i -= 1) {
    const m = rows[i];
    if (m?.sender_id !== selfId) continue;
    if (m.sendState || m.deleted_at || (m.kind && m.kind !== 'user')) continue;
    return withinEditWindow(m.created_at, now) ? m : null;
  }
  return null;
}
