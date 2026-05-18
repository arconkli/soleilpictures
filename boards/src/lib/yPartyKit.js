// PartyKit Y.Doc + Awareness provider.
//
// y-partykit speaks the Yjs sync protocol natively, multiplexes Awareness
// over the same socket, and reconnects automatically. Auth is enforced
// at the WebSocket upgrade by the party server (see party/auth.ts).
//
// IMPORTANT — token refresh: the access_token is encoded in the WS URL
// query string at connect time. partysocket auto-reconnects but reuses
// the same URL — so when Supabase rotates the JWT (default every 60
// minutes), the WS keeps reconnecting with the stale token and gets
// 401 forever. We listen for `TOKEN_REFRESHED` from supabase auth and
// rebuild the provider with the new token. Same goes for the manual
// "I just woke up from sleep" refresh below.

import YPartyKitProvider from 'y-partykit/provider';
import { Awareness } from 'y-protocols/awareness';
import { supabase } from './supabase.js';

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999';

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

  let provider = null;
  let destroyed = false;
  let buildSeq = 0;
  // Hoisted here so `buildProvider` (defined below and called immediately)
  // can update lastBuiltAt before the rebuild-coalescing infra runs.
  let lastBuiltAt = 0;
  let resetCooldownUntil = 0;
  let rebuildTimer = null;

  // (Re)build the WS provider with a fresh token. Cheap to call —
  // tears down the old socket, opens a new one. Y.Doc + Awareness
  // instances are kept across rebuilds so app state is unaffected.
  const buildProvider = async () => {
    const seq = ++buildSeq;
    lastBuiltAt = Date.now();
    let accessToken = '';
    try {
      const { data } = await supabase.auth.getSession();
      accessToken = data?.session?.access_token ?? '';
    } catch (e) {
      console.warn('[partykit] no supabase session', e);
    }
    // If a newer rebuild has started while we were awaiting, bail.
    if (destroyed || seq !== buildSeq) return;

    if (provider) {
      try { provider.destroy(); } catch (_) {}
      provider = null;
    }

    provider = new YPartyKitProvider(PARTYKIT_HOST, boardId, ydoc, {
      params: { access_token: accessToken },
      awareness,
    });
    provider.on('status', ({ status }) => {
      console.log('[partykit] board', boardId, status);
      // If the connection drops or fails to open (e.g. the WS upgrade
      // returned 401 because the token we used was already stale), clear
      // the coalescing window so a subsequent TOKEN_REFRESHED can rebuild
      // with the new token. Otherwise the 1500ms "already rebuilt" skip
      // suppresses the very retry that would have used the fresh JWT.
      if (status === 'disconnected') lastBuiltAt = 0;
    });
    // Intercept text frames on the underlying WS. y-partykit's protocol
    // is binary (Uint8Array) Yjs frames; the server uses TEXT frames for
    // out-of-band control signals like "soleil-board-reset" that tell
    // peers to remount their useYBoard so a restore propagates without
    // a CRDT-merge race. y-partykit ignores text frames internally, so
    // our handler is the only consumer.
    const ws = provider.ws;
    if (ws && typeof ws.addEventListener === 'function') {
      ws.addEventListener('message', (e) => {
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
      });
    }
  };

  buildProvider();

  // Reconnect with the fresh JWT whenever Supabase rotates the token.
  // This is the load-bearing fix for the "site open all night, all
  // WebSockets stuck in 401 retry loop" symptom.
  //
  // Debounced: TOKEN_REFRESHED and SIGNED_IN often fire back-to-back
  // (within tens of ms) when supabase auto-recovers a session. Without
  // a debounce, each event tore down the in-flight WebSocket before
  // it finished opening, producing a "closed before connection
  // established" loop.
  //
  // Coalescing rules (stricter than the original 250ms):
  //  - 750ms debounce on the rebuild itself
  //  - any auth event within 1500ms of the LAST completed build is a
  //    no-op (Supabase often fires TOKEN_REFRESHED + SIGNED_IN within
  //    100ms of each other; we only want one rebuild for that pair)
  //  - 2000ms cooldown after a `soleil-board-reset` event: the reset
  //    flow remounts the entire useYBoard handle (which destroys+
  //    recreates this provider), so an auth-driven rebuild on top of
  //    that pile-up causes the "closed before connection established"
  //    storm we just shipped a fix for. Sit out for 2s.
  const scheduleRebuild = (reason) => {
    const now = Date.now();
    if (now < resetCooldownUntil) {
      console.log('[partykit] board', boardId, 'skip rebuild (', reason, ') — in reset cooldown for', resetCooldownUntil - now, 'ms');
      return;
    }
    if (now - lastBuiltAt < 1500) {
      console.log('[partykit] board', boardId, 'skip rebuild (', reason, ') — already rebuilt', now - lastBuiltAt, 'ms ago');
      return;
    }
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
      if (destroyed) return;
      lastBuiltAt = Date.now();
      buildProvider();
    }, 750);
  };
  const authSub = supabase.auth.onAuthStateChange((event) => {
    if (destroyed) return;
    if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
      console.log('[partykit] board', boardId, 'auth event', event);
      scheduleRebuild(event);
    } else if (event === 'SIGNED_OUT') {
      if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = null; }
      try { provider?.destroy(); } catch (_) {}
      provider = null;
    }
  });

  // When a restore flow fires soleil-board-reset, useYBoard will tear
  // down + recreate this provider. We don't want auth events to also
  // pile a rebuild on top of that — set a cooldown.
  const onBoardReset = (e) => {
    if (e?.detail?.boardId && e.detail.boardId !== boardId) return;
    resetCooldownUntil = Date.now() + 2000;
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('soleil-board-reset', onBoardReset);
  }

  return {
    awareness,
    destroy() {
      destroyed = true;
      if (rebuildTimer) clearTimeout(rebuildTimer);
      try { provider?.destroy(); } catch (_) {}
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
