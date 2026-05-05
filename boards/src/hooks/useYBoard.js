import { useEffect, useRef, useState } from 'react';
import { loadYBoard } from '../lib/yboard.js';
import { readCards, readArrows, readStrokes } from '../lib/yhelpers.js';

export function useYBoard(boardId, userId, user = null) {
  const handleRef = useRef(null);
  const emptySnapshot = (nextBoardId = null) => ({
    ready: false, cards: [], arrows: [], strokes: [], ydoc: null, boardId: nextBoardId,
    undoManager: null, canUndo: false, canRedo: false,
  });
  const [snapshot, setSnapshot] = useState({
    ready: false, cards: [], arrows: [], strokes: [], ydoc: null, boardId: null,
    undoManager: null, canUndo: false, canRedo: false,
  });

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
        ydoc: handle.ydoc,
        boardId,
        undoManager: handle.undoManager,
        canUndo: handle.undoManager.undoStack.length > 0,
        canRedo: handle.undoManager.redoStack.length > 0,
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
  }, [boardId, userId]);

  // Final cleanup when the consuming component truly unmounts.
  useEffect(() => () => {
    if (handleRef.current) {
      handleRef.current.destroy();
      handleRef.current = null;
    }
  }, []);

  return snapshot;
}
