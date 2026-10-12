import { supabase } from './supabase.js';

// Realtime broadcast for a single conversation. Channel name is
// `conv:{conversationId}`; auth is enforced by the
// "realtime conv: participants" / "...participants write" policies
// (migration 0058). Returns an unsubscribe fn.
//
//   onMessage   ({ id, body, sender_id, attachments, mentions, ts, ... })
//               — also ({ changed, id }) for an edit, delete, restore, pin,
//               reaction or "X added Y"; receivers just read the thread again
//   onTyping    ({ user_id, ts })
//   onSubscribed() — the channel joined, or rejoined after a drop. Whatever
//               was broadcast while it was down is gone, so read again.

function convChannelName(conversationId) {
  return `conv:${conversationId}`;
}

export function subscribeConversation({ conversationId, onMessage, onTyping, onSubscribed }) {
  if (!conversationId) return () => {};
  const channel = supabase.channel(convChannelName(conversationId), {
    config: { broadcast: { self: false }, private: true },
  });
  channel.on('broadcast', { event: 'chat-message' }, ({ payload }) => onMessage?.(payload));
  channel.on('broadcast', { event: 'chat-typing'  }, ({ payload }) => onTyping?.(payload));
  channel.subscribe((status) => { if (status === 'SUBSCRIBED') onSubscribed?.(); });
  return () => { try { supabase.removeChannel(channel); } catch (_) {} };
}

export function broadcastConversationMessage({ conversationId, payload }) {
  if (!conversationId) return Promise.resolve();
  const channel = supabase.channel(convChannelName(conversationId), { config: { private: true } });
  return channel.send({ type: 'broadcast', event: 'chat-message', payload });
}

// Tell the other people in the thread that something already in it changed.
// Rides the 'chat-message' event on purpose: every client in the field —
// tabs left open since before this shipped included — already reads the
// thread again on it, whatever the payload. Fire-and-forget: a missed nudge
// heals on the receiver's next rejoin or refocus.
export function broadcastConversationChange({ conversationId, changed, id = null }) {
  if (!conversationId) return;
  try {
    broadcastConversationMessage({ conversationId, payload: { changed, id } })
      .then(null, (e) => console.warn('[messageRealtime] change broadcast failed', e));
  } catch (e) { console.warn('[messageRealtime] change broadcast failed', e); }
}

export function broadcastConversationTyping({ conversationId, userId }) {
  if (!conversationId) return Promise.resolve();
  const channel = supabase.channel(convChannelName(conversationId), { config: { private: true } });
  return channel.send({ type: 'broadcast', event: 'chat-typing', payload: { user_id: userId, ts: Date.now() } });
}
