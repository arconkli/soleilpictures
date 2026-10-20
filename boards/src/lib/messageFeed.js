// How a conversation's rows are laid out: day dividers, the "New" line,
// system rows, and runs of messages from one sender. Pure, so node --test can
// pin it.

// Consecutive messages from one sender read as one run while each is within
// this of the message before it.
export const RUN_WINDOW_MS = 5 * 60 * 1000;

const time = (m) => Date.parse(m?.created_at || '') || 0;

export function dayKey(iso) {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  const days = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

// rows → [{ kind: 'divider', key, label }
//        | { kind: 'new', key: 'new' }
//        | { kind: 'msg', key, msg, isContinuation, runEnd }]
//
// A message continues the run above it when it is from the same sender,
// within RUN_WINDOW_MS of the PREVIOUS message (measuring from the run's first
// one splits runs at arbitrary points), on the same day, not a reply, and —
// with breakOnPin — not pinned. A day change, a system row and the "New" line
// each end a run. Rows still being sent are laid out like the rest, so a
// message keeps its shape when the server confirms it.
//
// newAfter: your last_read_at when the thread opened. The "New" line goes
// above the first message from someone else that is newer; your own messages
// never draw it.
export function buildFeedItems(rows, { selfId = null, newAfter = null, breakOnPin = true, now } = {}) {
  const items = [];
  let lastDay = null;
  let prev = null;
  let newPlaced = !newAfter;
  const newAt = Date.parse(newAfter || '') || 0;
  for (const m of rows || []) {
    const k = dayKey(m.created_at);
    if (k !== lastDay) {
      items.push({ kind: 'divider', key: 'd-' + k, label: dayLabel(m.created_at, now) });
      lastDay = k;
      prev = null;
    }
    if (!newPlaced && m.kind !== 'system' && m.sender_id !== selfId && !m.sendState && time(m) > newAt) {
      items.push({ kind: 'new', key: 'new' });
      newPlaced = true;
      prev = null;
    }
    if (m.kind === 'system') {
      items.push({ kind: 'msg', key: m.id, msg: m, isContinuation: false, runEnd: true });
      prev = null;
      continue;
    }
    const isContinuation = !!prev
      && prev.sender_id === m.sender_id
      && !m.parent_id
      && !(breakOnPin && m.is_pinned)
      && time(m) - time(prev) < RUN_WINDOW_MS;
    items.push({ kind: 'msg', key: m.id, msg: m, isContinuation, runEnd: true });
    prev = m;
  }
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (it.kind !== 'msg' || it.msg.kind === 'system') continue;
    const next = items[i + 1];
    it.runEnd = !(next && next.kind === 'msg' && next.isContinuation);
  }
  return items;
}

// DMs only: the id of your newest message once the other person has read it.
// Their read point is the later of their last_read_at and their own newest
// message (writing back means they read it, and covers a peer whose client
// never says so). A message still sending, or kept after a failed send, never
// counts; a reply from them hides it.
export function selectSeenMessageId(rows, { selfId, isDm, peerId, peerLastReadAt = null } = {}) {
  if (!isDm || !selfId || !peerId) return null;
  let newest = null;
  let peerNewest = 0;
  for (const m of rows || []) {
    if (m.kind === 'system' || m.sendState) continue;
    newest = m;
    if (m.sender_id === peerId) peerNewest = Math.max(peerNewest, time(m));
  }
  if (!newest || newest.sender_id !== selfId) return null;
  const readAt = Math.max(Date.parse(peerLastReadAt || '') || 0, peerNewest);
  return readAt >= time(newest) ? newest.id : null;
}

// Who is typing, in words.
export function typingLabel(names) {
  const list = (names || []).filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return `${list[0]} is typing`;
  if (list.length === 2) return `${list[0]} and ${list[1]} are typing`;
  return 'Several people are typing';
}
