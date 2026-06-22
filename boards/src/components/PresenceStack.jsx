// Live presence facepile — colored avatars for everyone else currently on this
// board, with a hover roster that names exactly who's here. Subscribes to the
// per-board Y.Awareness instance (via getAwareness()).
//
// At scale this is the authoritative "who's here": cursors on canvas are
// viewport-culled and hard-capped (CanvasPresence), so the facepile + roster is
// where the overflow stays visible. Updates are gated on an IDENTITY
// fingerprint so the list never re-renders on a bare cursor move (awareness
// 'change' fires continuously at scale) — the same storm guard CanvasPresence
// uses. Multi-tab presences collapse to one entry per user.

import { useEffect, useRef, useState } from 'react';

const MAX_AVATARS = 4;

function readPeers(awareness) {
  if (!awareness) return [];
  const byUser = new Map(); // dedupe by user.id so multi-tab = one avatar
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.clientID) return; // skip self
    const u = state?.user;
    if (!u || !u.id) return;
    if (!byUser.has(u.id)) {
      byUser.set(u.id, { id: u.id, name: u.name || 'Someone', color: u.color || '#4f8df8' });
    }
  });
  return [...byUser.values()];
}

function fingerprint(peers) {
  return peers.map(p => `${p.id}|${p.name}|${p.color}`).sort().join('||');
}

export function PresenceStack({ getAwareness }) {
  const [peers, setPeers] = useState([]);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const fpRef = useRef('');

  // Awareness can be created lazily after the realtime channel attaches.
  // Re-resolve on every parent render via getAwareness, re-subscribe on change.
  const awareness = getAwareness?.() || null;
  useEffect(() => {
    if (!awareness) { setPeers([]); fpRef.current = ''; return; }
    const refresh = () => {
      const next = readPeers(awareness);
      const fp = fingerprint(next);
      if (fp === fpRef.current) return; // identity unchanged → no re-render
      fpRef.current = fp;
      setPeers(next);
    };
    refresh();
    awareness.on('change', refresh);
    return () => awareness.off('change', refresh);
  }, [awareness, tick]);

  // If awareness wasn't ready on mount, poll briefly until it is.
  useEffect(() => {
    if (awareness) return;
    const t = setInterval(() => setTick(n => n + 1), 500);
    return () => clearInterval(t);
  }, [awareness]);

  if (peers.length === 0) return null;

  const visible = peers.slice(0, MAX_AVATARS);
  const overflow = peers.length - visible.length;
  const label = `${peers.length} other ${peers.length === 1 ? 'person' : 'people'} here`;

  return (
    <div className="presence-stack-wrap"
         onMouseEnter={() => setOpen(true)}
         onMouseLeave={() => setOpen(false)}>
      <div className="presence-stack" aria-label={label}>
        {visible.map(p => (
          <span key={p.id} className="presence-dot"
                style={{ background: p.color }}
                title={p.name}>
            {p.name?.[0]?.toUpperCase() || '?'}
          </span>
        ))}
        {overflow > 0 && (
          <span className="presence-dot presence-overflow" title={`+${overflow} more`}>
            +{overflow}
          </span>
        )}
      </div>
      {open && (
        <div className="presence-roster" role="list" aria-label={label}>
          <div className="presence-roster-head">{label}</div>
          {peers.map(p => (
            <div key={p.id} className="presence-roster-row" role="listitem">
              <span className="presence-dot presence-roster-dot" style={{ background: p.color }}>
                {p.name?.[0]?.toUpperCase() || '?'}
              </span>
              <span className="presence-roster-name">{p.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
