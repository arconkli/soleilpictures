import { useEffect, useRef, useState } from 'react';
import { loadYBoard } from '../lib/yboard.js';
import { readCards, readArrows, readStrokes, readGroups } from '../lib/yhelpers.js';
import { watchBoardRestores } from '../lib/restoreSignal.js';
import * as perf from '../lib/perf.js';

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
    ready: false, cards: [], arrows: [], strokes: [], groups: [], ydoc: null, boardId: nextBoardId,
    undoManager: null, canUndo: false, canRedo: false, sessionId: null,
  });
  const [snapshot, setSnapshot] = useState({
    ready: false, cards: [], arrows: [], strokes: [], groups: [], ydoc: null, boardId: null,
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
  const triggerReset = (reason) => {
    const now = Date.now();
    if (now - lastResetAtRef.current < 600) return;
    lastResetAtRef.current = now;
    setResetEpoch(n => n + 1);
    if (reason && typeof console !== 'undefined') {
      console.info(`[useYBoard] reset triggered via ${reason}`);
    }
  };

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
    // Round 17: end-to-end "user clicked board → cards in React state" timer.
    // Captures loadYBoard resolution + handle.ready await + snapshot
    // Y.applyUpdate + the first refresh() (readCards + setState). Surfaces
    // as the named `firstOpen.boardIdToReady.ms` bar in Chrome DevTools
    // Performance "Timings" lane via perf.mark's performance.measure shim.
    const _tOpen = performance.now();
    let _firstRefreshDone = false;
    const handle = loadYBoard(boardId, { userId, user, workspaceId, hasThumb });
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
      }
      setSnapshot({
        ready: true,
        cards: nextCards,
        arrows: readArrows(handle.ydoc),
        strokes: readStrokes(handle.ydoc),
        groups: readGroups(handle.ydoc),
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
