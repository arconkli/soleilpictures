// The docs open beside the canvas, and what happens to them.
//
// A doc docked in the split pane is `dock`. While one is, opening any other
// doc (a double-click, a double tap, a jump to it from Files or a peer) puts it
// in the main pane's place, `beside` the docked one, so two docs can be read
// at once (the owner's ask, 2026-10-20); the canvas comes back when either
// closes. The dock button still swaps what is docked. Each is
// { cardId, boardId }: `dock` lives on the split pane's cluster, `beside` on
// the main pane's. App keeps the state and does the rest (the split stack, the
// sidebar, fullscreen); this only decides which doc goes where.

export const NO_DOC_PANES = Object.freeze({ dock: null, beside: null });

const same = (a, b) => !!a && !!b && a.cardId === b.cardId;

// A plain open while a doc is docked: beside it, unless it IS the docked one
// (then nothing moves). With nothing docked it is not ours: null, and the doc
// opens the way it always has, in its remembered layout.
export function openBesideDock(state, doc) {
  if (!state.dock) return null;
  if (same(state.dock, doc)) return state;
  return { dock: state.dock, beside: doc };
}

// The dock button: this doc takes the pane. The one beside stays, unless it is
// the one being docked.
export function dockDoc(state, doc) {
  return { dock: doc, beside: same(state.beside, doc) ? null : state.beside };
}

// × on the docked doc: the one beside, if any, moves into the dock, so the
// canvas comes back where it was.
export function closeDock(state) {
  return state.beside ? { dock: state.beside, beside: null } : NO_DOC_PANES;
}

// × on the doc beside: the canvas comes back.
export function closeBeside(state) {
  return state.beside ? { dock: state.dock, beside: null } : state;
}

// The main pane moved, to another cluster or off the board to its Files page:
// the doc beside was in the board's place, so it goes (over the Files page it
// would hide what was asked for); the docked one stays.
export function mainPaneMoved(state, { boardId, view }) {
  if (!state.beside) return state;
  return state.beside.boardId !== boardId || view !== 'canvas' ? { dock: state.dock, beside: null } : state;
}

export function docPanesSummary(state) {
  return (state.dock ? 1 : 0) + (state.beside ? 1 : 0);
}

// The sidebar while two docs are open: tucked away, so each doc has half the
// window, unless it is asked back (its button, ⌘B) for as long as both stay
// open. Nothing here is stored: the sidebar is as it was when one closes.
export function sidebarShown({ open, twoDocs, askedBack }) {
  return !!open && (!twoDocs || !!askedBack);
}

// What the sidebar's toggle does, as the next { open, askedBack }: with two
// docs open it brings the sidebar back (opening it if it was closed) or tucks
// it away again; otherwise it is the sidebar's own toggle.
export function toggleSidebar({ open, twoDocs, askedBack }) {
  if (!twoDocs) return { open: !open, askedBack: false };
  return sidebarShown({ open, twoDocs, askedBack })
    ? { open: !!open, askedBack: false }
    : { open: true, askedBack: true };
}
