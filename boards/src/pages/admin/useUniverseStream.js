// SSE client for the admin universe.
//
// Two hooks:
//   useUniverseStats()                    → live ticker counters
//   useUniverseDeltas({ onNode, onEdge })  → live node/edge deltas
//
// Both:
//   - get the admin's Supabase access token from `supabase`
//   - reconnect with exponential backoff on transport failure
//   - on auth error (401/403 from the SSE) refresh the session
//     and reconnect with the new token, so a hour-long admin
//     session doesn't drop when JWTs expire
//   - report an explicit `status` ('connecting' | 'live' |
//     'reconnecting'). This matters more here than on a busy feed:
//     the platform creates a node about once every twenty minutes,
//     so a healthy universe and a dead socket look IDENTICAL from
//     the outside. Without a status the only honest reading of a
//     still screen is "I don't know", which is not what a wall
//     display is for.
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
// headers). Nodes and edges paginate INDEPENDENTLY: pass
// nodesCursor / edgesCursor (each is the last-seen created_at for
// that axis) and the Worker returns next_nodes_cursor /
// next_edges_cursor for the next page. Legacy single-`cursor` param
// still works server-side as a shared cursor.
export async function fetchSnapshotPage({
  nodesCursor = null,
  edgesCursor = null,
  nodeLimit   = 50000,
  edgeLimit   = 100000,
} = {}) {
  const token = await getToken();
  if (!token) throw new Error('no token');
  const qs = new URLSearchParams();
  if (nodesCursor != null) qs.set('nodes_cursor', nodesCursor);
  if (edgesCursor != null) qs.set('edges_cursor', edgesCursor);
  if (nodeLimit   != null) qs.set('node_limit',   String(nodeLimit));
  if (edgeLimit   != null) qs.set('edge_limit',   String(edgeLimit));
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
  const [status, setStatus] = useState('connecting');
  const esRef    = useRef(null);
  const stopped  = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let backoff = 500;

    const connect = async () => {
      if (stopped.current) return;
      setStatus((s) => (s === 'live' ? 'reconnecting' : s));
      try {
        const es = await openSse('stats');
        esRef.current = es;
        es.addEventListener('stats', (e) => {
          try { setStats(JSON.parse(e.data)); setError(null); setStatus('live'); backoff = 500; }
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
          setStatus('reconnecting');
          const delay = backoff;
          backoff = Math.min(backoff * 2, 30000);
          setTimeout(connect, delay);
        };
      } catch (e) {
        setError(e?.message || String(e));
        setStatus('reconnecting');
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

  return { stats, error, status };
}

// useUniverseDeltas — subscribes to /deltas. Calls callbacks for
// each new node/edge as it arrives. Handlers are not memoized
// internally — pass stable refs (or wrap in useCallback) to avoid
// re-subscribing on every render. `enabled: false` skips the
// subscription entirely (the synthetic QA harness has no SSE server
// to talk to).
//
// `sinceRef` is a ref holding a SERVER-authored ISO timestamp — the
// newest created_at the snapshot walk actually saw. A ref rather than
// a value because the snapshot resolves after mount and this hook must
// not re-subscribe every time it moves; `ready` gates the first connect.
//
// This used to be `new Date().toISOString()` — the BROWSER's clock.
// A machine running a few minutes fast asked the server for everything
// after a moment that had not happened yet, so the stream stayed silent
// for exactly that long; an hour fast, silent for an hour. Because this
// universe genuinely does go twenty minutes between nodes, that failure
// was indistinguishable from working. Server-authored time cannot skew
// against the server.
//
// An empty snapshot leaves no server timestamp to quote, so `since` is
// omitted entirely and party/universe.ts falls back to its own clock —
// still server time, just measured a hop later.
export function useUniverseDeltas({
  sinceRef, ready = true, onNode, onEdge, onBatch, onAuthError, enabled = true,
}) {
  const esRef   = useRef(null);
  const stopped = useRef(false);
  const [status, setStatus] = useState('connecting');
  const [lastDeltaAt, setLastDeltaAt] = useState(null);

  useEffect(() => {
    if (!enabled || !ready) return undefined;
    stopped.current = false;
    let backoff = 1000;
    let lastSeen = sinceRef?.current || null;

    const connect = async () => {
      if (stopped.current) return;
      try {
        const es = await openSse('deltas', lastSeen ? { since: lastSeen } : {});
        esRef.current = es;
        // Open only means the socket is up; the Worker sends nothing
        // until something is actually created. That is the normal
        // steady state here, so 'live' must not wait for a first frame.
        setStatus('live');

        es.addEventListener('node', (e) => {
          try {
            const n = JSON.parse(e.data);
            lastSeen = n.created_at || lastSeen;
            setLastDeltaAt(Date.now());
            onNode?.(n);
          } catch (_) {}
        });
        es.addEventListener('edge', (e) => {
          try { const x = JSON.parse(e.data); lastSeen = x.created_at || lastSeen; onEdge?.(x); }
          catch (_) {}
        });
        es.addEventListener('batch', (e) => {
          try {
            const { nodes = [], edges = [] } = JSON.parse(e.data) || {};
            // `lastSeen` can be null now (empty snapshot), and `x > null`
            // is true for any string, so seed off the first row rather
            // than relying on the comparison.
            for (const n of nodes) if (!lastSeen || n.created_at > lastSeen) lastSeen = n.created_at || lastSeen;
            for (const x of edges) if (!lastSeen || x.created_at > lastSeen) lastSeen = x.created_at || lastSeen;
            if (nodes.length) setLastDeltaAt(Date.now());
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
          setStatus('reconnecting');
          const delay = backoff;
          backoff = Math.min(backoff * 2, 30000);
          setTimeout(connect, delay);
        };

        backoff = 1000;
      } catch (e) {
        if (stopped.current) return;
        setStatus('reconnecting');
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
    // pass stable refs. sinceRef is a ref, read at connect time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ready]);

  return { status, lastDeltaAt };
}
