// Paging for a conversation's message list. Pure, so node --test can pin it.
//
// A thread loads its NEWEST page (fetched newest-first, then reversed) and
// grows backwards on "load older". It used to fetch oldest-first with a limit,
// which returned the FIRST 200 messages ever sent: past 200 a thread stopped
// growing, and a just-sent message vanished when the refetch replaced its
// optimistic bubble (COMMS-06).

export const MESSAGE_PAGE = 200;

const at = (m) => Date.parse(m?.created_at || '') || 0;

// Fold a freshly fetched newest page into what is on screen. The fresh page
// wins for everything it covers; history the reader already paged back to
// survives, as long as it belongs to this conversation (a switch must never
// leak the previous thread's rows) and is no newer than the page's oldest row.
// A page shorter than the page size IS the whole conversation, so it replaces
// the list outright (that is also how a deleted old message drops out).
//
// `history` is a fresh re-read of the paged-back range. Given, it stands in
// for the held rows, so a delete, an undo, an edit or a reaction to an old
// message shows up; kept as they were, those rows never changed again. Null
// (nothing paged back, or the re-read failed) keeps what is on screen.
// `historyFrom` is where the re-read started: rows older than that (a page
// that landed while the re-read was in flight) are kept, not dropped.
export function mergeNewestPage(prev, fresh, {
  conversationId, pageSize = MESSAGE_PAGE, history = null, historyFrom = null,
} = {}) {
  const page = Array.isArray(fresh) ? fresh : [];
  if (page.length < pageSize || page.length === 0) return page;
  const boundary = at(page[0]);
  const freshIds = new Set(page.map(m => m.id));
  let held = prev || [];
  if (Array.isArray(history)) {
    const from = Date.parse(historyFrom || '') || 0;
    const reread = new Set(history.map(m => m.id));
    held = held.filter(m => at(m) < from && !reread.has(m.id)).concat(history);
  }
  const older = held.filter(m =>
    m.conversation_id === conversationId && !freshIds.has(m.id) && at(m) <= boundary);
  return older.length ? older.concat(page) : page;
}

// Prepend an older page (ascending) ahead of the current list, skipping any
// row already shown — two messages can share a timestamp across the cut.
export function prependOlder(prev, older) {
  const list = prev || [];
  if (!Array.isArray(older) || older.length === 0) return list;
  const have = new Set(list.map(m => m.id));
  const add = older.filter(m => !have.has(m.id));
  return add.length ? add.concat(list) : list;
}

// The id of the newest message — what "something new arrived" keys on. Length
// can't: it stays put at a full page, and it jumps when older history loads.
export function lastMessageId(list) {
  return list && list.length ? list[list.length - 1].id : null;
}
