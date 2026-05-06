// Supabase Realtime provider for Yjs.
//
// Wires a Y.Doc + Y.Awareness instance to a Supabase Realtime broadcast
// channel so every connected tab/user sees each other's edits and cursors
// in real time. No server-side code required — Supabase Realtime is just a
// websocket bus, and the Y.Doc remains the source of truth (Postgres
// snapshot is the cold-load fallback).
//
// Sync protocol (lifted from y-websocket, simplified for broadcast):
//   1. On join, send sync-step1 with our state vector.
//   2. Any peer receiving sync-step1 replies with sync-step2 (the missing
//      updates) and broadcasts its own sync-step1.
//   3. Every local Y.Doc update broadcasts as a y-update message.
//   4. Awareness state changes broadcast as y-awareness messages.
//
// Self-healing: if Phoenix puts the channel into CLOSED state (which
// REMOVES it from the socket — channel.js:70 → socket.remove(this), so
// no future rejoin is possible), we tear down the dead channel and
// rebuild a fresh one with the same topic. Without this, a single bad
// close kills realtime for the rest of the session.

import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { supabase, bounceRealtime } from './supabase.js';
import { bytesToB64, b64ToBytes } from './yhelpers.js';

const AWARENESS_THROTTLE_MS = 33;
const REBUILD_BACKOFF_MS = 2000;
const WATCHDOG_TIMEOUT_MS = 5 * 60 * 1000;

const CLIENT_ID = (() => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'c_' + Math.random().toString(36).slice(2, 12);
})();

export function attachRealtime(ydoc, boardId, { user } = {}) {
  if (!boardId) return { destroy() {}, awareness: null };
  console.log('[realtime] y:' + boardId, 'attach (user:', user?.email || user?.id || 'anon', ')');

  const awareness = new Awareness(ydoc);
  if (user) {
    awareness.setLocalStateField('user', {
      id: user.id || CLIENT_ID,
      name: user.name || user.email?.split('@')[0] || 'Someone',
      color: user.color || pickColor(user.id || CLIENT_ID),
    });
  }

  let destroyed = false;
  let subscribed = false;
  let awarenessTimer = null;
  let currentChannel = null;
  let rebuildTimer = null;
  let lastInbound = Date.now();
  const handshakeWith = new Set();

  // Outgoing handlers read currentChannel each call so post-rebuild
  // updates land on the fresh channel.
  const onYUpdate = (update, origin) => {
    if (destroyed || !subscribed || !currentChannel) return;
    if (origin === 'remote') return;
    if (origin === 'snapshot') return;
    if (origin === 'restore') return;
    currentChannel.send({ type: 'broadcast', event: 'y-update',
                          payload: { from: CLIENT_ID, u: bytesToB64(update) } });
  };
  ydoc.on('update', onYUpdate);

  const onAwarenessUpdate = ({ added, updated, removed }) => {
    if (destroyed || !subscribed || !currentChannel) return;
    const changedClients = added.concat(updated, removed);
    if (changedClients.length === 0) return;
    if (awarenessTimer) return;
    awarenessTimer = setTimeout(() => {
      awarenessTimer = null;
      if (!currentChannel) return;
      const buf = encodeAwarenessUpdate(awareness, changedClients);
      currentChannel.send({ type: 'broadcast', event: 'y-awareness',
                            payload: { from: CLIENT_ID, a: bytesToB64(buf) } });
    }, AWARENESS_THROTTLE_MS);
  };
  awareness.on('update', onAwarenessUpdate);

  const buildChannel = () => {
    const channel = supabase.channel(`y:${boardId}`, {
      config: { broadcast: { self: false, ack: false }, private: true },
    });

    channel.on('broadcast', { event: 'y-sync-step1' }, ({ payload }) => {
      if (!payload || payload.from === CLIENT_ID) return;
      try {
        const sv = b64ToBytes(payload.sv);
        const update = Y.encodeStateAsUpdate(ydoc, sv);
        channel.send({ type: 'broadcast', event: 'y-sync-step2',
                       payload: { from: CLIENT_ID, to: payload.from, u: bytesToB64(update) } });
        if (!handshakeWith.has(payload.from)) {
          handshakeWith.add(payload.from);
          const ourSv = Y.encodeStateVector(ydoc);
          channel.send({ type: 'broadcast', event: 'y-sync-step1',
                         payload: { from: CLIENT_ID, sv: bytesToB64(ourSv) } });
        }
      } catch (e) { console.warn('y-sync-step1 reply failed', e); }
    });

    channel.on('broadcast', { event: 'y-sync-step2' }, ({ payload }) => {
      if (!payload || payload.from === CLIENT_ID) return;
      if (payload.to && payload.to !== CLIENT_ID) return;
      try { Y.applyUpdate(ydoc, b64ToBytes(payload.u), 'remote'); }
      catch (e) { console.warn('y-sync-step2 apply failed', e); }
    });

    channel.on('broadcast', { event: 'y-update' }, ({ payload }) => {
      if (!payload || payload.from === CLIENT_ID) return;
      lastInbound = Date.now();
      try { Y.applyUpdate(ydoc, b64ToBytes(payload.u), 'remote'); }
      catch (e) { console.warn('y-update apply failed', e); }
    });

    channel.on('broadcast', { event: 'y-awareness' }, ({ payload }) => {
      if (!payload || payload.from === CLIENT_ID) return;
      lastInbound = Date.now();
      try { applyAwarenessUpdate(awareness, b64ToBytes(payload.a), 'remote'); }
      catch (e) { console.warn('y-awareness apply failed', e); }
    });

    channel.subscribe((status, err) => {
      console.log('[realtime] y:' + boardId, status, err || '');
      if (status === 'SUBSCRIBED') {
        subscribed = true;
        // Fresh subscription (or post-rebuild) — re-handshake with peers
        // and re-broadcast our awareness so peers see us immediately.
        handshakeWith.clear();
        const sv = Y.encodeStateVector(ydoc);
        channel.send({ type: 'broadcast', event: 'y-sync-step1',
                       payload: { from: CLIENT_ID, sv: bytesToB64(sv) } });
        if (awareness.getLocalState()) {
          const buf = encodeAwarenessUpdate(awareness, [awareness.clientID]);
          channel.send({ type: 'broadcast', event: 'y-awareness',
                         payload: { from: CLIENT_ID, a: bytesToB64(buf) } });
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        // Phoenix auto-rejoins via rejoinTimer when the socket is back.
        subscribed = false;
      } else if (status === 'CLOSED') {
        // Terminal: socket.remove(this) was called — the channel can't
        // rejoin. Tear down and build a fresh channel after a backoff.
        subscribed = false;
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

  // 5-min watchdog: if no inbound traffic while visible, force a full
  // transport bounce. Last-resort recovery for genuinely dead sockets.
  const watchdog = setInterval(() => {
    if (destroyed) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (Date.now() - lastInbound > WATCHDOG_TIMEOUT_MS) {
      lastInbound = Date.now();
      bounceRealtime();
    }
  }, 30000);

  // Heartbeat: every 4s, re-broadcast our awareness so peers' stale-state
  // timer doesn't prune us.
  const heartbeat = setInterval(() => {
    if (destroyed || !subscribed || !currentChannel) return;
    const buf = encodeAwarenessUpdate(awareness, [awareness.clientID]);
    currentChannel.send({ type: 'broadcast', event: 'y-awareness',
                          payload: { from: CLIENT_ID, a: bytesToB64(buf) } });
  }, 4000);

  return {
    awareness,
    destroy() {
      destroyed = true;
      if (awarenessTimer) { clearTimeout(awarenessTimer); awarenessTimer = null; }
      if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = null; }
      clearInterval(heartbeat);
      clearInterval(watchdog);
      ydoc.off('update', onYUpdate);
      awareness.off('update', onAwarenessUpdate);
      try { removeAwarenessStates(awareness, [awareness.clientID], 'local'); } catch (_) {}
      try { if (currentChannel) supabase.removeChannel(currentChannel); } catch (_) {}
    },
  };
}

function pickColor(id) {
  const palette = ['#4f8df8', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}
