import { useEffect, useRef, useState } from 'react';
import { loadYBoard } from '../lib/yboard.js';
import { readCards, readArrows, readStrokes, readGroups } from '../lib/yhelpers.js';

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

export function useYBoard(boardId, userId, user = null) {
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

  // Listen for explicit reset events targeting this board. Bumping
  // resetEpoch invalidates the main effect's deps → it tears down the
  // current Y.Doc + WebSocket and rebuilds from scratch.
  useEffect(() => {
    if (!boardId) return;
    const onReset = (e) => {
      if (e?.detail?.boardId && e.detail.boardId !== boardId) return;
      setResetEpoch(n => n + 1);
    };
    window.addEventListener('soleil-board-reset', onReset);
    return () => window.removeEventListener('soleil-board-reset', onReset);
  }, [boardId]);

  useEffect(() => {
    if (!boardId) {
      setSnapshot(emptySnapshot(null));
      return;
    }
    if (handleRef.current) handleRef.current.destroy();
    setSnapshot(emptySnapshot(boardId));
    const handle = loadYBoard(boardId, { userId, user });
    handleRef.current = handle;

    let unmounted = false;

    const refresh = () => {
      if (unmounted) return;
      setSnapshot({
        ready: true,
        cards: readCards(handle.ydoc),
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
      });
    };

    const onUpdate = () => refresh();
    handle.ydoc.on('update', onUpdate);
    handle.undoManager.on('stack-item-added', refresh);
    handle.undoManager.on('stack-item-popped', refresh);
    handle.undoManager.on('stack-cleared', refresh);

    handle.ready.then(() => refresh());

    return () => {
      unmounted = true;
      handle.ydoc.off('update', onUpdate);
      handle.undoManager.off('stack-item-added', refresh);
      handle.undoManager.off('stack-item-popped', refresh);
      handle.undoManager.off('stack-cleared', refresh);
    };
  }, [boardId, userId, resetEpoch]);

  // Final cleanup when the consuming component truly unmounts.
  useEffect(() => () => {
    if (handleRef.current) {
      handleRef.current.destroy();
      handleRef.current = null;
    }
  }, []);

  return snapshot;
}
