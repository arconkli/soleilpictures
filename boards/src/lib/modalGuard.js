// How the canvas knows a dialog is open — and which layer a key or Back
// belongs to.
//
// CanvasSurface and ListSurface register WINDOW-level keydown/paste handlers.
// Modal.jsx traps focus, but a focused <button> is not an "editable target",
// so before this guard a Backspace pressed inside the Trash dialog (or
// Version history, Settings, a confirm prompt) fell through and DELETED the
// selected cards on the board behind it — the same class of bug the sketch
// pad had. Every dialog-ish surface registers here while open; the window
// shortcut handlers stand down while anything is (anyModalOpen()).
//
// A STACK, not a boolean, because layers stack: a confirm prompt opens on top
// of Version history, a colour picker inside Settings. The order is what lets
// Escape close only the TOP layer: a registration may pass `onEscape`, and one
// window listener calls it — for the top layer only, and only when nothing
// nearer the focus already handled the key (defaultPrevented). A layer that
// handles its own Escape (Modal, the feedback dialogs) registers without one,
// and while it is on top the central listener leaves the key alone, so the
// layer beneath can't be closed by the same press.
//
// Back is the phone's Escape. registerBackLayer() pushes a same-URL history
// entry while a sheet / drawer / Settings is open, so the system Back
// gesture (or the Capacitor back button, which calls history.back()) closes
// that layer instead of leaving the app. Closing it any other way consumes
// the entry again, and puts back a URL the app changed in the meantime.
// On touch devices the same section also holds one entry per place visited,
// so Back then goes to the cluster you were on before.

import { isComposingKey } from './composerKeys.js';

const stack = [];

function topEntry() { return stack[stack.length - 1] || null; }

// The window keydown listener behind `onEscape`. Bubble phase on purpose:
// controls inside a layer (a rename field, a colour picker) see Escape first
// and can claim it with preventDefault / stopPropagation.
export function handleEscapeKey(e) {
  if (isComposingKey(e)) return false;
  if (!e || e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return false;
  const top = topEntry();
  if (!top || !top.onEscape) return false;
  if (top.onEscape(e) === false) return false;
  e.preventDefault?.();
  e.stopPropagation?.();
  return true;
}

let keyListening = false;
function ensureKeyListener() {
  if (keyListening || typeof window === 'undefined' || !window.addEventListener) return;
  keyListening = true;
  window.addEventListener('keydown', handleEscapeKey);
}

// opts.onEscape(e) — close this layer when Escape reaches the window and this
// is the top layer. Return false from it to decline (e.g. a nested popover is
// still open). Returns the unregister function; existing callers use it
// directly as an effect cleanup.
export function registerModalOpen(opts = {}) {
  const entry = { onEscape: typeof opts.onEscape === 'function' ? opts.onEscape : null };
  stack.push(entry);
  if (entry.onEscape) ensureKeyListener();
  const unregister = () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
  unregister.isTop = () => topEntry() === entry;
  return unregister;
}

export function anyModalOpen() {
  return stack.length > 0;
}

// For a layer that handles its own keys: is it the one on top right now?
// Takes the function registerModalOpen returned.
export function isTopModal(unregister) {
  return !!unregister?.isTop?.();
}

// The top layer right now, or null. A toolbar's popover leaves the keyboard
// where it was (hooks/useAnchoredPopover), so it isn't a layer of its own: it
// notes this when it opens and takes Escape only while the same layer is still
// on top, so a dialog opened over it gets the key.
export function topModal() {
  return topEntry();
}

// ── Focus stays inside the top layer ──────────────────────────────────
//
// One Tab trap for every dialog that keeps focus in (Modal.jsx, and Settings,
// which has its own shell and CSS). Settings used to have none: focus stayed
// on <body> when it opened and Tab walked the app behind the backdrop.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Rendered, enabled, tabbable controls inside `panel`, in DOM order.
export function focusablesIn(panel) {
  if (!panel?.querySelectorAll) return [];
  return Array.from(panel.querySelectorAll(FOCUSABLE))
    .filter(n => n.getClientRects().length > 0);
}

// Keep a Tab keypress inside `panel`: wrap at either end, and pull focus back
// in when it fell to <body>. The caller decides WHEN it applies (its layer is
// the top one, focus is inside it or lost) — a popover portaled outside the
// panel, or a dialog stacked on top, keeps the keyboard.
export function trapTabKey(e, panel) {
  if (!e || e.key !== 'Tab' || !panel) return;
  const active = document.activeElement;
  const nodes = focusablesIn(panel);
  if (!active || active === document.body || nodes.length === 0) {
    e.preventDefault();
    (nodes[0] || panel).focus?.();
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (e.shiftKey && active === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault(); first.focus();
  }
}

// ── Back closes the top layer, then goes where you were ───────────────
//
// This section owns every history entry the app writes and the only popstate
// listener that acts on one. Two kinds of entry, all on the same URL:
//
//   a LAYER entry (state.soleilLayer) while a sheet, menu or dialog is open:
//     Back closes that layer instead of leaving the app;
//   a NAV entry per place the in-app history visits (App.jsx recordNav), on
//     touch devices only: Back and Forward move between clusters.
//
// Every entry carries soleilNav, the id of the in-app history entry on screen
// when it was written, so a Back that lands on it knows where the app should
// be. The rules that keep the two kinds from tangling:
//
//   1. Nothing is written while a traversal we issued ourselves (history.go
//      to drop a closed layer's entry) is scheduled or in flight. Writes wait
//      in a queue and run, in order, once its popstate has been handled. A
//      push made under a late go(-1) would otherwise be the entry it removes.
//   2. A new nav entry first closes every layer whose entry is in history and
//      takes those entries off, so layer entries only ever sit right on top
//      of the nav entry they were opened from.
//   3. A popstate we did not issue closes the layers above the entry landed
//      on, then hands that entry's soleilNav to App, which moves the in-app
//      history there without recording or pushing anything.
//
// With a mouse App never sets a current id: no nav entries, no soleilNav, and
// layers behave as they always have.

const backLayers = [];
let popListening = false;
// A history.go(-n) we issued ourselves; its popstate is not a Back.
let selfPending = null;         // { url, timer } while it is in flight
let selfBackCount = 0;          // entries waiting to be taken off
let selfBackScheduled = false;
const writeQueue = [];          // history writes held back by rule 1
let currentNav = null;          // the in-app history entry on screen (touch)
let navHandler = null;          // App's reconcile: (soleilNav | null) => void
let navForwardCut = null;       // App: a layer push dropped the forward entries

// Ids are seeded from the clock so an entry left by an earlier page load (a
// reload keeps the tab's history) never matches one from this load.
const idSeed = () => Date.now() * 1000;
let layerSeq = idSeed();
let navSeq = idSeed();

function historyBusy() { return !!selfPending || selfBackScheduled || selfBackCount > 0; }

function drainWrites() {
  while (writeQueue.length && !historyBusy()) {
    const fn = writeQueue.shift();
    try { fn(); } catch (_) { /* sandboxed iframe etc. */ }
  }
}

// Run a history write now, or after the traversal in flight has landed.
function writeHistory(fn) {
  if (historyBusy() || writeQueue.length) { writeQueue.push(fn); return; }
  try { fn(); } catch (_) { /* sandboxed iframe etc. */ }
}

function selfBackLanded() {
  if (!selfPending) return;
  const { url, timer } = selfPending;
  selfPending = null;
  if (timer) clearTimeout(timer);
  // The app may have replaceState-d a new URL onto the entry we just left.
  // Going back landed on the OLD url; put the current one back so a reload
  // opens what's on screen. The landed entry keeps its own state.
  try { if (url && window.location.href !== url) window.history.replaceState(window.history.state, '', url); } catch (_) {}
  if (selfBackCount) issueSelfBack(); else drainWrites();
}

function issueSelfBack() {
  selfBackScheduled = false;
  if (selfPending) return;        // selfBackLanded picks the count up
  const n = selfBackCount;
  selfBackCount = 0;
  if (!n) { drainWrites(); return; }
  try {
    selfPending = { url: window.location.href, timer: null };
    window.history.go(-n);
    // A traversal that never reports back must not hold the queue for good:
    // a layer that never gets its entry is a Back that leaves the app.
    const timer = setTimeout(selfBackLanded, 2000);
    timer?.unref?.();
    if (selfPending) selfPending.timer = timer;
  } catch (_) { selfPending = null; drainWrites(); }
}

function scheduleSelfBack(n = 1) {
  selfBackCount += n;
  if (selfBackScheduled || selfPending) return;
  selfBackScheduled = true;
  queueMicrotask(issueSelfBack);
}

function onPopState() {
  if (selfPending) { selfBackLanded(); return; }
  // A real Back or Forward. Layer entries stack in id order, so every open
  // layer newer than the entry landed on has lost its entry: close those,
  // top first. (One Back closes one layer; Forward onto a closed layer's
  // entry closes nothing.)
  const st = window.history.state || {};
  const below = typeof st.soleilLayer === 'number' ? st.soleilLayer : 0;
  for (let i = backLayers.length - 1; i >= 0; i--) {
    const layer = backLayers[i];
    if (!layer || !layer.pushed || layer.consumed || layer.id <= below) continue;
    layer.consumed = true;
    try { layer.onBack(); } catch (_) {}
  }
  if (navHandler) {
    try { navHandler(st.soleilNav ?? null); } catch (_) {}
  }
}

function ensurePopListener() {
  if (popListening) return;
  popListening = true;
  window.addEventListener('popstate', onPopState);
}

const canWriteHistory = () => typeof window !== 'undefined' && !!window.history?.pushState;

export function registerBackLayer(onBack) {
  if (!canWriteHistory() || typeof onBack !== 'function') {
    return () => {};
  }
  ensurePopListener();
  const layer = { id: ++layerSeq, onBack, pushed: false, consumed: false, closed: false };
  backLayers.push(layer);
  // Push on the next microtask, not now: StrictMode's mount → unmount →
  // mount must not leave history entries (or traversals) behind.
  queueMicrotask(() => {
    if (layer.closed) return;
    writeHistory(() => {
      if (layer.closed) return;
      const state = { ...(window.history.state || {}), soleilLayer: layer.id };
      if (currentNav != null) state.soleilNav = currentNav;
      window.history.pushState(state, '');
      layer.pushed = true;
      // The push dropped whatever was forward of here; App's Forward button
      // must not offer it.
      if (currentNav != null && navForwardCut) { try { navForwardCut(); } catch (_) {} }
    });
  });
  return () => {
    if (layer.closed) return;
    layer.closed = true;
    const i = backLayers.indexOf(layer);
    if (i >= 0) backLayers.splice(i, 1);
    // Closed by the UI while its entry is still in history: consume it, so
    // the next Back doesn't land on a dead entry.
    if (layer.pushed && !layer.consumed) scheduleSelfBack();
  };
}

// How many open layers have an entry in history right now. App's Back button
// goes that many further, so one tap closes them and reaches the place before.
export function backLayerDepth() {
  return backLayers.filter(l => l && l.pushed && !l.consumed).length;
}

// ── The in-app history's entries (touch only; App.jsx recordNav) ──────

// A fresh id for an in-app history entry.
export function newNavId() { return ++navSeq; }

// The in-app entry on screen. App calls this on every move, silent ones
// included; a layer entry takes this id, not whatever history.state held.
// null (a mouse, or no workspace mounted) writes no soleilNav.
export function setCurrentNav(id) { currentNav = id ?? null; }

// App's reconcile, called for every popstate this module did not issue, after
// the layers above the landed entry have closed, with that entry's soleilNav
// (null when it has none). onForwardCut: a layer entry was pushed, so the
// browser has nothing forward of here any more.
export function setNavHandler(fn, onForwardCut) {
  navHandler = typeof fn === 'function' ? fn : null;
  navForwardCut = typeof onForwardCut === 'function' ? onForwardCut : null;
  if (navHandler && canWriteHistory()) ensurePopListener();
}

// The entry the app started on (or a workspace switch landed on): mark it
// with its id, keeping the rest of its state.
export function stampNavEntry(id) {
  currentNav = id ?? null;
  if (!canWriteHistory() || id == null) return;
  ensurePopListener();
  writeHistory(() => {
    window.history.replaceState({ ...(window.history.state || {}), soleilNav: id }, '');
  });
}

// The only way App adds a nav entry. Layers already in history close first
// (rule 2): each is marked consumed and told to close, and one history.go
// takes their entries off, merged with any already scheduled. The nav entry
// is pushed once that has landed. A layer registered but not yet pushed (a
// dialog opened by the same tap) stays open and pushes after it.
export function pushNavEntry(id) {
  currentNav = id ?? null;
  if (!canWriteHistory() || id == null) return;
  ensurePopListener();
  let n = 0;
  for (let i = backLayers.length - 1; i >= 0; i--) {
    const layer = backLayers[i];
    if (!layer || !layer.pushed || layer.consumed) continue;
    layer.consumed = true;
    n += 1;
    try { layer.onBack(); } catch (_) {}
  }
  if (n) scheduleSelfBack(n);
  writeHistory(() => {
    const state = { ...(window.history.state || {}), soleilNav: id };
    delete state.soleilLayer;
    window.history.pushState(state, '');
  });
}

// Test-only: reset module state between node --test cases.
export function __resetModalGuardForTests() {
  stack.length = 0;
  backLayers.length = 0;
  keyListening = false;
  popListening = false;
  if (selfPending?.timer) clearTimeout(selfPending.timer);
  selfPending = null;
  selfBackCount = 0;
  selfBackScheduled = false;
  writeQueue.length = 0;
  currentNav = null;
  navHandler = null;
  navForwardCut = null;
}
