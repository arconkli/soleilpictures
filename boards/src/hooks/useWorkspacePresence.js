import { useEffect, useRef, useState } from 'react';
import { attachWorkspacePresence } from '../lib/workspaceRealtime.js';

// Hook wrapping the workspace presence channel.
//   workspaceId — required
//   user        — { id, name, color, email }
//   location    — { boardId, boardName, surface }  (read on every render
//                  so the next heartbeat reflects the latest state)
//
// Returns { peers, status, ping }
//   peers  — array of remote presences { user, location, tabId, lastSeen }
//   status — 'connecting' | 'connected' | 'error' | 'disconnected'
//   ping   — call to broadcast location immediately (e.g. on board switch)
export function useWorkspacePresence({ workspaceId, user, location }) {
  const [peers, setPeers] = useState([]);
  const [status, setStatus] = useState('connecting');
  const handleRef = useRef(null);
  // Stash the latest location in a ref so the heartbeat closure always
  // reads the current one without us re-attaching the channel on each move.
  const locRef = useRef(location);
  locRef.current = location;

  useEffect(() => {
    if (!workspaceId || !user?.id) return;
    setStatus('connecting');
    setPeers([]);
    const handle = attachWorkspacePresence(workspaceId, {
      user,
      getLocation: () => locRef.current,
      onPeers: setPeers,
      onStatus: setStatus,
    });
    handleRef.current = handle;
    return () => { handle.destroy(); handleRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, user?.id]);

  // Push a fresh heartbeat whenever the location changes so peers see the
  // navigation immediately rather than waiting for the next interval tick.
  useEffect(() => {
    handleRef.current?.ping?.();
  }, [location?.boardId, location?.surface]);

  return { peers, status, ping: () => handleRef.current?.ping?.() };
}
