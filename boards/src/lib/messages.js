import { supabase } from './supabase.js';
import { requestPermissionDeferred } from './browserNotifications.js';

// All message + conversation CRUD lives here. Realtime broadcast is in
// messageRealtime.js — callers do both: write to Postgres via these
// helpers and broadcast on the conversation channel so peers update
// without a refetch.
//
// Model:
//   conversations               (workspace-scoped chat thread)
//   conversation_participants   (membership + last_read_at + soft-leave)
//   messages.conversation_id    (FK)
//
// DMs are 2-participant conversations; group chats are 3+.

// ── Conversation list ────────────────────────────────────────────────

// Returns the rows of conversation_summary visible to the current user
// (RLS scopes to conversations you participate in), sorted by recency.
export async function listConversations({ workspaceId }) {
  if (!workspaceId) return [];
  const { data, error } = await supabase
    .from('conversation_summary')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('last_message_at', { ascending: false, nullsFirst: false });
  if (error) { console.warn('listConversations', error); return []; }
  return data || [];
}

// Returns conversation_participants for the conversations the current
// user can see (RLS scopes to conversations you participate in).
export async function listMyConversationParticipants({ workspaceId }) {
  if (!workspaceId) return [];
  // Join participants → conversations to filter by workspace.
  const { data, error } = await supabase
    .from('conversation_participants')
    .select('conversation_id, user_id, joined_at, left_at, last_read_at, conversation:conversations!inner(workspace_id)')
    .eq('conversation.workspace_id', workspaceId);
  if (error) { console.warn('listMyConversationParticipants', error); return []; }
  // Flatten — drop the nested workspace_id wrapper.
  return (data || []).map(r => ({
    conversation_id: r.conversation_id,
    user_id: r.user_id,
    joined_at: r.joined_at,
    left_at: r.left_at,
    last_read_at: r.last_read_at,
  }));
}

// ── Message fetching ────────────────────────────────────────────────

export async function fetchConversationMessages({ conversationId, limit = 200 }) {
  if (!conversationId) return [];
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) { console.warn('fetchConversationMessages', error); return []; }
  return data || [];
}

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

// ── Send / Edit / Delete ────────────────────────────────────────────

export async function sendMessage({
  workspaceId, conversationId, senderId, senderEmail,
  parentId, body, attachments = [], mentions = [], kind = 'user',
}) {
  // sender_email is also stamped server-side via the
  // messages_set_sender_email trigger (migration 0019).
  const row = {
    workspace_id: workspaceId,
    conversation_id: conversationId,
    sender_id: senderId,
    sender_email: senderEmail || null,
    parent_id: parentId || null,
    body,
    attachments,
    mentions,
    kind,
  };
  const { data, error } = await supabase.from('messages').insert(row).select().single();
  if (error) { console.warn('sendMessage', error); throw error; }
  // Deferred-permission gate: this is the most natural moment to ask
  // for OS notification permission — the user has just demonstrated
  // they intend to use messaging. Fire-and-forget; localStorage gate
  // inside the helper ensures we only ask once per browser.
  try { requestPermissionDeferred(); } catch (_) {}
  return data;
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

// ── Search ──────────────────────────────────────────────────────────

function escapeIlike(q) {
  return String(q || '').replace(/[\\%_]/g, ch => '\\' + ch);
}

export async function searchMessagesInConversation({ conversationId, query, limit = 50 }) {
  const q = String(query || '').trim();
  if (!q || !conversationId) return [];
  const pattern = '%' + escapeIlike(q) + '%';
  const { data, error } = await supabase.from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .ilike('body', pattern)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.warn('searchMessagesInConversation', error); return []; }
  return data || [];
}

// ── Threaded replies ────────────────────────────────────────────────

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

// ── Pin / unpin ─────────────────────────────────────────────────────

export async function togglePin(messageId) {
  const { data, error } = await supabase.rpc('toggle_pin', { p_message_id: messageId });
  if (error) { console.warn('togglePin', error); throw error; }
  return data === true;
}

export async function listPinnedForConversation({ conversationId }) {
  if (!conversationId) return [];
  const { data, error } = await supabase.from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .eq('is_pinned', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) { console.warn('listPinnedForConversation', error); return []; }
  return data || [];
}

// ── Reactions ───────────────────────────────────────────────────────

export async function toggleReaction({ messageId, emoji, userId }) {
  const { data: msg } = await supabase.from('messages').select('reactions').eq('id', messageId).maybeSingle();
  const reactions = { ...(msg?.reactions || {}) };
  const existing = new Set(reactions[emoji] || []);
  if (existing.has(userId)) existing.delete(userId);
  else existing.add(userId);
  if (existing.size === 0) delete reactions[emoji];
  else reactions[emoji] = [...existing];
  await supabase.from('messages').update({ reactions }).eq('id', messageId);
}

// ── Unread counts ───────────────────────────────────────────────────

export async function getUnreadCounts() {
  const { data, error } = await supabase.rpc('get_unread_counts');
  if (error) { console.warn('getUnreadCounts', error); return {}; }
  return data || {};
}

// ── Read state ──────────────────────────────────────────────────────

// Update conversation_participants.last_read_at = now() for (conv, me).
// Returns true on success so the caller can decide to bump a refresh
// tick (the unread badge cache lives upstream).
export async function markRead({ conversationId, userId }) {
  if (!conversationId || !userId) return false;
  const { error } = await supabase
    .from('conversation_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) { console.warn('markRead', error); return false; }
  return true;
}

// Hide / "leave" a conversation from your panel.
// For 2-person DMs, this is the equivalent of the old hideRow.
// For 3+ group chats, this is the explicit "leave" action.
export async function leaveConversation({ conversationId, userId }) {
  if (!conversationId || !userId) return false;
  const { error } = await supabase
    .from('conversation_participants')
    .update({ left_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) { console.warn('leaveConversation', error); return false; }
  return true;
}

// ── Conversation lifecycle ──────────────────────────────────────────

// Find an existing DM with peer (in this workspace) or create one.
// Re-engages your participation if you'd previously left.
// Returns the conversation id.
export async function findOrCreateDm({ workspaceId, peerId }) {
  if (!workspaceId || !peerId) return null;
  const { data, error } = await supabase.rpc('find_or_create_dm', {
    p_workspace: workspaceId,
    p_peer: peerId,
  });
  if (error) { console.warn('findOrCreateDm', error); throw error; }
  return data || null;
}

// Create a new group conversation with the given members (+ me).
// Returns the conversation id.
export async function createGroupConversation({ workspaceId, title, memberIds }) {
  if (!workspaceId || !Array.isArray(memberIds) || memberIds.length === 0) return null;
  const { data, error } = await supabase.rpc('create_group_conversation', {
    p_workspace: workspaceId,
    p_title: title || null,
    p_member_ids: memberIds,
  });
  if (error) { console.warn('createGroupConversation', error); throw error; }
  return data || null;
}

// Add workspace members to an existing conversation.
export async function addParticipants({ conversationId, userIds }) {
  if (!conversationId || !Array.isArray(userIds) || userIds.length === 0) return false;
  const rows = userIds.map(uid => ({ conversation_id: conversationId, user_id: uid }));
  // upsert so adding an existing-but-left participant resets nothing on
  // the existing row (it stays left_at non-null unless they re-engage themselves).
  // For freshly-added users, the row is inserted.
  const { error } = await supabase
    .from('conversation_participants')
    .upsert(rows, { onConflict: 'conversation_id,user_id', ignoreDuplicates: true });
  if (error) { console.warn('addParticipants', error); throw error; }
  return true;
}

// Rename a conversation's title. Null/empty clears it.
export async function renameConversation({ conversationId, title }) {
  if (!conversationId) return false;
  const next = (title || '').trim() || null;
  const { error } = await supabase
    .from('conversations')
    .update({ title: next })
    .eq('id', conversationId);
  if (error) { console.warn('renameConversation', error); throw error; }
  return true;
}
