import { supabase } from './supabase.js';

// Subscribe to a board channel's chat events. Returns an unsubscribe fn.
//   onMessage({ id, body, sender, attachments, mentions, ts })  — peer sent
//   onTyping ({ user_id, ts })                                   — peer typing
//
// Reuses the existing board:{id} broadcast channel that Yjs already
// subscribes to (Supabase de-dupes channel instances per name).
export function subscribeBoardChat({ boardId, onMessage, onTyping }) {
  const channel = supabase.channel(`board:${boardId}`, { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'chat-message' }, ({ payload }) => onMessage?.(payload));
  channel.on('broadcast', { event: 'chat-typing'  }, ({ payload }) => onTyping?.(payload));
  channel.subscribe();
  return () => { try { supabase.removeChannel(channel); } catch (_) {} };
}

export function broadcastBoardMessage({ boardId, payload }) {
  const channel = supabase.channel(`board:${boardId}`);
  return channel.send({ type: 'broadcast', event: 'chat-message', payload });
}

export function broadcastBoardTyping({ boardId, userId }) {
  const channel = supabase.channel(`board:${boardId}`);
  return channel.send({ type: 'broadcast', event: 'chat-typing', payload: { user_id: userId, ts: Date.now() } });
}

// DM channel — name is "dm:{loId}:{hiId}" so both ends subscribe to the same one.
function dmChannelName(a, b) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return `dm:${lo}:${hi}`;
}

export function subscribeDmChat({ userA, userB, onMessage, onTyping }) {
  const channel = supabase.channel(dmChannelName(userA, userB), { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'chat-message' }, ({ payload }) => onMessage?.(payload));
  channel.on('broadcast', { event: 'chat-typing'  }, ({ payload }) => onTyping?.(payload));
  channel.subscribe();
  return () => { try { supabase.removeChannel(channel); } catch (_) {} };
}

export function broadcastDmMessage({ userA, userB, payload }) {
  const channel = supabase.channel(dmChannelName(userA, userB));
  return channel.send({ type: 'broadcast', event: 'chat-message', payload });
}

export function broadcastDmTyping({ userA, userB, userId }) {
  const channel = supabase.channel(dmChannelName(userA, userB));
  return channel.send({ type: 'broadcast', event: 'chat-typing', payload: { user_id: userId, ts: Date.now() } });
}
