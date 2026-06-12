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
// Workspace presence (who's in the workspace / which board) tolerates a few
// seconds of staleness — live board cursors are a separate 250ms-throttled
// system (yPartyKit awareness). 15s matches the Supabase realtime workspace
// cadence and cuts steady-state presence traffic 3x while users sit idle.
const HEARTBEAT_MS = 15000;

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
  let heartbeatTimer = null;
  // tabId → record. Mirror of server-side state for our local consumers.
  const peers = new Map();

  // ONE socket for the lifetime of this attach. `query` is an async
  // function: partysocket resolves it on EVERY connect attempt (verified:
  // ReconnectingWebSocket._connect → _getNextUrl(urlProvider)), so every
  // auto-reconnect carries a fresh JWT natively. The old design tore the
  // socket down and rebuilt it on each TOKEN_REFRESHED/SIGNED_IN pair —
  // with the function form, a token rotation needs no action at all: a
  // healthy socket keeps working (auth is validated at upgrade only) and a
  // 401-closed socket heals on its own next retry.
  const socket = new PartySocket({
    host: PARTYKIT_HOST,
    party: 'workspace',
    room: workspaceId,
    query: async () => {
      let accessToken = '';
      try {
        const { data } = await supabase.auth.getSession();
        accessToken = data?.session?.access_token ?? '';
      } catch (_) {}
      return { access_token: accessToken };
    },
  });

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

  // partysocket re-dispatches events from each underlying connection on the
  // stable socket object, so these listeners survive every reconnect.
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
    // partysocket auto-reconnects (with a freshly-resolved query above);
    // on reconnect we'll see another open.
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

  // Token rotations need no handling (see the query function above). Only
  // sign-out/in flips the socket off and back on.
  const authSub = supabase.auth.onAuthStateChange((event) => {
    if (destroyed) return;
    if (event === 'SIGNED_OUT') {
      try { socket.close(); } catch (_) {}
    } else if (event === 'SIGNED_IN' && socket.readyState === WebSocket.CLOSED) {
      try { socket.reconnect(); } catch (_) {}
    }
  });

  return {
    destroy() {
      destroyed = true;
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      try { socket.send(JSON.stringify({ type: 'leave', tabId: TAB_ID })); } catch (_) {}
      try { socket.close(); } catch (_) {}
      try { authSub?.data?.subscription?.unsubscribe(); } catch (_) {}
    },
    ping: sendLocation,
    broadcastLocation: sendLocation,
  };
}
