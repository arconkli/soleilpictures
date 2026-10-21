// Which overlay owns Cmd+Z right now.
//
// While a doc overlay is open, canvas Cmd+Z must NOT silently undo canvas
// ops hidden behind it — doc STRUCTURAL undo (the DOC_ORIGIN UndoManager
// from docState.getDocUndoManager) owns the shortcut instead. Overlays
// register here on mount; CanvasSurface's window keydown handler stands
// down while a target answers. Typing inside a text editor is unaffected —
// Tiptap's own y-undo swallows Cmd+Z before either window listener can act
// on it.
//
// This is a STACK, not a single slot: a docked doc pane and a modal doc can
// be mounted at once, and each registers its own window keydown listener.
// Every listener must check `getDocUndoTarget() === mine` before acting, or
// one keypress fires both surfaces' undos. Popping on unmount hands
// ownership back to the surface below (closing the modal re-arms the docked
// pane).
//
// A target that sits in a pane (lib/activePane.js) answers only while the
// keyboard is in that pane: a doc docked beside the canvas used to take ⌘Z
// from the canvas too, so ⌘Z on the board undid the doc's pages and never
// the board. One with no pane covers every pane (fullscreen, the sketch pad)
// and comes first; the last one opened wins within each kind.
import { getActivePane } from './activePane.js';

let docUndoTargets = [];   // { target, pane }

export function pushDocUndoTarget(um, pane = null) {
  if (um) docUndoTargets.push({ target: um, pane: pane || null });
}

export function removeDocUndoTarget(um) {
  docUndoTargets = docUndoTargets.filter((t) => t.target !== um);
}

export function getDocUndoTarget() {
  const top = (match) => {
    for (let i = docUndoTargets.length - 1; i >= 0; i--) {
      if (match(docUndoTargets[i].pane)) return docUndoTargets[i].target;
    }
    return null;
  };
  const here = getActivePane();
  return top((pane) => pane == null) || top((pane) => pane === here);
}

// Back-compat setter: null clears the stack; a target replaces it.
export function setDocUndoTarget(um) {
  docUndoTargets = um ? [{ target: um, pane: null }] : [];
}
