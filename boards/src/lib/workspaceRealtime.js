// Workspace-level presence over Supabase Realtime.
//
// Per-workspace channel `ws:{wsId}` that every member subscribes to. Each
// peer broadcasts its current location (board id + name + surface) on a
// heartbeat (5s) and on demand when navigation changes. Peers are tracked
// in a Map keyed by user.id; entries expire 15s after the last heartbeat.
//
// This complements the per-board Yjs awareness (which only fires when a
// peer is on the SAME board). Workspace presence answers "who's around
// anywhere in this workspace, and where are they?" so the topbar can
// show clickable avatars that jump to where someone is working.

import { supabase } from './supabase.js';

const HEARTBEAT_MS = 5000;
const STALE_MS = 15000;

// Make a unique browser-tab id so the same user open in two tabs shows
// up as two presences (you'd want to know if you left a tab open).
const TAB_ID = (() => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 't_' + Math.random().toString(36).slice(2, 12);
})();

export function attachWorkspacePresence(workspaceId, { user, getLocation, onPeers, onStatus }) {
  if (!supabase || !workspaceId) {
    onStatus?.('disconnected');
    return { destroy() {}, ping() {}, broadcastLocation() {} };
  }

  const channel = supabase.channel(`ws:${workspaceId}`, {
    config: { broadcast: { self: false, ack: false }, private: true },
  });

  let destroyed = false;
  let subscribed = false;
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
    onPeers?.([...peers.values()]);
    if (changed) onPeers?.([...peers.values()]);
  };

  const sendLocation = () => {
    if (!subscribed || destroyed) return;
    const location = getLocation?.();
    channel.send({
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

  // When a peer joins (sends a fresh heartbeat after we're already connected),
  // it doesn't know about us yet — so respond with our own ping immediately.
  channel.on('broadcast', { event: 'ws-here' }, () => {
    sendLocation();
  });

  channel.on('broadcast', { event: 'ws-leave' }, ({ payload }) => {
    if (!payload || payload.from === TAB_ID) return;
    for (const [key, p] of peers) {
      if (p.tabId === payload.from) peers.delete(key);
    }
    onPeers?.([...peers.values()]);
  });

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      subscribed = true;
      onStatus?.('connected');
      sendLocation();
      heartbeatInterval = setInterval(sendLocation, HEARTBEAT_MS);
      prunerInterval = setInterval(flushPeers, 4000);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      subscribed = false;
      onStatus?.('error');
    } else if (status === 'CLOSED') {
      subscribed = false;
      onStatus?.('disconnected');
    }
  });

  return {
    destroy() {
      destroyed = true;
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (prunerInterval) clearInterval(prunerInterval);
      try { channel.send({ type: 'broadcast', event: 'ws-leave', payload: { from: TAB_ID } }); } catch (_) {}
      try { supabase.removeChannel(channel); } catch (_) {}
    },
    ping: sendLocation,
    broadcastLocation: sendLocation,
  };
}
