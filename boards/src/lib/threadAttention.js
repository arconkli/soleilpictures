// Is the reader actually looking at a conversation right now? Pure (the
// document is injectable), so node --test can pin it.
//
// The inbox used to stay quiet for whichever conversation was last OPEN —
// App's openConversationId, which survives closing the panel — and never
// asked whether the tab was even in front. Close the panel, or switch to
// another app, and a reply in the very conversation you'd been in arrived
// with no toast, no OS notification and, because the hidden thread marked it
// read at once, no badge either (COMMS-03).
//
// Now the thread itself says when it is on screen (it only mounts while the
// panel shows it), and quiet means: that thread is on screen AND the tab is
// visible AND focused.

const shown = new Map(); // conversationId → number of mounted threads showing it

// Called by a mounted thread. Returns the matching release for its cleanup.
export function showingConversation(conversationId) {
  if (!conversationId) return () => {};
  shown.set(conversationId, (shown.get(conversationId) || 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (shown.get(conversationId) || 0) - 1;
    if (n > 0) shown.set(conversationId, n); else shown.delete(conversationId);
  };
}

// Visible and focused. A foregrounded tab in a window behind another app
// still reads 'visible', so focus is checked too.
export function tabIsAttended(doc = globalThis.document) {
  if (!doc) return true;
  if (doc.visibilityState === 'hidden') return false;
  if (typeof doc.hasFocus === 'function' && !doc.hasFocus()) return false;
  return true;
}

export function isWatchingConversation(conversationId, doc = globalThis.document) {
  return !!conversationId && shown.has(conversationId) && tabIsAttended(doc);
}
