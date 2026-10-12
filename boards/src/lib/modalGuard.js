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

const stack = [];

function topEntry() { return stack[stack.length - 1] || null; }

// The window keydown listener behind `onEscape`. Bubble phase on purpose:
// controls inside a layer (a rename field, a colour picker) see Escape first
// and can claim it with preventDefault / stopPropagation.
export function handleEscapeKey(e) {
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

// ── Back closes the top layer ─────────────────────────────────────────

const backLayers = [];
let popListening = false;
// Pending history.go(-n) we issued ourselves; its popstate is not a Back.
let selfBack = null;            // { url, state } to restore after the traversal
let selfBackCount = 0;
let selfBackScheduled = false;

function onPopState() {
  if (selfBack) {
    const { url, state } = selfBack;
    selfBack = null;
    // The app may have replaceState-d a new URL onto our entry (opening a
    // cluster from the drawer does). Going back landed on the OLD url; put
    // the current one back so a reload opens what's on screen.
    try { if (url && window.location.href !== url) window.history.replaceState(state, '', url); } catch (_) {}
    return;
  }
  // A real Back: the entry for the top layer is gone. Close that layer.
  for (let i = backLayers.length - 1; i >= 0; i--) {
    const layer = backLayers[i];
    if (!layer.pushed || layer.consumed) continue;
    layer.consumed = true;
    try { layer.onBack(); } catch (_) {}
    return;
  }
}

function scheduleSelfBack() {
  selfBackCount += 1;
  if (selfBackScheduled) return;
  selfBackScheduled = true;
  queueMicrotask(() => {
    const n = selfBackCount;
    selfBackCount = 0;
    selfBackScheduled = false;
    if (!n) return;
    try {
      const state = { ...(window.history.state || {}) };
      delete state.soleilLayer;
      selfBack = { url: window.location.href, state };
      window.history.go(-n);
    } catch (_) { selfBack = null; }
  });
}

let layerSeq = 0;
export function registerBackLayer(onBack) {
  if (typeof window === 'undefined' || !window.history?.pushState || typeof onBack !== 'function') {
    return () => {};
  }
  if (!popListening) { popListening = true; window.addEventListener('popstate', onPopState); }
  const layer = { id: ++layerSeq, onBack, pushed: false, consumed: false, closed: false };
  backLayers.push(layer);
  // Push on the next microtask, not now: StrictMode's mount → unmount →
  // mount must not leave history entries (or traversals) behind.
  queueMicrotask(() => {
    if (layer.closed) return;
    try {
      window.history.pushState({ ...(window.history.state || {}), soleilLayer: layer.id }, '');
      layer.pushed = true;
    } catch (_) { /* sandboxed iframe etc.: Back simply won't close it */ }
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

// Test-only: reset module state between node --test cases.
export function __resetModalGuardForTests() {
  stack.length = 0;
  backLayers.length = 0;
  keyListening = false;
  popListening = false;
  selfBack = null;
  selfBackCount = 0;
  selfBackScheduled = false;
}
