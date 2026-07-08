import { useEffect, useRef, useState } from 'react';

// Fingerprint of the selection map so a peer merely moving their cursor (which
// never touches canvasSelection) triggers zero re-commits. cardId → sorted uids.
function selFingerprint(map) {
  const parts = [];
  for (const [cardId, peers] of map) parts.push(`${cardId}:${peers.map(p => p.user.id).sort().join(',')}`);
  return parts.sort().join('|');
}

// Live map of which cards OTHER peers currently have selected/open on this
// cluster (and its descendants), for the per-row / per-tile presence highlight
// in the cluster browser. Ports CanvasPresence's awareness read + rAF/
// fingerprint gating, but SELECTION-ONLY (no cursor lerp). Keys by cardId
// (globally unique: `<kind>-<ts>-<rand>`), so a peer selecting a card in a
// descendant board still lights up its row here. Returns Map<cardId, [{ user }]>.
export function usePeerSelections({ getAwareness, boardId, descendantIds = [], selfId } = {}) {
  const [map, setMap] = useState(() => new Map());
  const fpRef = useRef('');
  const rafRef = useRef(0);
  const pendingRef = useRef(null);
  const scopeKey = [boardId, ...descendantIds].join(',');

  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw) { setMap(new Map()); return; }
    const scope = new Set([boardId, ...descendantIds]);

    const refresh = () => {
      const states = aw.getStates();
      const byCard = new Map();       // cardId → [{ user }]
      const seenPerCard = new Map();  // cardId → Set(userId) to dedup multi-tab
      states.forEach((state) => {
        const user = state?.user;
        if (!user || user.id === selfId) return;
        const sel = state.canvasSelection;
        if (!sel || !scope.has(sel.boardId)) return;
        for (const cid of (sel.cardIds || [])) {
          let seen = seenPerCard.get(cid);
          if (!seen) { seen = new Set(); seenPerCard.set(cid, seen); }
          if (seen.has(user.id)) continue;
          seen.add(user.id);
          const arr = byCard.get(cid) || [];
          arr.push({ user });
          byCard.set(cid, arr);
        }
      });
      const fp = selFingerprint(byCard);
      if (fp === fpRef.current) return;
      fpRef.current = fp;
      pendingRef.current = byCard;
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          if (pendingRef.current) { setMap(pendingRef.current); pendingRef.current = null; }
        });
      }
    };

    refresh();
    aw.on('change', refresh);
    return () => {
      aw.off('change', refresh);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAwareness, boardId, selfId, scopeKey]);

  return map;
}
