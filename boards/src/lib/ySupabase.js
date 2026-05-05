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
// Origins: incoming updates use origin 'remote' so the existing UndoManager
// (which tracks 'local') ignores them. Local edits keep their existing
// origins ('local', 'snapshot', etc.) — those broadcast normally.

import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { supabase } from './supabase.js';
import { bytesToB64, b64ToBytes } from './yhelpers.js';

// Cap awareness fan-out so we don't blow Supabase's per-tenant message
// rate. 80ms = ~12.5 broadcasts/sec/user, which feels live without
// flooding the channel.
const AWARENESS_THROTTLE_MS = 80;

// Build a stable session-only client id so peers can identify each other.
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

  // Use a Yjs-specific channel topic. Supabase realtime de-dupes channels
  // by topic, and the second .subscribe() on a deduped channel is a silent
  // no-op (RealtimeChannel.js guards: only registers callbacks if isClosed).
  // The chat module also opens board:{id}, so reusing that topic here means
  // our subscribe callback never fires and we never start syncing. Distinct
  // topic = independent channel = both subscribe paths work.
  const channel = supabase.channel(`y:${boardId}`, {
    config: { broadcast: { self: false, ack: false }, private: true },
  });

  let destroyed = false;
  let subscribed = false;
  let awarenessTimer = null;

  // ── Outgoing: Y.Doc updates ─────────────────────────────────────────────
  const onYUpdate = (update, origin) => {
    if (destroyed || !subscribed) return;
    if (origin === 'remote') return;       // don't echo what we just received
    if (origin === 'snapshot') return;     // initial snapshot apply; not an edit
    if (origin === 'restore') return;      // version restore — caller broadcasts separately if desired
    channel.send({ type: 'broadcast', event: 'y-update',
                   payload: { from: CLIENT_ID, u: bytesToB64(update) } });
  };
  ydoc.on('update', onYUpdate);

  // ── Outgoing: Awareness ────────────────────────────────────────────────
  const onAwarenessUpdate = ({ added, updated, removed }) => {
    if (destroyed || !subscribed) return;
    const changedClients = added.concat(updated, removed);
    if (changedClients.length === 0) return;
    if (awarenessTimer) return; // throttle
    awarenessTimer = setTimeout(() => {
      awarenessTimer = null;
      const buf = encodeAwarenessUpdate(awareness, changedClients);
      channel.send({ type: 'broadcast', event: 'y-awareness',
                     payload: { from: CLIENT_ID, a: bytesToB64(buf) } });
    }, AWARENESS_THROTTLE_MS);
  };
  awareness.on('update', onAwarenessUpdate);

  // ── Incoming handlers ──────────────────────────────────────────────────
  // Track peers we've already kicked off a sync handshake with, so we don't
  // ping-pong sync-step1 forever.
  const handshakeWith = new Set();

  // sync-step1: peer's state vector — reply with the updates they're missing,
  // and also send OUR sync-step1 back (bidirectional) so they can fill in any
  // updates we haven't broadcast yet. Without this, late-joiners wouldn't get
  // updates that happened before they subscribed.
  channel.on('broadcast', { event: 'y-sync-step1' }, ({ payload }) => {
    if (!payload || payload.from === CLIENT_ID) return;
    try {
      const sv = b64ToBytes(payload.sv);
      const update = Y.encodeStateAsUpdate(ydoc, sv);
      channel.send({ type: 'broadcast', event: 'y-sync-step2',
                     payload: { from: CLIENT_ID, to: payload.from, u: bytesToB64(update) } });
      // Reciprocate the handshake exactly once per peer.
      if (!handshakeWith.has(payload.from)) {
        handshakeWith.add(payload.from);
        const ourSv = Y.encodeStateVector(ydoc);
        channel.send({ type: 'broadcast', event: 'y-sync-step1',
                       payload: { from: CLIENT_ID, sv: bytesToB64(ourSv) } });
      }
    } catch (e) { console.warn('y-sync-step1 reply failed', e); }
  });

  // sync-step2: missing updates from a peer — apply them locally.
  channel.on('broadcast', { event: 'y-sync-step2' }, ({ payload }) => {
    if (!payload || payload.from === CLIENT_ID) return;
    if (payload.to && payload.to !== CLIENT_ID) return; // addressed to someone else
    try { Y.applyUpdate(ydoc, b64ToBytes(payload.u), 'remote'); }
    catch (e) { console.warn('y-sync-step2 apply failed', e); }
  });

  // y-update: incremental update from a peer.
  channel.on('broadcast', { event: 'y-update' }, ({ payload }) => {
    if (!payload || payload.from === CLIENT_ID) return;
    try { Y.applyUpdate(ydoc, b64ToBytes(payload.u), 'remote'); }
    catch (e) { console.warn('y-update apply failed', e); }
  });

  // y-awareness: peer awareness state.
  channel.on('broadcast', { event: 'y-awareness' }, ({ payload }) => {
    if (!payload || payload.from === CLIENT_ID) return;
    try { applyAwarenessUpdate(awareness, b64ToBytes(payload.a), 'remote'); }
    catch (e) { console.warn('y-awareness apply failed', e); }
  });

  // On subscribe, exchange state vectors with anyone else in the channel.
  channel.subscribe((status, err) => {
    // Surface every state change so live debugging in the console is easy.
    console.log('[realtime] y:' + boardId, status, err || '');
    if (status !== 'SUBSCRIBED') return;
    subscribed = true;
    const sv = Y.encodeStateVector(ydoc);
    channel.send({ type: 'broadcast', event: 'y-sync-step1',
                   payload: { from: CLIENT_ID, sv: bytesToB64(sv) } });
    // Also broadcast our current awareness so newly-arrived peers see us.
    if (awareness.getLocalState()) {
      const buf = encodeAwarenessUpdate(awareness, [awareness.clientID]);
      channel.send({ type: 'broadcast', event: 'y-awareness',
                     payload: { from: CLIENT_ID, a: bytesToB64(buf) } });
    }
  });

  return {
    awareness,
    destroy() {
      destroyed = true;
      if (awarenessTimer) { clearTimeout(awarenessTimer); awarenessTimer = null; }
      ydoc.off('update', onYUpdate);
      awareness.off('update', onAwarenessUpdate);
      try { removeAwarenessStates(awareness, [awareness.clientID], 'local'); } catch (_) {}
      try { supabase.removeChannel(channel); } catch (_) {}
    },
  };
}

// Deterministic pleasant cursor color from a user id string.
function pickColor(id) {
  const palette = ['#4f8df8', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}
