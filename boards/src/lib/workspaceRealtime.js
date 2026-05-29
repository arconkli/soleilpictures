// Workspace-level presence over Supabase Realtime.
//
// Per-workspace channel `ws:{wsId}` that every member subscribes to. Each
// peer announces its current location (board id + name + surface) on join,
// on navigation, and — only while other peers are present — on a 15s
// heartbeat. Peers are tracked in a Map keyed by `${userId}:${tabId}`;
// entries expire after STALE_MS (60s) without a heartbeat.
//
// Self-healing: if Phoenix puts the channel into CLOSED state (which
// REMOVES it from the socket — channel.js:70 → socket.remove(this), so
// no future rejoin is possible), we tear down the dead channel and build
// a fresh one. Without this, a single bad close kills workspace presence
// for the rest of the session.

import { supabase } from './supabase.js';
import * as perf from './perf.js';

// 15s heartbeat — was 5s, but combined with the y: channel + cursor
// broadcasts that's too much for the free-tier per-tenant message
// cap. STALE_MS = 4 × heartbeat so a single missed heartbeat doesn't
// drop a peer from the workspace presence list.
const HEARTBEAT_MS = 15000;
const STALE_MS = 60000;
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
    perf.bump('rt.send.ws-here');  // ?perf=1 — ~0 when solo; bounded per-join when peers present
  };

  const buildChannel = () => {
    const channel = supabase.channel(`ws:${workspaceId}`, {
      config: { broadcast: { self: false, ack: false }, private: true },
    });

    channel.on('broadcast', { event: 'ws-here' }, ({ payload }) => {
      if (!payload || payload.from === TAB_ID || !payload.user) return;
      const key = `${payload.user.id}:${payload.from}`;
      // Only a genuinely NEW peer triggers a reply — that is the join
      // handshake (they don't know about us yet). Replying to EVERY
      // ws-here (including a known peer's routine 15s heartbeat) created a
      // self-sustaining ping-pong: A's heartbeat → B replies → A replies →
      // … bounded only by network latency, saturating the per-tenant
      // message cap until the channel went CLOSED and presence silently
      // died. The reply below is now sent once per peer, on first sight.
      const isNew = !peers.has(key);
      peers.set(key, {
        key,
        tabId: payload.from,
        user: payload.user,
        location: payload.location || null,
        lastSeen: Date.now(),
      });
      onPeers?.([...peers.values()]);
      if (isNew) sendLocation();
    });

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
        sendLocation();  // initial announce — unconditional, so existing peers learn about us
        // Heartbeat only while we actually have peers to stay fresh for.
        // A solo session (the common case, and the dominant lever for
        // cutting per-user Realtime volume at scale) broadcasts nothing
        // after the initial announce. Discovery still converges: a new
        // peer's own join-announce arrives on our always-subscribed
        // channel and we reply; and any peer we already know receives our
        // 15s heartbeat, which also informs a peer that has not yet
        // learned about us (self-healing within one heartbeat).
        if (!heartbeatInterval) heartbeatInterval = setInterval(() => {
          if (peers.size > 0) sendLocation();
        }, HEARTBEAT_MS);
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
