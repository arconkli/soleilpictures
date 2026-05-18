import { useEffect, useRef, useState } from 'react';
// Feature flag matches yboard.js — both must be on the same transport.
import { attachWorkspacePresence as attachWorkspacePresencePartyKit } from '../lib/workspacePartyKit.js';
import { attachWorkspacePresence as attachWorkspacePresenceSupabase } from '../lib/workspaceRealtime.js';
const attachWorkspacePresence = import.meta.env.VITE_USE_PARTYKIT === 'true'
  ? attachWorkspacePresencePartyKit
  : attachWorkspacePresenceSupabase;

// Hook wrapping the workspace presence channel.
//   workspaceId — required
//   user        — { id, name, color, email }
//   location    — { boardId, boardName, surface }  (read on every render
//                  so the next heartbeat reflects the latest state)
//
// Returns { peers, status, ping }
//   peers  — array of remote presences { user, location, tabId, lastSeen }
//            EXCLUDING the local user (other tabs / stale entries
//            of the same user.id are filtered out so the user
//            never sees themselves in the peer list)
//   status — 'connecting' | 'connected' | 'error' | 'disconnected'
//   ping   — call to broadcast location immediately (e.g. on board switch)
export function useWorkspacePresence({ workspaceId, user, location }) {
  const [rawPeers, setRawPeers] = useState([]);
  const [status, setStatus] = useState('connecting');
  const handleRef = useRef(null);
  // Stash the latest location in a ref so the heartbeat closure always
  // reads the current one without us re-attaching the channel on each move.
  const locRef = useRef(location);
  locRef.current = location;

  useEffect(() => {
    if (!workspaceId || !user?.id) return;
    setStatus('connecting');
    setRawPeers([]);
    // Defer the ws: join by 2s so the board: channel gets to subscribe
    // first. Supabase free-tier has a low join-rate cap and concurrent
    // channel opens at page load were starving the board: channel.
    const timer = setTimeout(() => {
      const handle = attachWorkspacePresence(workspaceId, {
        user,
        getLocation: () => locRef.current,
        onPeers: setRawPeers,
        onStatus: setStatus,
      });
      handleRef.current = handle;
    }, 2000);
    return () => {
      clearTimeout(timer);
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, user?.id, user?.name, user?.color]);

  // Push a fresh heartbeat whenever the location changes so peers see the
  // navigation immediately rather than waiting for the next interval tick.
  // pageId / docCardId are included so doc-page switches and doc-card
  // open/close are visible to peers within ~50ms (vs the 5s heartbeat).
  // isActive is included so tab-foreground/background changes propagate
  // immediately to consumers that hide background-tab presence dots.
  useEffect(() => {
    handleRef.current?.ping?.();
  }, [location?.boardId, location?.surface, location?.pageId, location?.docCardId, location?.isActive]);

  // Filter own-user out of the peer list. Multi-tab and stale-after-
  // close scenarios used to make the user appear as a peer in boards
  // they weren't in — confusing and visually wrong. Self-presence is
  // implicit (you ARE here); peer dots should only ever be other people.
  const peers = rawPeers.filter(p => p?.user?.id !== user?.id);

  return { peers, status, ping: () => handleRef.current?.ping?.() };
}
