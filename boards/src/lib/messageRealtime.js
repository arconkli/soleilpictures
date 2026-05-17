import { supabase } from './supabase.js';

// Realtime broadcast for a single conversation. Channel name is
// `conv:{conversationId}`; auth is enforced by the
// "realtime conv: participants" / "...participants write" policies
// (migration 0058). Returns an unsubscribe fn.
//
//   onMessage({ id, body, sender_id, attachments, mentions, ts, ... })
//   onTyping ({ user_id, ts })

function convChannelName(conversationId) {
  return `conv:${conversationId}`;
}

export function subscribeConversation({ conversationId, onMessage, onTyping }) {
  if (!conversationId) return () => {};
  const channel = supabase.channel(convChannelName(conversationId), {
    config: { broadcast: { self: false }, private: true },
  });
  channel.on('broadcast', { event: 'chat-message' }, ({ payload }) => onMessage?.(payload));
  channel.on('broadcast', { event: 'chat-typing'  }, ({ payload }) => onTyping?.(payload));
  channel.subscribe();
  return () => { try { supabase.removeChannel(channel); } catch (_) {} };
}

export function broadcastConversationMessage({ conversationId, payload }) {
  if (!conversationId) return Promise.resolve();
  const channel = supabase.channel(convChannelName(conversationId), { config: { private: true } });
  return channel.send({ type: 'broadcast', event: 'chat-message', payload });
}

export function broadcastConversationTyping({ conversationId, userId }) {
  if (!conversationId) return Promise.resolve();
  const channel = supabase.channel(convChannelName(conversationId), { config: { private: true } });
  return channel.send({ type: 'broadcast', event: 'chat-typing', payload: { user_id: userId, ts: Date.now() } });
}
