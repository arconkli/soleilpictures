// PartyKit Y.Doc + Awareness provider.
//
// Drop-in replacement for the Supabase-backed `ySupabase.js#attachRealtime`.
// Same return shape `{ awareness, destroy }` so callers (yboard.js,
// useYBoard, etc.) work unchanged.
//
// y-partykit speaks the Yjs sync protocol natively, multiplexes Awareness
// over the same socket, and reconnects automatically. Auth is enforced
// at the WebSocket upgrade by the party server (see party/auth.ts).

import YPartyKitProvider from 'y-partykit/provider';
import { Awareness } from 'y-protocols/awareness';
import { supabase } from './supabase.js';

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999';

export function attachRealtime(ydoc, boardId, { user } = {}) {
  if (!boardId) return { destroy() {}, awareness: null };
  console.log('[partykit] board', boardId, 'attach (user:', user?.email || user?.id || 'anon', ')');

  // Create awareness up front so callers can get a stable reference
  // before the async token fetch completes. y-partykit will use the
  // same instance once we hand it over.
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

  (async () => {
    let accessToken = '';
    try {
      const { data } = await supabase.auth.getSession();
      accessToken = data?.session?.access_token ?? '';
    } catch (e) {
      console.warn('[partykit] no supabase session', e);
    }
    if (destroyed) return;
    provider = new YPartyKitProvider(
      PARTYKIT_HOST,
      boardId,
      ydoc,
      {
        params: { access_token: accessToken },
        awareness,
      },
    );
    provider.on('status', ({ status }) => {
      console.log('[partykit] board', boardId, status);
    });
    // Diagnostic: confirm the provider is using the SAME awareness
    // instance we exposed via attachRealtime. If these IDs differ, the
    // provider built its own and our setLocalStateField writes go
    // nowhere. Should print same number on both sides.
    console.log('[partykit] board', boardId, 'awareness clientID=', awareness.clientID,
      'provider.awareness same?', provider.awareness === awareness);
    awareness.on('change', () => {
      const sz = awareness.getStates().size;
      console.log('[partykit] board', boardId, 'awareness change → states=', sz);
    });
  })();

  return {
    awareness,
    destroy() {
      destroyed = true;
      try { provider?.destroy(); } catch (_) {}
    },
  };
}

function pickColor(id) {
  const palette = ['#4f8df8', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}
