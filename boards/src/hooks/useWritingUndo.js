// Undo and Redo for what is being typed, for the phone's top bar in writing
// mode (body[data-text-editing='1'], set by CanvasSurface). The bar's buttons
// used to run the board's undo, so Undo while typing a note took back an
// earlier change to the board. In a note they now run the note's own history
// (NoteTiptapSurface's actions, through lib/noteEditorRegistry.js); in any
// other field (a caption, a grid cell, a name) the keyboard's own undo serves
// and the bar shows neither.
import { useEffect, useMemo, useState } from 'react';
import { getActiveNoteEditor, getActiveNoteActions, subscribeActiveNoteEditor } from '../lib/noteEditorRegistry.js';

const writingNow = () => typeof document !== 'undefined' && document.body.getAttribute('data-text-editing') === '1';

// null outside writing mode; { mode: 'none' } while typing somewhere that
// isn't a note; { mode: 'note', canUndo, canRedo, undo, redo } in a note.
export default function useWritingUndo(enabled) {
  const [writing, setWriting] = useState(false);
  const [editor, setEditor] = useState(null);
  // Two booleans, so the caller (App) re-renders when one flips, never for a
  // keystroke.
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    if (!enabled || typeof MutationObserver === 'undefined') { setWriting(false); return undefined; }
    const read = () => setWriting(writingNow());
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-text-editing'] });
    return () => mo.disconnect();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) { setEditor(null); return undefined; }
    setEditor(getActiveNoteEditor());
    return subscribeActiveNoteEditor((ed) => setEditor(ed));
  }, [enabled]);

  const note = writing && editor && !editor.isDestroyed ? editor : null;

  useEffect(() => {
    if (!note) { setCanUndo(false); setCanRedo(false); return undefined; }
    const read = () => {
      if (getActiveNoteEditor() !== note) return;
      const s = getActiveNoteActions().undoState?.() || {};
      setCanUndo(!!s.canUndo);
      setCanRedo(!!s.canRedo);
    };
    read();
    return getActiveNoteActions().onUndoChange?.(read);
  }, [note]);

  return useMemo(() => {
    if (!enabled || !writing) return null;
    if (!note) return { mode: 'none' };
    const run = (name) => () => {
      if (getActiveNoteEditor() !== note) return;
      const actions = getActiveNoteActions();
      actions[name]?.();
      // A board step taken back through the route changes neither the note's
      // history nor the editor, so nothing announces it: read again.
      queueMicrotask(() => {
        if (getActiveNoteEditor() !== note) return;
        const s = actions.undoState?.() || {};
        setCanUndo(!!s.canUndo);
        setCanRedo(!!s.canRedo);
      });
    };
    return { mode: 'note', canUndo, canRedo, undo: run('undo'), redo: run('redo') };
  }, [enabled, writing, note, canUndo, canRedo]);
}
