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

  // (Re)build the WS provider with a fresh token. Cheap to call —
  // tears down the old socket, opens a new one. Y.Doc + Awareness
  // instances are kept across rebuilds so app state is unaffected.
  const buildProvider = async () => {
    const seq = ++buildSeq;
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
    });
  };

  buildProvider();

  // Reconnect with the fresh JWT whenever Supabase rotates the token.
  // This is the load-bearing fix for the "site open all night, all
  // WebSockets stuck in 401 retry loop" symptom.
  const authSub = supabase.auth.onAuthStateChange((event) => {
    if (destroyed) return;
    if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
      console.log('[partykit] board', boardId, 'auth event', event, '→ rebuilding socket');
      buildProvider();
    } else if (event === 'SIGNED_OUT') {
      try { provider?.destroy(); } catch (_) {}
      provider = null;
    }
  });

  return {
    awareness,
    destroy() {
      destroyed = true;
      try { provider?.destroy(); } catch (_) {}
      try { authSub?.data?.subscription?.unsubscribe(); } catch (_) {}
    },
  };
}

function pickColor(id) {
  const palette = ['#4f8df8', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}
