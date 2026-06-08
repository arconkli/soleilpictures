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
  let socket = null;
  let heartbeatTimer = null;
  let buildSeq = 0;
  // For rebuild coalescing — see scheduleRebuild below.
  let lastBuiltAt = 0;
  let rebuildTimer = null;
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
    lastBuiltAt = Date.now();
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
      // Clear the coalescing window so a subsequent auth event can rebuild
      // immediately — otherwise a failed-open inside the 1500ms window
      // would suppress the rebuild that uses the freshly-rotated token.
      lastBuiltAt = 0;
    });

    socket.addEventListener('error', (e) => {
      console.warn('[partykit] workspace', workspaceId, 'ERROR', e);
      onStatus?.('error');
      lastBuiltAt = 0;
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
  //
  // Coalescing rules (ported from yPartyKit.js — the original 250ms
  // debounce here was not enough; TOKEN_REFRESHED + SIGNED_IN firing
  // 50-150ms apart still produced "closed before connection established"
  // loops on the workspace WS):
  //   - 750ms debounce on the rebuild itself
  //   - skip if a build started within the last 1500ms (Supabase often
  //     fires TOKEN_REFRESHED + SIGNED_IN within 100ms of each other;
  //     only one rebuild for that pair)
  // The `close`/`error` handlers above clear `lastBuiltAt = 0` so a
  // failed open does not suppress the next rebuild attempt.
  const scheduleRebuild = (reason) => {
    const now = Date.now();
    if (now - lastBuiltAt < 1500) {
      console.log('[partykit] workspace', workspaceId, 'skip rebuild (', reason, ') — already rebuilt', now - lastBuiltAt, 'ms ago');
      return;
    }
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
      if (destroyed) return;
      lastBuiltAt = Date.now();
      open();
    }, 750);
  };
  const authSub = supabase.auth.onAuthStateChange((event) => {
    if (destroyed) return;
    if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
      console.log('[partykit] workspace', workspaceId, 'auth event', event);
      scheduleRebuild(event);
    } else if (event === 'SIGNED_OUT') {
      if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = null; }
      try { socket?.close(); } catch (_) {}
      socket = null;
    }
  });

  return {
    destroy() {
      destroyed = true;
      if (rebuildTimer) clearTimeout(rebuildTimer);
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
