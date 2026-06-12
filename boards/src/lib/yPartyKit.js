// PartyKit Y.Doc + Awareness provider.
//
// y-partykit speaks the Yjs sync protocol natively, multiplexes Awareness
// over the same socket, and reconnects automatically. Auth is enforced
// at the WebSocket upgrade by the party server (see party/auth.ts).
//
// TOKEN REFRESH — the access_token rides the WS URL query string. `params`
// is an async FUNCTION: YPartyKitProvider.connect() re-evaluates it and
// rebuilds the URL before every explicit (re)connect, so a Supabase JWT
// rotation (default hourly) needs NO action while the socket is healthy —
// the server validates the token at upgrade only. The one gap is the base
// provider's AUTO-reconnect path (setTimeout(setupWS) reuses this.url), so
// after the server closes a connection whose URL token went stale, native
// backoff would retry 401 forever. The reconnector (partyTokenRefresh.js)
// watches connection-close: when the current session token differs from the
// one baked into the URL it runs a CHEAP refresh cycle — disconnect() +
// connect() on the SAME provider. Y.Doc, awareness and every handler stay
// alive; the sync delta is whatever changed while offline.
//
// The previous design destroyed + reconstructed the entire provider on
// every TOKEN_REFRESHED/SIGNED_IN pair (URL-token limitation workaround):
// a full state resync + render burst, observed in the field landing in the
// middle of zoom gestures as multi-hundred-ms freezes.

import YPartyKitProvider from 'y-partykit/provider';
import { Awareness } from 'y-protocols/awareness';
import { supabase } from './supabase.js';
import { createStaleTokenReconnector } from './partyTokenRefresh.js';
import { getGestureActiveUntil } from './perfReport.js';
import * as perf from './perf.js';

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999';

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
  const provider = new YPartyKitProvider(PARTYKIT_HOST, boardId, ydoc, {
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
      // class reconnects. Race-safe in both close-event orderings — the URL
      // rebuild happens in YPartyKitProvider.connect() itself, and setupWS
      // only runs once shouldConnect is true AND the old socket is nulled.
      try { provider.disconnect(); } catch (_) {}
      try { provider.connect(); } catch (_) {}
    },
  });

  // Intercept text frames on the underlying WS. y-partykit's protocol is
  // binary (Uint8Array) Yjs frames; the server uses TEXT frames for
  // out-of-band control signals like "soleil-board-reset" that tell peers
  // to remount their useYBoard so a restore propagates without a CRDT-merge
  // race. y-partykit ignores text frames internally, so our handler is the
  // only consumer. The socket OBJECT is replaced on every (re)connect, so
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
    destroy() {
      destroyed = true;
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
