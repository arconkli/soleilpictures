// The board's Y.Doc + Awareness provider, against the party Worker.
//
// y-partyserver's YProvider (PartyKit's y-partykit provider until the party
// moved off PartyKit's hosted platform in October 2026) speaks the Yjs sync
// protocol, multiplexes Awareness over the same socket, and reconnects
// automatically. Auth is enforced at the WebSocket upgrade by the party
// Worker (party/index.ts). The room is /parties/main/<boardId>, as before.
//
// TOKEN REFRESH — the access_token rides the WS URL query string. `params`
// is an async FUNCTION, re-evaluated before every connect — YProvider also
// does it before its own AUTO-reconnects, which y-partykit did not. The
// reconnector (partyTokenRefresh.js) stays as the belt to that braces: it
// watches connection-close, and when the current session token differs from
// the one baked into the URL it runs a CHEAP refresh cycle — disconnect() +
// connect() on the SAME provider. Y.Doc, awareness and every handler stay
// alive; the sync delta is whatever changed while offline.
//
// LIVENESS — y-partykit renewed this tab's presence every 15 s, and closed a
// socket that had heard nothing for 30 s so it would reconnect. YProvider does
// neither: it stops awareness renewals (so peers do not time out) and has no
// watchdog, so a socket that died without a close — a laptop waking from
// sleep, a network that changed under it — looked connected while every edit
// stayed local. The keepalive below puts both back: a presence renewal every
// KEEPALIVE_MS, which the room echoes to every socket including this one, and
// a close when the previous renewal was never answered (partyKeepalive.js —
// never "silent for N seconds", which a throttled hidden tab always is).
//
// The previous design destroyed + reconstructed the entire provider on
// every TOKEN_REFRESHED/SIGNED_IN pair (URL-token limitation workaround):
// a full state resync + render burst, observed in the field landing in the
// middle of zoom gestures as multi-hundred-ms freezes.

import YProvider from 'y-partyserver/provider';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import { supabase } from './supabase.js';
import { createStaleTokenReconnector } from './partyTokenRefresh.js';
import { getGestureActiveUntil } from './perfReport.js';
import * as perf from './perf.js';
import { PARTY_HOST } from './partyHost.js';
import { socketLooksDead } from './partyKeepalive.js';

const KEEPALIVE_MS = 15_000;
const MESSAGE_AWARENESS = 1;

async function freshAccessToken() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? '';
  } catch (e) {
    console.warn('[partykit] no supabase session', e);
    return '';
  }
}

export function attachRealtime(ydoc, boardId, { user } = {}) {
  if (!boardId) return { destroy() {}, awareness: null };
  console.log('[partykit] board', boardId, 'attach (user:', user?.email || user?.id || 'anon', ')');

  const awareness = new Awareness(ydoc);
  if (user) {
    awareness.setLocalStateField('user', {
      id: user.id || '',
      name: user.name || user.email?.split('@')[0] || 'Someone',
      color: user.color || pickColor(user.id || ''),
    });
  }

  let destroyed = false;
  let lastUsedToken = '';

  // ONE provider for the lifetime of this attach.
  const _tCtor0 = perf.isEnabled() ? performance.now() : 0;
  const provider = new YProvider(PARTY_HOST, boardId, ydoc, {
    party: 'main',
    params: async () => {
      const accessToken = await freshAccessToken();
      if (accessToken) lastUsedToken = accessToken;   // what the URL will carry
      return { access_token: accessToken };
    },
    awareness,
  });
  if (_tCtor0) {
    const ms = performance.now() - _tCtor0;
    perf.mark('partykit.provider.construct.ms', ms);
    perf.bump('partykit.provider.construct');
    if (ms > 50) console.warn('[perf] slow partykit.provider.construct', `${ms.toFixed(0)}ms`, boardId);
  }

  const reconnector = createStaleTokenReconnector({
    getFreshToken: freshAccessToken,
    getLastUsedToken: () => lastUsedToken,
    isConnected: () => !!provider.wsconnected,
    isGestureActive: () => {
      try { return performance.now() < getGestureActiveUntil(); } catch (_) { return false; }
    },
    refresh: () => {
      if (destroyed) return;
      console.log('[partykit] board', boardId, 'refresh-connect (rotated token)');
      perf.bump('partykit.refreshConnect');
      // Same provider object: disconnect() closes + clears shouldConnect;
      // connect() re-evaluates the async params (fresh URL) before the base
      // class reconnects. Race-safe in both close-event orderings: if the old
      // socket's close lands first, connect() opens the new one; if connect()
      // wins, it finds the old socket still set and stands down, and the
      // close handler reconnects (refreshing params again) because
      // shouldConnect is true by then.
      try { provider.disconnect(); } catch (_) {}
      // YProvider.connect() is async (it awaits params); a rejection must not
      // surface as an unhandled one.
      try { Promise.resolve(provider.connect()).catch(() => {}); } catch (_) {}
    },
  });

  // Liveness (see the header).
  let lastPingAt = 0;
  const keepalive = setInterval(() => {
    if (destroyed || !provider.wsconnected || !provider.ws) { lastPingAt = 0; return; }
    if (socketLooksDead(provider.wsLastMessageReceived, lastPingAt)) {
      console.warn('[partykit] board', boardId, 'socket never answered its keepalive; reconnecting');
      perf.bump('partykit.deadSocket');
      lastPingAt = 0;
      try { provider.ws.close(); } catch (_) {}
      return;
    }
    try {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(awareness, [ydoc.clientID]));
      provider.ws.send(encoding.toUint8Array(enc));
      lastPingAt = Date.now();
    } catch (_) { /* the next tick tries again */ }
  }, KEEPALIVE_MS);

  // Intercept text frames on the underlying WS. The Yjs protocol is binary
  // (Uint8Array) frames; the room uses a raw TEXT frame for the out-of-band
  // "soleil-board-reset" signal that tells peers to remount their useYBoard so
  // a restore propagates without a CRDT-merge race. YProvider ignores text
  // frames without its __YPS: prefix, so our handler is the only consumer. The socket OBJECT is replaced on every (re)connect, so
  // the listener is wired per connection from the status handler
  // (WeakSet-deduped) — attaching once at construction left the signal dead
  // after the first auto-reconnect.
  const wiredSockets = new WeakSet();
  const onTextFrame = (e) => {
    if (typeof e.data !== 'string') return;
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }
    if (!msg || msg.type !== 'soleil-board-reset') return;
    if (msg.boardId && msg.boardId !== boardId) return;
    console.log('[partykit] board', boardId, '← reset signal');
    try {
      if (typeof window !== 'undefined' && typeof window.__soleilEmitBoardReset === 'function') {
        window.__soleilEmitBoardReset(boardId);
      } else {
        window.dispatchEvent(new CustomEvent('soleil-board-reset', { detail: { boardId } }));
      }
    } catch (_) {}
  };
  const wireResetListener = () => {
    const ws = provider.ws;
    if (!ws || typeof ws.addEventListener !== 'function' || wiredSockets.has(ws)) return;
    wiredSockets.add(ws);
    ws.addEventListener('message', onTextFrame);
  };

  let connectStartedAt = performance.now();
  provider.on('status', ({ status }) => {
    console.log('[partykit] board', boardId, status);
    if (status === 'connecting') {
      connectStartedAt = performance.now();   // re-anchor per attempt
      wireResetListener();
    } else if (status === 'connected') {
      wireResetListener();
      if (perf.isEnabled()) {
        const ms = performance.now() - connectStartedAt;
        perf.mark('partykit.connect.ms', ms);
        perf.bump('partykit.connect');
        if (ms > 300) console.warn('[perf] slow partykit.connect', `${ms.toFixed(0)}ms`, boardId);
      }
    }
  });
  // Fires on every socket close, including failed reconnect attempts — the
  // reconnector no-ops unless the session token actually changed.
  provider.on('connection-close', () => {
    if (!destroyed) reconnector.onConnectionClose();
  });

  // Auth events: a HEALTHY socket needs nothing (token is validated at
  // upgrade only). A down socket routes through the reconnector.
  const authSub = supabase.auth.onAuthStateChange((event) => {
    if (destroyed) return;
    if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
      if (provider.wsconnected) {
        console.log('[partykit] board', boardId, 'auth event', event, '— ignored (socket healthy)');
      } else {
        console.log('[partykit] board', boardId, 'auth event', event, '— socket down, token check');
        reconnector.onAuthEvent();
      }
    } else if (event === 'SIGNED_OUT') {
      try { provider.disconnect(); } catch (_) {}
    }
  });

  // When a restore flow fires soleil-board-reset, useYBoard tears down +
  // recreates this whole attach — the reconnector sits out so it can't pile
  // a refresh cycle on top of that.
  const onBoardReset = (e) => {
    if (e?.detail?.boardId && e.detail.boardId !== boardId) return;
    reconnector.noteResetSignal();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('soleil-board-reset', onBoardReset);
  }

  return {
    awareness,
    // Resolves true once this doc has finished the Yjs handshake with the room
    // (it holds everything the room holds), false on timeout. A caller writing
    // into a board it did not open — the folder import — waits for this so its
    // write MERGES with whatever the room has, rather than overwriting it.
    whenSynced(timeoutMs = 8000) {
      if (provider.synced) return Promise.resolve(true);
      return new Promise((resolve) => {
        const onSync = (isSynced) => {
          if (!isSynced) return;
          clearTimeout(timer);
          try { provider.off('sync', onSync); } catch (_) {}
          resolve(true);
        };
        const timer = setTimeout(() => {
          try { provider.off('sync', onSync); } catch (_) {}
          resolve(false);
        }, timeoutMs);
        provider.on('sync', onSync);
      });
    },
    destroy() {
      destroyed = true;
      clearInterval(keepalive);
      reconnector.dispose();
      try { provider.destroy(); } catch (_) {}
      try { authSub?.data?.subscription?.unsubscribe(); } catch (_) {}
      if (typeof window !== 'undefined') {
        try { window.removeEventListener('soleil-board-reset', onBoardReset); } catch (_) {}
      }
    },
  };
}

function pickColor(id) {
  const palette = ['#4f8df8', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}
