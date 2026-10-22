// The open doc's frame in the doc look (the owner's pick of 2026-10-21): what
// the window that draws its header (DocCard.jsx's DocCardOverlay) and the
// surface under it (DocSurface) share. The header's switches change things
// the surface owns, the page list and the side panel, so the surface keeps
// that state, as it always has, and publishes it here; the header reads it
// (hooks/useDocFrame.js) and asks the surface through `act`. Without a frame,
// which is every doc outside the look, the surface is as it was.

const NONE = Object.freeze({ ready: false, railOpen: false, panelOpen: false, panelTab: 'comments', openComments: 0 });

export function createDocFrame() {
  let state = NONE;
  const listeners = new Set();
  const tell = () => { listeners.forEach((fn) => fn()); };
  return {
    get: () => state,
    // The surface's state, merged in. A listener hears only a real change, and
    // the snapshot stays the same object until there is one (what
    // useSyncExternalStore needs).
    publish(patch) {
      let changed = !state.ready;
      for (const k of Object.keys(patch)) if (state[k] !== patch[k]) { changed = true; break; }
      if (!changed) return;
      state = { ...state, ...patch, ready: true };
      tell();
    },
    // The surface is gone: closed, crashed or not yet loaded.
    reset() {
      if (state === NONE) return;
      state = NONE;
      tell();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    // What the surface does when the header asks: the surface sets these, and
    // until it has, asking does nothing.
    act: { toggleRail() {}, togglePanel() {} },
  };
}

export const NO_FRAME = NONE;

// The side panel (Comments, Find, and Elements for a screenplay), open or not
// and on which tab: the reader's own, for every doc they open, like the page
// list's (DocSurface's soleil.boards.docRails).
const PANEL_KEY = 'soleil.boards.docPanel';
const PANEL_TABS = ['comments', 'find', 'elements'];
const PANEL_DEFAULT = { open: false, tab: 'comments' };

const localStore = () => {
  try { return globalThis.localStorage || null; } catch (_) { return null; }
};

export function readDocPanel(storage = localStore()) {
  try {
    const v = JSON.parse(storage?.getItem(PANEL_KEY) || 'null');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...PANEL_DEFAULT };
    return { open: v.open === true, tab: PANEL_TABS.includes(v.tab) ? v.tab : PANEL_DEFAULT.tab };
  } catch (_) { return { ...PANEL_DEFAULT }; }
}

export function writeDocPanel(panel, storage = localStore()) {
  try { storage?.setItem(PANEL_KEY, JSON.stringify({ open: !!panel?.open, tab: panel?.tab || PANEL_DEFAULT.tab })); } catch (_) {}
}
