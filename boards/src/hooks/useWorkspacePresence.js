import { useEffect, useMemo, useRef, useState } from 'react';
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
// Fingerprint of a peer that ignores fields no consumer differentiates on.
// Includes tabId so two tabs of the same user (multi-tab) stay distinct;
// includes the broadcast location keys consumers actually read.
function peerKey(p) {
  if (!p) return '';
  const u = p.user || {};
  const l = p.location || {};
  return `${u.id || ''}|${u.name || ''}|${u.color || ''}|${l.boardId || ''}|${l.surface || ''}|${l.isActive === false ? 0 : 1}|${l.docCardId || ''}|${l.pageId || ''}|${Array.isArray(l.uploadingTo) ? l.uploadingTo.join(",") : ''}|${p.tabId || ''}`;
}

function peersFingerprint(peers) {
  if (!peers || peers.length === 0) return '';
  // Sort so order-only diffs don't churn identity.
  return peers.map(peerKey).sort().join('||');
}

export function useWorkspacePresence({ workspaceId, user, location }) {
  const [rawPeers, setRawPeers] = useState([]);
  const [status, setStatus] = useState('connecting');
  const handleRef = useRef(null);
  // Dedupe transport updates: 5s heartbeats re-broadcast identical state,
  // and we don't want every heartbeat to push a fresh array reference
  // through React (it forces every consumer of wsPeers to recompute).
  const prevFingerprintRef = useRef('');
  // Stash the latest location in a ref so the heartbeat closure always
  // reads the current one without us re-attaching the channel on each move.
  const locRef = useRef(location);
  locRef.current = location;

  useEffect(() => {
    if (!workspaceId || !user?.id) return;
    setStatus('connecting');
    setRawPeers([]);
    prevFingerprintRef.current = '';
    // Defer the ws: join by 2s so the board: channel gets to subscribe
    // first. Supabase free-tier has a low join-rate cap and concurrent
    // channel opens at page load were starving the board: channel.
    const timer = setTimeout(() => {
      const handle = attachWorkspacePresence(workspaceId, {
        user,
        getLocation: () => locRef.current,
        onPeers: (next) => {
          const fp = peersFingerprint(next);
          if (fp === prevFingerprintRef.current) return;
          prevFingerprintRef.current = fp;
          setRawPeers(next);
        },
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
  // uploadingTo too, so a tab starting or finishing an upload to another
  // cluster tells that cluster's open tabs at once.
  const uploadingKey = Array.isArray(location?.uploadingTo) ? location.uploadingTo.join(',') : '';
  useEffect(() => {
    handleRef.current?.ping?.();
  }, [location?.boardId, location?.surface, location?.pageId, location?.docCardId, location?.isActive, uploadingKey]);

  // Filter own-user out of the peer list. Multi-tab and stale-after-
  // close scenarios used to make the user appear as a peer in boards
  // they weren't in — confusing and visually wrong. Self-presence is
  // implicit (you ARE here); peer dots should only ever be other people.
  // Memoized so identity is preserved across renders that don't change
  // rawPeers or the user id — keeps downstream useMemo deps stable.
  const peers = useMemo(
    () => rawPeers.filter(p => p?.user?.id !== user?.id),
    [rawPeers, user?.id]
  );

  // People whose tab is still uploading to some cluster: userId ->
  // { name, color, boards: Set<boardId> }. Built from rawPeers, so the user's
  // own other tabs count too (a picture dropped in tab A still arriving while
  // tab B shows its cluster). rawPeers only changes identity when a peer's
  // fingerprint (uploadingTo included) does, so this stays stable between.
  const uploadingElsewhere = useMemo(() => {
    let out = null;
    for (const p of rawPeers) {
      const list = p?.location?.uploadingTo;
      const uid = p?.user?.id;
      if (!uid || !Array.isArray(list) || list.length === 0) continue;
      out = out || new Map();
      let entry = out.get(uid);
      if (!entry) {
        entry = { name: p.user.name || '', color: p.user.color || '', boards: new Set() };
        out.set(uid, entry);
      }
      for (const b of list) if (typeof b === 'string' && b) entry.boards.add(b);
    }
    return out;
  }, [rawPeers]);

  return { peers, status, uploadingElsewhere, ping: () => handleRef.current?.ping?.() };
}
