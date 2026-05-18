// SSE client for the admin universe.
//
// Two hooks:
//   useUniverseStats()                    → live ticker counters
//   useUniverseDeltas({ onAdd, onResync }) → live node/edge deltas
//
// Both:
//   - get the admin's Supabase access token from `supabase`
//   - reconnect with exponential backoff on transport failure
//   - on auth error (401/403 from the SSE) refresh the session
//     and reconnect with the new token, so a hour-long admin
//     session doesn't drop when JWTs expire
//
// PartyKit host is read from VITE_PARTYKIT_HOST (defaults to
// localhost:1999 for dev), matching boards/src/lib/yPartyKit.js.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999';
const PARTY_BASE = `${PARTYKIT_HOST.includes('://') ? '' : (PARTYKIT_HOST.startsWith('localhost') ? 'http://' : 'https://')}${PARTYKIT_HOST}/parties/universe/main`;

async function getToken() {
  if (!supabase) return null;
  // Fresh-by-default: refresh if close to expiry, otherwise use cached.
  // Long SSE connections will hit 401 anyway on expiry and reconnect.
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

// Build an EventSource against `${PARTY_BASE}/<path>?token=<jwt>&...`.
// EventSource can't send custom headers; the token rides in the URL.
async function openSse(path, params = {}) {
  const token = await getToken();
  if (!token) throw new Error('no token');
  const qs = new URLSearchParams({ token, ...params }).toString();
  return new EventSource(`${PARTY_BASE}/${path}?${qs}`);
}

// Plain fetch with the bearer header (snapshot is not SSE — supports
// headers). Returns parsed JSON or throws.
export async function fetchSnapshotPage({ cursor = null, nodeLimit = 50000, edgeLimit = 100000 } = {}) {
  const token = await getToken();
  if (!token) throw new Error('no token');
  const qs = new URLSearchParams();
  if (cursor != null)         qs.set('cursor',     cursor);
  if (nodeLimit != null)      qs.set('node_limit', String(nodeLimit));
  if (edgeLimit != null)      qs.set('edge_limit', String(edgeLimit));
  const url = `${PARTY_BASE}/snapshot?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`snapshot ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

// useUniverseStats — subscribes to the /stats SSE and exposes the
// most recent counters object.
export function useUniverseStats() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const esRef    = useRef(null);
  const stopped  = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let backoff = 500;

    const connect = async () => {
      if (stopped.current) return;
      try {
        const es = await openSse('stats');
        esRef.current = es;
        es.addEventListener('stats', (e) => {
          try { setStats(JSON.parse(e.data)); setError(null); backoff = 500; }
          catch (_) {}
        });
        es.addEventListener('error', (e) => {
          // Server may have written event:error before closing — try to read it.
          try {
            const data = e?.data && JSON.parse(e.data);
            if (data?.code === 401 || data?.code === 403) {
              try { es.close(); } catch (_) {}
              esRef.current = null;
              // Auth failure → refresh session and reconnect quickly.
              supabase?.auth.refreshSession().finally(() => {
                if (!stopped.current) setTimeout(connect, 200);
              });
              return;
            }
          } catch (_) {}
        });
        es.onerror = () => {
          // EventSource's generic error fires for both transient drops
          // and permanent failures. Close, back off, retry.
          try { es.close(); } catch (_) {}
          esRef.current = null;
          if (stopped.current) return;
          setError('reconnecting…');
          const delay = backoff;
          backoff = Math.min(backoff * 2, 30000);
          setTimeout(connect, delay);
        };
      } catch (e) {
        setError(e?.message || String(e));
        if (stopped.current) return;
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30000);
      }
    };

    connect();
    return () => {
      stopped.current = true;
      try { esRef.current?.close(); } catch (_) {}
      esRef.current = null;
    };
  }, []);

  return { stats, error };
}

// useUniverseDeltas — subscribes to /deltas. Calls callbacks for
// each new node/edge as it arrives. Handlers are not memoized
// internally — pass stable refs (or wrap in useCallback) to avoid
// re-subscribing on every render.
export function useUniverseDeltas({ since, onNode, onEdge, onBatch, onAuthError }) {
  const esRef   = useRef(null);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let backoff = 1000;
    let lastSeen = since || new Date().toISOString();

    const connect = async () => {
      if (stopped.current) return;
      try {
        const es = await openSse('deltas', { since: lastSeen });
        esRef.current = es;

        es.addEventListener('node', (e) => {
          try { const n = JSON.parse(e.data); lastSeen = n.created_at || lastSeen; onNode?.(n); }
          catch (_) {}
        });
        es.addEventListener('edge', (e) => {
          try { const x = JSON.parse(e.data); lastSeen = x.created_at || lastSeen; onEdge?.(x); }
          catch (_) {}
        });
        es.addEventListener('batch', (e) => {
          try {
            const { nodes = [], edges = [] } = JSON.parse(e.data) || {};
            for (const n of nodes) lastSeen = n.created_at > lastSeen ? n.created_at : lastSeen;
            for (const x of edges) lastSeen = x.created_at > lastSeen ? x.created_at : lastSeen;
            onBatch?.({ nodes, edges });
          } catch (_) {}
        });
        es.addEventListener('error', (e) => {
          try {
            const data = e?.data && JSON.parse(e.data);
            if (data?.code === 401 || data?.code === 403) {
              try { es.close(); } catch (_) {}
              esRef.current = null;
              onAuthError?.();
              supabase?.auth.refreshSession().finally(() => {
                if (!stopped.current) setTimeout(connect, 200);
              });
              return;
            }
          } catch (_) {}
        });
        es.onerror = () => {
          try { es.close(); } catch (_) {}
          esRef.current = null;
          if (stopped.current) return;
          const delay = backoff;
          backoff = Math.min(backoff * 2, 30000);
          setTimeout(connect, delay);
        };

        backoff = 1000;
      } catch (e) {
        if (stopped.current) return;
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30000);
      }
    };

    connect();
    return () => {
      stopped.current = true;
      try { esRef.current?.close(); } catch (_) {}
      esRef.current = null;
    };
    // We intentionally don't react to handler-prop changes — callers
    // pass stable refs. since is captured at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
