// Background-warm the top N most-recent boards once after mount, in
// the idle lane. Stops the moment the user does anything that counts
// as a real navigation (clicks, keypress) — at that point we don't
// want to compete with the user's own request for bandwidth.
//
// Mounted once at the App level with the active workspace's
// boardList. Re-runs when boardList identity changes (workspace
// switch, fresh row coming in via realtime).

import { useEffect } from 'react';
import { prefetch, firstInteraction } from '../lib/prefetch.js';
import { loadBoardSnapshot } from '../lib/boardsApi.js';

const DEFAULT_TOP_N = 8;

export function useIdlePrefetch(boardList, { topN = DEFAULT_TOP_N } = {}) {
  useEffect(() => {
    if (!Array.isArray(boardList) || boardList.length === 0) return;
    const picks = boardList.slice(0, topN).filter(b => b?.id);
    if (picks.length && typeof window !== 'undefined' && window.__SOLEIL_PREFETCH_DEBUG__ !== false) {
      console.log(`%c[prefetch]`, 'color:#a3854b;font-weight:600',
                  `idle queueing ${picks.length} boards:`, picks.map(b => b.name || b.id).slice(0, 5).join(', ') + (picks.length > 5 ? '…' : ''));
    }
    for (const b of picks) {
      prefetch(`board:${b.id}`,
        () => loadBoardSnapshot(b.id),
        { lane: 'idle', cacheTtl: 30_000 });
    }
    // First user interaction stops the idle queue.
    const stop = () => firstInteraction();
    window.addEventListener('pointerdown', stop, { once: true, passive: true });
    window.addEventListener('keydown', stop, { once: true });
    return () => {
      window.removeEventListener('pointerdown', stop);
      window.removeEventListener('keydown', stop);
    };
  }, [boardList, topN]);
}
