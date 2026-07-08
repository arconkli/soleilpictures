import { useEffect, useRef, useState } from 'react';
import { loadYBoard } from '../lib/yboard.js';
import { readCards, readArrows, readStrokes, readGroups, readGridTemplates, readGridSequences } from '../lib/yhelpers.js';
import { watchBoardRestores } from '../lib/restoreSignal.js';
import { primeImageMeta, primeImageMetaForBoard } from '../lib/imageMeta.js';
import * as perf from '../lib/perf.js';
import { spreadDelayMs } from '../lib/reconnectBackoff.js';
import { PRESENCE_TUNING } from '../lib/presenceTuning.js';

// Fires whenever bulletproofRestore completes for a board. Listeners
// (useYBoard instances bound to that board) destroy their current
// handle and re-cold-load — fresh Y.Doc, fresh PartyKit connection,
// fresh state read from the now-restored board_state.
//
// Window-level event so the producer (lib/boardsApi.js) doesn't need
// a direct hook reference.
function emitBoardReset(boardId) {
  try {
    window.dispatchEvent(new CustomEvent('soleil-board-reset', { detail: { boardId } }));
  } catch (_) {}
}
if (typeof window !== 'undefined') {
  // Expose the emitter so non-React code (boardsApi.bulletproofRestore)
  // can trigger it without a circular import.
  window.__soleilEmitBoardReset = emitBoardReset;
}

export function useYBoard(boardId, userId, user = null, workspaceId = null, hasThumb = false) {
  const handleRef = useRef(null);
  const [resetEpoch, setResetEpoch] = useState(0);
  const emptySnapshot = (nextBoardId = null) => ({
    ready: false, cards: [], arrows: [], strokes: [], groups: [], gridTemplates: {}, gridSequences: {}, ydoc: null, boardId: nextBoardId,
    undoManager: null, canUndo: false, canRedo: false, sessionId: null,
  });
  const [snapshot, setSnapshot] = useState({
    ready: false, cards: [], arrows: [], strokes: [], groups: [], gridTemplates: {}, gridSequences: {}, ydoc: null, boardId: null,
    undoManager: null, canUndo: false, canRedo: false, sessionId: null,
  });

  // Reset signals come from THREE sources, all converging on a single
  // resetEpoch bump that tears down + rebuilds the Y.Doc:
  //
  //   1) Realtime: Supabase INSERT on board_restore_events (one row per real
  //      restore; migration 0097). Low-churn replacement for subscribing to
  //      board_state_version UPDATEs, which fired on every op.
  //   2) Durable fallback: 10s polling of board_state_version.version. Works
  //      without Realtime; catches throttled tabs and degraded network. This
  //      is the offline-reconnect backstop.
  //   3) Legacy: 'soleil-board-reset' window CustomEvent. Fired by the
  //      old bulletproofRestore + PartyKit broadcast. Kept during the
  //      Phase 4-7 migration window for back-compat.
  //
  // 600ms dedupe so a single restore that fires via all three doesn't
  // remount three times.
  const lastResetAtRef = useRef(0);
  const resetTimerRef = useRef(0);
  const triggerReset = (reason) => {
    const now = Date.now();
    if (now - lastResetAtRef.current < 600) return;
    lastResetAtRef.current = now;   // dedupe NOW so the 3 sources still coalesce
    // Jitter the actual remount. A server /reset (or a restore that fans out to
    // every viewer) fires this on all clients at once; without spreading, every
    // client tears down + re-attaches its Y.Doc + PartyKit socket in lockstep —
    // a synchronized reconnect stampede. The delay is capped under the board
    // reconnector's 2s reset sit-out so the old socket doesn't reconnect mid-wait.
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    const delay = spreadDelayMs({ minMs: 0, maxMs: PRESENCE_TUNING.RESET_REMOUNT_JITTER_MAX_MS });
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = 0;
      setResetEpoch(n => n + 1);
      if (reason && typeof console !== 'undefined') {
        console.info(`[useYBoard] reset triggered via ${reason} (+${delay}ms jitter)`);
      }
    }, delay);
  };
  useEffect(() => () => { if (resetTimerRef.current) clearTimeout(resetTimerRef.current); }, []);

  useEffect(() => {
    if (!boardId) return;
    const onReset = (e) => {
      if (e?.detail?.boardId && e.detail.boardId !== boardId) return;
      triggerReset('window-event');
    };
    window.addEventListener('soleil-board-reset', onReset);
    return () => window.removeEventListener('soleil-board-reset', onReset);
  }, [boardId]);

  useEffect(() => {
    if (!boardId) return;
    const unsubscribe = watchBoardRestores(boardId, ({ version }) => {
      triggerReset(`realtime-version=${version}`);
    });
    return () => { try { unsubscribe(); } catch (_) {} };
  }, [boardId]);

  useEffect(() => {
    if (!boardId) {
      setSnapshot(emptySnapshot(null));
      return;
    }
    if (handleRef.current) handleRef.current.destroy();
    setSnapshot(emptySnapshot(boardId));
    // Prime blur/preview metadata for the whole board IN PARALLEL with the
    // snapshot fetch — keyed by board id, since card keys aren't known until
    // the snapshot decodes. Meta is then usually cached before the first card
    // renders: the Tier-0 blur paints on render 1 and R2ImageProgressive
    // initializes activeSrc to the preview instead of racing to fetch the
    // multi-MB original on a cold open. The key-based prime in refresh()
    // below stays as the safety net for keys this query can't see.
    try { primeImageMetaForBoard(boardId); } catch (_) {}
    // Round 17: end-to-end "user clicked board → cards in React state" timer.
    // Captures loadYBoard resolution + handle.ready await + snapshot
    // Y.applyUpdate + the first refresh() (readCards + setState). Surfaces
    // as the named `firstOpen.boardIdToReady.ms` bar in Chrome DevTools
    // Performance "Timings" lane via perf.mark's performance.measure shim.
    const _tOpen = performance.now();
    let _firstRefreshDone = false;
    // Wired to scheduleRefresh once it's defined below; loadYBoard calls this
    // after the instant cache/draft paint so the board renders ahead of the
    // network snapshot.
    let earlyRefresh = () => {};
    const handle = loadYBoard(boardId, { userId, user, workspaceId, hasThumb, onEarlyContent: () => earlyRefresh() });
    handleRef.current = handle;

    let unmounted = false;
    // Coalesce refresh triggers into a single per-frame snapshot rebuild.
    // A typing burst or a multi-card paste can fire dozens of Y.Doc 'update'
    // events in a tick; without coalescing each one rebuilds the whole
    // snapshot and re-renders every card. With RAF coalescing they collapse
    // into one rebuild per frame (<16ms latency — imperceptible).
    let pendingRaf = 0;

    const refresh = () => {
      if (unmounted) return;
      perf.bump('yboard.refresh');
      const _t0 = perf.isEnabled() ? performance.now() : 0;
      const _trc = perf.isEnabled() ? performance.now() : 0;
      const nextCards = readCards(handle.ydoc);
      if (_trc) perf.mark('yboard.readCards.ms', performance.now() - _trc);
      if (!_firstRefreshDone) {
        _firstRefreshDone = true;
        perf.mark('firstOpen.boardIdToReady.ms', performance.now() - _tOpen);
        // Prime blur + preview metadata for this board's images in one query
        // (off the critical path) so the Tier-0 blur and Tier-1 preview can
        // resolve the moment cards render. Fire-and-forget.
        try {
          const imgKeys = nextCards
            .filter(c => c.kind === 'image' && typeof c.src === 'string' && c.src.startsWith('r2:'))
            .map(c => c.src.slice(3));
          if (imgKeys.length) primeImageMeta(imgKeys);
        } catch (_) {}
      }
      setSnapshot({
        ready: true,
        cards: nextCards,
        arrows: readArrows(handle.ydoc),
        strokes: readStrokes(handle.ydoc),
        groups: readGroups(handle.ydoc),
        gridTemplates: readGridTemplates(handle.ydoc),
        gridSequences: readGridSequences(handle.ydoc),
        ydoc: handle.ydoc,
        boardId,
        undoManager: handle.undoManager,
        canUndo: handle.undoManager.undoStack.length > 0,
        canRedo: handle.undoManager.redoStack.length > 0,
        sessionId: handle.sessionId || null,
        getAwareness: handle.getAwareness,
        flushNow: handle.flushNow,
      });
      if (_t0) perf.mark('yboard.refresh.ms', performance.now() - _t0);
    };

    const scheduleRefresh = () => {
      if (unmounted) return;
      if (pendingRaf) return;
      pendingRaf = requestAnimationFrame(() => {
        pendingRaf = 0;
        refresh();
      });
    };
    earlyRefresh = scheduleRefresh;   // now safe to fire the instant cache paint

    const onUpdate = () => { perf.bump('yboard.update'); scheduleRefresh(); };
    handle.ydoc.on('update', onUpdate);
    handle.undoManager.on('stack-item-added', scheduleRefresh);
    handle.undoManager.on('stack-item-popped', scheduleRefresh);
    handle.undoManager.on('stack-cleared', scheduleRefresh);

    // Initial render: don't wait for a frame.
    handle.ready.then(() => refresh());

    return () => {
      unmounted = true;
      if (pendingRaf) { cancelAnimationFrame(pendingRaf); pendingRaf = 0; }
      handle.ydoc.off('update', onUpdate);
      handle.undoManager.off('stack-item-added', scheduleRefresh);
      handle.undoManager.off('stack-item-popped', scheduleRefresh);
      handle.undoManager.off('stack-cleared', scheduleRefresh);
    };
  }, [boardId, userId, workspaceId, resetEpoch]);

  // Final cleanup when the consuming component truly unmounts.
  useEffect(() => () => {
    if (handleRef.current) {
      handleRef.current.destroy();
      handleRef.current = null;
    }
  }, []);

  return snapshot;
}
