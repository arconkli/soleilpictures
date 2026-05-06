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
  let rebuildTimer = null;
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

    channel.subscribe((status, err) => {
      console.log('[realtime] ws:' + workspaceId, status, err || '');
      if (status === 'SUBSCRIBED') {
        subscribed = true;
        onStatus?.('connected');
        sendLocation();
        if (!heartbeatInterval) heartbeatInterval = setInterval(sendLocation, HEARTBEAT_MS);
        if (!prunerInterval) prunerInterval = setInterval(flushPeers, 4000);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        // Phoenix will auto-rejoin via its rejoinTimer when the socket is
        // back; just flag the status so the UI shows reconnecting.
        subscribed = false;
        onStatus?.('error');
      } else if (status === 'CLOSED') {
        // CLOSED is terminal — the channel is removed from the socket and
        // can't be reused. Tear it down and build a fresh one after a
        // short backoff so we don't tight-loop on persistent failures.
        subscribed = false;
        onStatus?.('disconnected');
        if (destroyed) return;
        if (rebuildTimer) return;
        rebuildTimer = setTimeout(() => {
          rebuildTimer = null;
          if (destroyed) return;
          try { supabase.removeChannel(channel); } catch (_) {}
          currentChannel = buildChannel();
        }, REBUILD_BACKOFF_MS);
      }
    });

    return channel;
  };

  currentChannel = buildChannel();

  return {
    destroy() {
      destroyed = true;
      if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = null; }
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (prunerInterval) clearInterval(prunerInterval);
      try { currentChannel?.send({ type: 'broadcast', event: 'ws-leave', payload: { from: TAB_ID } }); } catch (_) {}
      try { if (currentChannel) supabase.removeChannel(currentChannel); } catch (_) {}
    },
    ping: sendLocation,
    broadcastLocation: sendLocation,
  };
}
