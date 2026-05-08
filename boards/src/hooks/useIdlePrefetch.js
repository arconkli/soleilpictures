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
    // boardList from useBoardList is already sorted by recency. Take
    // the first N — they're the most likely click targets.
    const picks = boardList.slice(0, topN);
    for (const b of picks) {
      if (!b?.id) continue;
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
