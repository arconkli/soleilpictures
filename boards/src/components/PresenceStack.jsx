// Live presence indicator — shows colored avatar circles for everyone else
// currently in this board. Subscribes to the per-board Y.Awareness instance
// (passed in via getAwareness()).

import { useEffect, useState } from 'react';

function readPeers(awareness) {
  if (!awareness) return [];
  const peers = [];
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.clientID) return; // skip self
    const u = state?.user;
    if (!u) return;
    peers.push({ clientId, id: u.id, name: u.name || 'Someone', color: u.color || '#4f8df8' });
  });
  return peers;
}

export function PresenceStack({ getAwareness }) {
  const [peers, setPeers] = useState([]);
  const [tick, setTick] = useState(0);

  // Awareness can be created lazily after the realtime channel attaches.
  // Re-resolve on every parent render via getAwareness, and re-subscribe
  // whenever it changes.
  const awareness = getAwareness?.() || null;
  useEffect(() => {
    if (!awareness) { setPeers([]); return; }
    const refresh = () => setPeers(readPeers(awareness));
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

  const visible = peers.slice(0, 4);
  const overflow = peers.length - visible.length;

  return (
    <div className="presence-stack" aria-label={`${peers.length} other ${peers.length === 1 ? 'person' : 'people'} here`}>
      {visible.map(p => (
        <span key={p.clientId} className="presence-dot"
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
  );
}
