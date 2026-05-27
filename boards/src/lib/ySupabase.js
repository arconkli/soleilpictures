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
import * as perf from './perf.js';

// 250ms = 4 broadcasts/sec/user. Supabase free-tier realtime enforces
// a ~10 messages/sec per-tenant limit (verified via realtime logs:
// "MessagePerSecondRateLimitReached"). 10Hz × 2 users + heartbeats was
// blowing past it and the server was closing channels. 4Hz × 2 users +
// heartbeats fits comfortably under 10/sec. Receiver-side rAF lerp
// interpolates so the visual difference is small.
const AWARENESS_THROTTLE_MS = 250;
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
  let lastInbound = Date.now();
  const handshakeWith = new Set();

  // Y-updates are batched + merged. A burst of edits (typing, dragging
  // a card across the canvas) emits dozens of small Y.Doc updates per
  // second. Sending each one would blow past Supabase's free-tier
  // ~10 messages/sec tenant cap. Y.mergeUpdates collapses queued
  // updates into one logically-equivalent update, so the receiver sees
  // identical state with a single broadcast per flush window.
  const Y_FLUSH_MS = 200;            // 5 broadcasts/sec ceiling for edits
  let yQueue = [];
  let yFlushTimer = null;
  const flushYQueue = () => {
    yFlushTimer = null;
    if (destroyed || !subscribed || !currentChannel) { yQueue = []; return; }
    if (yQueue.length === 0) return;
    const merged = yQueue.length === 1 ? yQueue[0] : Y.mergeUpdates(yQueue);
    yQueue = [];
    currentChannel.send({ type: 'broadcast', event: 'y-update',
                          payload: { from: CLIENT_ID, u: bytesToB64(merged) } });
  };
  const onYUpdate = (update, origin) => {
    if (destroyed) return;
    if (origin === 'remote') return;
    if (origin === 'snapshot') return;
    if (origin === 'restore') return;
    yQueue.push(update);
    if (!yFlushTimer) yFlushTimer = setTimeout(flushYQueue, Y_FLUSH_MS);
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
      try {
        const bytes = b64ToBytes(payload.u);
        const _t0 = perf.isEnabled() ? performance.now() : 0;
        Y.applyUpdate(ydoc, bytes, 'remote');
        if (_t0) {
          const ms = performance.now() - _t0;
          perf.mark('yboard.applyRemote.ms', ms);
          perf.bump('yboard.remoteUpdates');
          if (ms > 100) console.warn('[perf] slow yboard.applyRemote(sync2)', `${ms.toFixed(0)}ms`, `${(bytes.length/1024).toFixed(1)}KB`);
        }
      }
      catch (e) { console.warn('y-sync-step2 apply failed', e); }
    });

    channel.on('broadcast', { event: 'y-update' }, ({ payload }) => {
      if (!payload || payload.from === CLIENT_ID) return;
      lastInbound = Date.now();
      try {
        const bytes = b64ToBytes(payload.u);
        const _t0 = perf.isEnabled() ? performance.now() : 0;
        Y.applyUpdate(ydoc, bytes, 'remote');
        if (_t0) {
          const ms = performance.now() - _t0;
          perf.mark('yboard.applyRemote.ms', ms);
          perf.bump('yboard.remoteUpdates');
          if (ms > 100) console.warn('[perf] slow yboard.applyRemote(update)', `${ms.toFixed(0)}ms`, `${(bytes.length/1024).toFixed(1)}KB`);
        }
      }
      catch (e) { console.warn('y-update apply failed', e); }
    });

    channel.on('broadcast', { event: 'y-awareness' }, ({ payload }) => {
      if (!payload || payload.from === CLIENT_ID) return;
      lastInbound = Date.now();
      try { applyAwarenessUpdate(awareness, b64ToBytes(payload.a), 'remote'); }
      catch (e) { console.warn('y-awareness apply failed', e); }
    });

    let subscribedAt = 0;
    channel.subscribe((status, err) => {
      const dt = subscribedAt ? `(after ${((Date.now() - subscribedAt) / 1000).toFixed(1)}s)` : '';
      console.log('[realtime] y:' + boardId, status, dt, err || '');
      if (status === 'SUBSCRIBED') {
        subscribedAt = Date.now();
        subscribed = true;
        handshakeWith.clear();
        const sv = Y.encodeStateVector(ydoc);
        channel.send({ type: 'broadcast', event: 'y-sync-step1',
                       payload: { from: CLIENT_ID, sv: bytesToB64(sv) } });
        if (awareness.getLocalState()) {
          const buf = encodeAwarenessUpdate(awareness, [awareness.clientID]);
          channel.send({ type: 'broadcast', event: 'y-awareness',
                         payload: { from: CLIENT_ID, a: bytesToB64(buf) } });
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // No rebuild on CLOSED — Supabase free-tier rate-limits joins, and
        // looping rebuild on CLOSED creates a server-side feedback loop
        // (every rebuild costs a join, server closes from rate limit, we
        // rebuild again). Phoenix's own rejoinTimer handles transient
        // CHANNEL_ERROR / TIMED_OUT. CLOSED is terminal until refresh.
        subscribed = false;
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

  // Heartbeat: every 15s, re-broadcast our awareness so peers' stale-
  // state timer doesn't prune us. Was 4s but combined with 10Hz cursor
  // we were blowing past the tenant-wide message-per-second cap. The
  // y-protocols Awareness internal prune is 30s, so 15s is safe.
  const heartbeat = setInterval(() => {
    if (destroyed || !subscribed || !currentChannel) return;
    const buf = encodeAwarenessUpdate(awareness, [awareness.clientID]);
    currentChannel.send({ type: 'broadcast', event: 'y-awareness',
                          payload: { from: CLIENT_ID, a: bytesToB64(buf) } });
  }, 15000);

  return {
    awareness,
    destroy() {
      destroyed = true;
      if (awarenessTimer) { clearTimeout(awarenessTimer); awarenessTimer = null; }
      if (yFlushTimer) { clearTimeout(yFlushTimer); yFlushTimer = null; }
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
