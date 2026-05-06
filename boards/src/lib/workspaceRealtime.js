// Workspace-level presence over Supabase Realtime.
//
// Per-workspace channel `ws:{wsId}` that every member subscribes to. Each
// peer broadcasts its current location (board id + name + surface) on a
// heartbeat (5s) and on demand when navigation changes. Peers are tracked
// in a Map keyed by user.id; entries expire 15s after the last heartbeat.
//
// Self-healing: if Phoenix puts the channel into CLOSED state (which
// REMOVES it from the socket — channel.js:70 → socket.remove(this), so
// no future rejoin is possible), we tear down the dead channel and build
// a fresh one. Without this, a single bad close kills workspace presence
// for the rest of the session.

import { supabase } from './supabase.js';

const HEARTBEAT_MS = 5000;
const STALE_MS = 15000;
const REBUILD_BACKOFF_MS = 2000;

const TAB_ID = (() => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 't_' + Math.random().toString(36).slice(2, 12);
})();

export function attachWorkspacePresence(workspaceId, { user, getLocation, onPeers, onStatus }) {
  if (!supabase || !workspaceId) {
    onStatus?.('disconnected');
    return { destroy() {}, ping() {}, broadcastLocation() {} };
  }

  let destroyed = false;
  let subscribed = false;
  let currentChannel = null;
  // Map<peerKey, { user, location, lastSeen }>  (peerKey = `${userId}:${tabId}`)
  const peers = new Map();
  let prunerInterval = null;
  let heartbeatInterval = null;

  const flushPeers = () => {
    if (destroyed) return;
    const now = Date.now();
    let changed = false;
    for (const [key, p] of peers) {
      if (now - p.lastSeen > STALE_MS) { peers.delete(key); changed = true; }
    }
    if (changed) onPeers?.([...peers.values()]);
  };

  const sendLocation = () => {
    if (!subscribed || destroyed || !currentChannel) return;
    const location = getLocation?.();
    currentChannel.send({
      type: 'broadcast',
      event: 'ws-here',
      payload: {
        from: TAB_ID,
        user: user ? { id: user.id, name: user.name, color: user.color, email: user.email } : null,
        location,
        ts: Date.now(),
      },
    });
  };

  const buildChannel = () => {
    const channel = supabase.channel(`ws:${workspaceId}`, {
      config: { broadcast: { self: false, ack: false }, private: true },
    });

    channel.on('broadcast', { event: 'ws-here' }, ({ payload }) => {
      if (!payload || payload.from === TAB_ID || !payload.user) return;
      const key = `${payload.user.id}:${payload.from}`;
      peers.set(key, {
        key,
        tabId: payload.from,
        user: payload.user,
        location: payload.location || null,
        lastSeen: Date.now(),
      });
      onPeers?.([...peers.values()]);
    });

    // When a peer joins (sends a fresh heartbeat after we're already
    // connected), it doesn't know about us yet — so respond with our
    // own ping immediately.
    channel.on('broadcast', { event: 'ws-here' }, () => sendLocation());

    channel.on('broadcast', { event: 'ws-leave' }, ({ payload }) => {
      if (!payload || payload.from === TAB_ID) return;
      for (const [key, p] of peers) {
        if (p.tabId === payload.from) peers.delete(key);
      }
      onPeers?.([...peers.values()]);
    });

    let subscribedAt = 0;
    channel.subscribe((status, err) => {
      const dt = subscribedAt ? `(after ${((Date.now() - subscribedAt) / 1000).toFixed(1)}s)` : '';
      console.log('[realtime] ws:' + workspaceId, status, dt, err || '');
      if (status === 'SUBSCRIBED') subscribedAt = Date.now();
      if (status === 'SUBSCRIBED') {
        subscribed = true;
        onStatus?.('connected');
        sendLocation();
        if (!heartbeatInterval) heartbeatInterval = setInterval(sendLocation, HEARTBEAT_MS);
        if (!prunerInterval) prunerInterval = setInterval(flushPeers, 4000);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        subscribed = false;
        onStatus?.('error');
      } else if (status === 'CLOSED') {
        // No rebuild — the rebuild loop creates a server-side feedback
        // loop with Supabase's join-rate limit (every rebuild costs a
        // join, server closes from rate limit, we rebuild again). Phoenix
        // handles transient CHANNEL_ERROR / TIMED_OUT on its own. CLOSED
        // is terminal; user-visible "Offline" badge until refresh.
        subscribed = false;
        onStatus?.('disconnected');
      }
    });

    return channel;
  };

  currentChannel = buildChannel();

  return {
    destroy() {
      destroyed = true;
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (prunerInterval) clearInterval(prunerInterval);
      try { currentChannel?.send({ type: 'broadcast', event: 'ws-leave', payload: { from: TAB_ID } }); } catch (_) {}
      try { if (currentChannel) supabase.removeChannel(currentChannel); } catch (_) {}
    },
    ping: sendLocation,
    broadcastLocation: sendLocation,
  };
}
