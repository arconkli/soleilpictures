// What Home's rail and its "pick up where you left off" card show, in the
// files sidebar's Home (components/home/ClustersHome.jsx, preview only; the
// owner's pick D, 2026-10-19). Pure: App hands in what it already holds (the
// inbox, workspace presence, the board map) and a way to name people.

import { hiddenFromInbox, isDmConversation } from './conversationState.js';
import { jumpBackIn } from './projectsHome.js';

const firstWord = (s) => String(s || '').trim().split(/\s+/)[0];

// The newest conversations the inbox shows (left groups and hidden DMs stay
// out, as in MessagesPanel), at most `limit`, each with the preview the inbox
// gives it: "You: …", "Lena: …" in a group, the words alone in a DM.
//   list: useConversationList's { conversations, participantsByConv,
//         myStateByConv, unreadByConv } (conversations newest first)
//   nameOf(userId) → a label or ''; colorOf(userId) → a colour
export function railConversations(list, { selfId = null, nameOf = () => '', colorOf = () => '#6b6760', limit = 3 } = {}) {
  const conversations = list?.conversations || [];
  const parts = list?.participantsByConv || new Map();
  const mine = list?.myStateByConv || new Map();
  const unread = list?.unreadByConv || new Map();
  const out = [];
  for (const conv of conversations) {
    if (out.length >= limit) break;
    const id = conv?.conversation_id;
    if (!id) continue;
    const participants = parts.get(id) || [];
    if (hiddenFromInbox({ conv, me: mine.get(id), participants })) continue;
    const peers = participants.filter((p) => p.user_id !== selfId && !p.left_at);
    const dm = isDmConversation(participants);
    const labels = peers.map((p) => nameOf(p.user_id) || 'Member');
    let preview = String(conv.last_message_body || '');
    if (conv.last_message_kind !== 'system' && preview) {
      if (conv.last_message_sender_id && conv.last_message_sender_id === selfId) preview = `You: ${preview}`;
      else if (!dm && conv.last_message_sender_id) {
        preview = `${firstWord(nameOf(conv.last_message_sender_id) || conv.last_message_sender_email || 'Member')}: ${preview}`;
      }
    }
    out.push({
      id,
      name: conv.title || labels.join(', ') || 'New conversation',
      preview,
      dm,
      unread: Number(unread.get(id)) || 0,
      avatars: peers.slice(0, 2).map((p, i) => ({
        id: p.user_id,
        initial: (labels[i] || 'M').charAt(0).toUpperCase(),
        color: colorOf(p.user_id),
      })),
    });
  }
  return out;
}

// Who is in the workspace right now and where: one row a person, you left
// out, a tab that isn't in front skipped (as the sidebar's presence dots skip
// it). where is "In <cluster>" when they're on one the map knows.
//   peers: useWorkspacePresence's peers ({ user: { id, … }, location })
//   nameOf(peer) → a label or ''
export function hereNow(peers, boards, { selfId = null, nameOf = () => '' } = {}) {
  const seen = new Set();
  const out = [];
  for (const p of peers || []) {
    const id = p?.user?.id;
    if (!id || id === selfId || seen.has(id)) continue;
    if (p?.location?.isActive === false) continue;
    seen.add(id);
    const bid = p?.location?.boardId;
    const board = bid ? boards?.[bid] : null;
    const name = nameOf(p) || 'Someone';
    out.push({
      id,
      name,
      initial: name.charAt(0).toUpperCase(),
      where: board ? `In ${(board.name && board.name.trim()) || 'Untitled cluster'}` : 'Here now',
      loc: p.location || null,
    });
  }
  return out;
}

// The cluster to pick up again and the next few after it: Home's jump-back
// list (recents first, then by recency), split into the one and the rest.
export function pickUp(boards, recents, rootId, { workspaceId = null, more = 3 } = {}) {
  const list = jumpBackIn(boards, recents, rootId, { workspaceId, max: 1 + more });
  return { last: list[0] || null, rest: list.slice(1) };
}
