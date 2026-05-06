// PartyKit-backed workspace presence.
//
// Drop-in replacement for `workspaceRealtime.js#attachWorkspacePresence`.
// Same return shape so useWorkspacePresence works unchanged.
//
// Uses partysocket (auto-reconnecting WebSocket) connected to the
// `workspace` party. The server fans out heartbeat broadcasts and prunes
// stale peers.

import PartySocket from 'partysocket';
import { supabase } from './supabase.js';

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999';
const HEARTBEAT_MS = 5000;

const TAB_ID = (() => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 't_' + Math.random().toString(36).slice(2, 12);
})();

export function attachWorkspacePresence(workspaceId, { user, getLocation, onPeers, onStatus }) {
  if (!workspaceId) {
    onStatus?.('disconnected');
    return { destroy() {}, ping() {}, broadcastLocation() {} };
  }

  let destroyed = false;
  let socket = null;
  let heartbeatTimer = null;
  let buildSeq = 0;
  // tabId → record. Mirror of server-side state for our local consumers.
  const peers = new Map();

  const sendLocation = () => {
    if (destroyed || !socket || socket.readyState !== WebSocket.OPEN) return;
    const location = getLocation?.();
    socket.send(JSON.stringify({
      type: 'here',
      tabId: TAB_ID,
      user: user ? { id: user.id, name: user.name, color: user.color, email: user.email } : null,
      location,
    }));
  };

  const open = async () => {
    const seq = ++buildSeq;
    let accessToken = '';
    try {
      const { data } = await supabase.auth.getSession();
      accessToken = data?.session?.access_token ?? '';
    } catch (_) {}
    if (destroyed || seq !== buildSeq) return;

    // Tear down any stale socket from a previous build (token rotated).
    if (socket) {
      try { socket.close(); } catch (_) {}
      socket = null;
    }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }

    socket = new PartySocket({
      host: PARTYKIT_HOST,
      party: 'workspace',
      room: workspaceId,
      query: { access_token: accessToken },
    });

    socket.addEventListener('open', () => {
      console.log('[partykit] workspace', workspaceId, 'OPEN');
      onStatus?.('connected');
      sendLocation();
      if (!heartbeatTimer) heartbeatTimer = setInterval(sendLocation, HEARTBEAT_MS);
    });

    socket.addEventListener('close', () => {
      console.log('[partykit] workspace', workspaceId, 'CLOSE');
      onStatus?.('disconnected');
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      // partysocket auto-reconnects; on reconnect we'll see another open.
    });

    socket.addEventListener('error', (e) => {
      console.warn('[partykit] workspace', workspaceId, 'ERROR', e);
      onStatus?.('error');
    });

    socket.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg?.type === 'roster' && Array.isArray(msg.peers)) {
        peers.clear();
        for (const p of msg.peers) {
          if (!p?.tabId || !p?.user) continue;
          peers.set(p.tabId, {
            key: `${p.user.id}:${p.tabId}`,
            tabId: p.tabId,
            user: p.user,
            location: p.location || null,
            lastSeen: Date.now(),
          });
        }
        onPeers?.([...peers.values()]);
      } else if (msg?.type === 'here' && msg?.from && msg?.user) {
        peers.set(msg.from, {
          key: `${msg.user.id}:${msg.from}`,
          tabId: msg.from,
          user: msg.user,
          location: msg.location || null,
          lastSeen: Date.now(),
        });
        onPeers?.([...peers.values()]);
      } else if (msg?.type === 'leave' && msg?.from) {
        peers.delete(msg.from);
        onPeers?.([...peers.values()]);
      }
    });
  };

  open();

  // Reconnect the workspace presence socket whenever Supabase rotates
  // the access token (mirrors the same fix in yPartyKit.js — without
  // it, the socket reconnects with a stale JWT after ~60 minutes and
  // gets stuck in a 401 retry loop).
  const authSub = supabase.auth.onAuthStateChange((event) => {
    if (destroyed) return;
    if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
      console.log('[partykit] workspace', workspaceId, 'auth event', event, '→ rebuilding socket');
      open();
    } else if (event === 'SIGNED_OUT') {
      try { socket?.close(); } catch (_) {}
      socket = null;
    }
  });

  return {
    destroy() {
      destroyed = true;
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      try { socket?.send(JSON.stringify({ type: 'leave', tabId: TAB_ID })); } catch (_) {}
      try { socket?.close(); } catch (_) {}
      socket = null;
      try { authSub?.data?.subscription?.unsubscribe(); } catch (_) {}
    },
    ping: sendLocation,
    broadcastLocation: sendLocation,
  };
}
