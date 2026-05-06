import { supabase } from './supabase.js';

// All message CRUD lives here. Realtime broadcast is in messageRealtime.js
// — callers do both: write to Postgres via these helpers and broadcast on
// the appropriate channel so peers update without a refetch.

export async function fetchBoardChannelMessages({ boardId, limit = 200 }) {
  const { data, error } = await supabase.from('messages')
    .select('*')
    .eq('board_id', boardId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) { console.warn('fetchBoardChannelMessages', error); return []; }
  return data || [];
}

export async function fetchDmThreadMessages({ workspaceId, userA, userB, limit = 200 }) {
  const [lo, hi] = userA < userB ? [userA, userB] : [userB, userA];
  const { data, error } = await supabase.from('messages')
    .select('*')
    .eq('workspace_id', workspaceId)
    .or(`and(sender_id.eq.${lo},dm_peer_id.eq.${hi}),and(sender_id.eq.${hi},dm_peer_id.eq.${lo})`)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) { console.warn('fetchDmThreadMessages', error); return []; }
  return data || [];
}

export async function listBoardChannels({ workspaceId }) {
  const { data, error } = await supabase.from('board_channel_summary')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('last_message_at', { ascending: false });
  if (error) { console.warn('listBoardChannels', error); return []; }
  return data || [];
}

export async function listDmThreads({ workspaceId }) {
  const { data, error } = await supabase.from('dm_thread_summary')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('last_message_at', { ascending: false });
  if (error) { console.warn('listDmThreads', error); return []; }
  return data || [];
}

export async function listMessageReadsForUser({ userId }) {
  const { data, error } = await supabase.from('message_reads')
    .select('*')
    .eq('user_id', userId);
  if (error) { console.warn('listMessageReadsForUser', error); return []; }
  return data || [];
}

export async function sendMessage({ workspaceId, boardId, dmPeerId, senderId, senderEmail, parentId, body, attachments = [], mentions = [] }) {
  // sender_email is also stamped server-side via the
  // messages_set_sender_email trigger (migration 0019), so this is
  // belt-and-suspenders. parentId (migration 0020) attaches the
  // message as a reply in a threaded conversation.
  const row = {
    workspace_id: workspaceId,
    board_id: boardId || null,
    dm_peer_id: dmPeerId || null,
    sender_id: senderId,
    sender_email: senderEmail || null,
    parent_id: parentId || null,
    body,
    attachments,
    mentions,
  };
  const { data, error } = await supabase.from('messages').insert(row).select().single();
  if (error) { console.warn('sendMessage', error); throw error; }
  return data;
}

// Per-thread message search via Postgres ILIKE on body. Both helpers
// return rows in the same shape as the regular fetchers so callers
// can swap them in without touching MessageBubble logic.

function escapeIlike(q) {
  // Postgres ILIKE pattern escape — % and _ are wildcards.
  return String(q || '').replace(/[\\%_]/g, ch => '\\' + ch);
}

export async function searchMessagesInBoard({ boardId, query, limit = 50 }) {
  const q = String(query || '').trim();
  if (!q || !boardId) return [];
  const pattern = '%' + escapeIlike(q) + '%';
  const { data, error } = await supabase.from('messages')
    .select('*')
    .eq('board_id', boardId)
    .is('deleted_at', null)
    .ilike('body', pattern)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.warn('searchMessagesInBoard', error); return []; }
  return data || [];
}

export async function searchMessagesInDm({ workspaceId, userA, userB, query, limit = 50 }) {
  const q = String(query || '').trim();
  if (!q || !workspaceId) return [];
  const pattern = '%' + escapeIlike(q) + '%';
  const { data, error } = await supabase.from('messages')
    .select('*')
    .eq('workspace_id', workspaceId)
    .or(`and(sender_id.eq.${userA},dm_peer_id.eq.${userB}),and(sender_id.eq.${userB},dm_peer_id.eq.${userA})`)
    .is('deleted_at', null)
    .ilike('body', pattern)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.warn('searchMessagesInDm', error); return []; }
  return data || [];
}

// ── Threaded replies ─────────────────────────────────────────────────

export async function fetchReplies({ parentId }) {
  if (!parentId) return [];
  const { data, error } = await supabase.from('messages')
    .select('*')
    .eq('parent_id', parentId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) { console.warn('fetchReplies', error); return []; }
  return data || [];
}

// Bulk reply count for a list of parent message ids — used by the
// main thread to render an "N replies" badge per parent without N+1.
// Returns Map<parentId, { count, lastAt }>.
export async function replyCountsFor(parentIds) {
  if (!Array.isArray(parentIds) || parentIds.length === 0) return new Map();
  const { data, error } = await supabase.from('messages')
    .select('parent_id, created_at')
    .in('parent_id', parentIds)
    .is('deleted_at', null);
  if (error) { console.warn('replyCountsFor', error); return new Map(); }
  const out = new Map();
  for (const r of (data || [])) {
    const cur = out.get(r.parent_id) || { count: 0, lastAt: null };
    cur.count++;
    if (!cur.lastAt || r.created_at > cur.lastAt) cur.lastAt = r.created_at;
    out.set(r.parent_id, cur);
  }
  return out;
}

// Look up a single message's full row (for permalink resolution).
export async function fetchMessageById(id) {
  if (!id) return null;
  const { data, error } = await supabase.from('messages')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) { console.warn('fetchMessageById', error); return null; }
  return data || null;
}

// ── Pin / unpin ──────────────────────────────────────────────────────

export async function togglePin(messageId) {
  const { data, error } = await supabase.rpc('toggle_pin', { p_message_id: messageId });
  if (error) { console.warn('togglePin', error); throw error; }
  return data === true;
}

export async function listPinnedForBoard({ boardId }) {
  if (!boardId) return [];
  const { data, error } = await supabase.from('messages')
    .select('*')
    .eq('board_id', boardId)
    .eq('is_pinned', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) { console.warn('listPinnedForBoard', error); return []; }
  return data || [];
}

export async function listPinnedForDm({ workspaceId, userA, userB }) {
  if (!workspaceId) return [];
  const { data, error } = await supabase.from('messages')
    .select('*')
    .eq('workspace_id', workspaceId)
    .or(`and(sender_id.eq.${userA},dm_peer_id.eq.${userB}),and(sender_id.eq.${userB},dm_peer_id.eq.${userA})`)
    .eq('is_pinned', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) { console.warn('listPinnedForDm', error); return []; }
  return data || [];
}

// ── Unread counts (real numbers, not binary) ─────────────────────────

export async function getUnreadCounts() {
  const { data, error } = await supabase.rpc('get_unread_counts');
  if (error) { console.warn('getUnreadCounts', error); return {}; }
  return data || {};
}


export async function editMessage({ id, body, attachments }) {
  const patch = { body, edited_at: new Date().toISOString() };
  if (attachments) patch.attachments = attachments;
  const { error } = await supabase.from('messages').update(patch).eq('id', id);
  if (error) { console.warn('editMessage', error); throw error; }
}

export async function deleteMessage({ id }) {
  const { error } = await supabase.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) { console.warn('deleteMessage', error); throw error; }
}

export async function toggleReaction({ messageId, emoji, userId }) {
  // Postgres-side toggle would need a function; do a read-modify-write
  // on the client. Acceptable for v1 — reactions are low-frequency.
  const { data: msg } = await supabase.from('messages').select('reactions').eq('id', messageId).maybeSingle();
  const reactions = { ...(msg?.reactions || {}) };
  const existing = new Set(reactions[emoji] || []);
  if (existing.has(userId)) existing.delete(userId);
  else existing.add(userId);
  if (existing.size === 0) delete reactions[emoji];
  else reactions[emoji] = [...existing];
  await supabase.from('messages').update({ reactions }).eq('id', messageId);
}

// message_reads upsert: PostgREST's onConflict can't target our coalesce()
// unique index, so we do a read-then-update-or-insert. One row per
// (user, board|dm_peer) target.
async function upsertReadRow({ userId, boardId, dmPeerId, hidden }) {
  const now = new Date().toISOString();
  let q = supabase.from('message_reads').select('id').eq('user_id', userId);
  q = boardId ? q.eq('reads_board_id', boardId) : q.is('reads_board_id', null);
  q = dmPeerId ? q.eq('reads_dm_peer',  dmPeerId) : q.is('reads_dm_peer',  null);
  const { data: existing } = await q.maybeSingle();
  const patch = {
    last_read_at: now,
    hidden_at:    hidden ? now : null,
  };
  if (existing?.id) {
    const { error } = await supabase.from('message_reads').update(patch).eq('id', existing.id);
    if (error) console.warn('upsertReadRow update', error);
    return;
  }
  const { error } = await supabase.from('message_reads').insert({
    user_id: userId,
    reads_board_id: boardId || null,
    reads_dm_peer:  dmPeerId || null,
    ...patch,
  });
  if (error) console.warn('upsertReadRow insert', error);
}

export async function markRead({ userId, boardId, dmPeerId }) {
  await upsertReadRow({ userId, boardId, dmPeerId, hidden: false });
}

export async function hideRow({ userId, boardId, dmPeerId }) {
  await upsertReadRow({ userId, boardId, dmPeerId, hidden: true });
}
