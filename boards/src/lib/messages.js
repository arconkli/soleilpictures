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

export async function sendMessage({ workspaceId, boardId, dmPeerId, senderId, senderEmail, body, attachments = [], mentions = [] }) {
  // sender_email is also stamped server-side via the
  // messages_set_sender_email trigger (migration 0019), so this is
  // belt-and-suspenders. We pass it from the client too so the
  // returned row has the value populated without a SELECT roundtrip.
  const row = {
    workspace_id: workspaceId,
    board_id: boardId || null,
    dm_peer_id: dmPeerId || null,
    sender_id: senderId,
    sender_email: senderEmail || null,
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
