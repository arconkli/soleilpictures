// Top-level surface for view='doc' boards. Three panes:
//
//   ┌──────────┬───────────────────────────┬──────────┐
//   │  Pages   │   [toolbar]               │ Bookmarks│
//   │ (tree)   │   [Tiptap editor body]    │  (list)  │
//   │          │                           │          │
//   └──────────┴───────────────────────────┴──────────┘
//
// All state lives in the per-board Y.Doc so docs collaborate / persist on
// the same machinery as canvases. The active page id is purely UI state
// (per-tab) — picked from the tree by default, restored from sessionStorage
// per board so a refresh reopens the same page.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDocBoard, usePageSheets } from '../hooks/useDocBoard.js';
import { useBreakpoint } from '../hooks/useBreakpoint.js';
import { PAGE_W } from './docExtensions/DocPagination.js';
import { addBookmark, addPage, addPageSheet, deletePageSheet, getDocMode, switchDocMode, getTitlePage, setTitlePage, getSceneNumbersShow, setSceneNumbersShow, getPageless, setPageless, metaMap, getDocUndoManager, followTitle } from '../lib/docState.js';
import { pushDocUndoTarget, removeDocUndoTarget, getDocUndoTarget } from '../lib/overlayRouting.js';
import { isEditableTarget } from '../lib/isEditableTarget.js';
import { undoToast } from '../lib/undoToast.js';
import { encodeAnchor, resolveAnchor } from '../lib/bookmarkRelPos.js';
import { uploadImage } from '../lib/uploads.js';
import { isDocQaMode } from '../lib/localMode.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useFeedback } from './AppFeedback.jsx';
import { DocPageTree } from './DocPageTree.jsx';
import { DocPageEditor } from './DocPageEditor.jsx';
import { DocPresence } from './DocPresence.jsx';
import { DocToolbar } from './DocToolbar.jsx';
import { ScreenplayTitlePage } from './ScreenplayTitlePage.jsx';
import { ScreenplaySceneNav } from './ScreenplaySceneNav.jsx';
import { DocFindReplace } from './DocFindReplace.jsx';
import { DocStatusFooter } from './DocStatusFooter.jsx';
import { DocBoardEmbedPicker } from './DocBoardEmbedPicker.jsx';

const ACTIVE_PAGE_KEY = (boardId) => `soleil.boards.docActivePage.${boardId}`;
// Where the reader was: { pageId, sheetId, rel, offset, top, at }. `rel` is a
// Yjs relative anchor for the block at the top of the viewport (survives
// edits, zoom and reflow) and `offset` its distance below the scroller's top
// edge; `top` is a raw scrollTop fallback for when the anchor can't resolve.
// localStorage, not sessionStorage, so a doc reopens where it was left even
// after the tab or browser is closed.
const POS_KEY = (boardId) => `soleil.boards.docPos.${boardId}`;
function loadDocPos(boardId) {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY(boardId)) || 'null');
    return v && typeof v === 'object' && v.pageId ? v : null;
  } catch (_) { return null; }
}
function saveDocPos(boardId, pos) {
  try { localStorage.setItem(POS_KEY(boardId), JSON.stringify(pos)); } catch (_) {}
}
function loadActivePage(boardId) {
  // localStorage first; sessionStorage is where it used to live (per-tab), so
  // still honour a value from before the move.
  try {
    return localStorage.getItem(ACTIVE_PAGE_KEY(boardId))
      || sessionStorage.getItem(ACTIVE_PAGE_KEY(boardId));
  } catch (_) { return null; }
}
const RAILS_KEY = 'soleil.boards.docRails';
const ZOOM_KEY = 'soleil.boards.docZoom';
// 0.25 (not 0.5) because a phone in fit-to-width needs ~0.42 for an 8.5in
// sheet, and stepping OUT from there must stay on the same continuous scale.
const ZOOM_MIN = 0.25;
// Auto-create a new sheet under the active page when the last sheet's actual
// CONTENT nearly fills its printed page. We measure the inner ProseMirror
// content height against the sheet's printable area (the wrap's min-height
// minus its vertical padding) — NOT the wrap's box, whose 1056px min-height
// means an empty sheet would always look "full." Fires at most once per
// sheet so it adds exactly one page when you reach the end, never a cascade.
const AUTO_NEW_PAGE_FILL_RATIO = 0.92;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.1;
const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100));
// Right rail (outline / links / refs / comments tabs) was removed —
// only the left page-tree rail remains.
const DEFAULT_RAILS = { left: true };

function loadRails() {
  try {
    const raw = localStorage.getItem(RAILS_KEY);
    return raw ? { ...DEFAULT_RAILS, ...JSON.parse(raw) } : DEFAULT_RAILS;
  } catch (_) { return DEFAULT_RAILS; }
}
function saveRails(r) {
  try { localStorage.setItem(RAILS_KEY, JSON.stringify(r)); } catch (_) {}
}

export function DocSurface({ board, ydoc, ready, workspaceId, userId, boards = {}, currentUser, getAwareness,
                              pendingBookmark, onPendingBookmarkConsumed,
                              // Optional — when present, all reads/writes are scoped to a per-card
                              // doc store instead of the per-board ydoc root. Used by doc cards.
                              scope = null,
                              // Optional title shown above the editor (doc cards pass the card title).
                              titleOverride = null,
                              // Visual mode — 'full' (default) for view='doc' boards, 'modal' for the
                              // doc-card overlay (slightly tighter chrome, includes a close button).
                              chrome = 'full',
                              // Lift active page + scroll up to App so workspace presence can
                              // broadcast our exact location for click-to-jump. Optional.
                              onActivePageChange,
                              onPaperScroll,
                              // When App.jsx primes a target page+scroll (because user clicked
                              // a peer's avatar to jump here), DocSurface consumes it on mount.
                              pendingScroll,
                              onPendingScrollConsumed,
                              // Workspace peers currently on THIS board (already filtered by
                              // App). DocPageTree uses peer.location.pageId to render colored
                              // dots per page row; clicking a dot calls onJumpToPeer.
                              peersOnBoard = [],
                              onJumpToPeer,
                              // false → view-only doc: Tiptap editable=false.
                              canEdit = true,
                              // true → anonymous /share viewer: hide the toolbar +
                              // comment surfaces entirely (view-only MEMBERS keep
                              // them — gate on this, not canEdit).
                              isPublic = false,
                              onClose }) {
  const { pages, bookmarks, comments } = useDocBoard(ydoc, scope);

  // Doc STRUCTURAL undo: one cached UndoManager per doc scope (DOC_ORIGIN —
  // page add/delete/move/rename, sheets, bookmarks, comment threads, mode
  // flips). Text editing keeps its own y-undo stack inside Tiptap; these are
  // separate by design (see docState.js). While this surface is mounted it
  // OWNS Cmd+Z: CanvasSurface stands down (lib/overlayRouting.js) so a
  // shortcut can never silently undo canvas ops hidden behind the overlay.
  const docUndoManager = useMemo(() => (ydoc ? getDocUndoManager(ydoc, scope) : null), [ydoc, scope]);
  useEffect(() => {
    if (!canEdit || !docUndoManager) return undefined;
    pushDocUndoTarget(docUndoManager);
    const onKey = (e) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd || (e.key !== 'z' && e.key !== 'y')) return;
      // Only the TOP surface acts — a docked pane + a modal doc are both
      // mounted with their own listeners, and without this gate one keypress
      // popped a structural step in BOTH docs.
      if (getDocUndoTarget() !== docUndoManager) return;
      // Typing in the text editor / title input: Tiptap's y-undo (or the
      // input's native undo) owns the shortcut.
      if (isEditableTarget(e)) return;
      e.preventDefault();
      const isRedo = e.key === 'y' || e.shiftKey;
      try { if (isRedo) docUndoManager.redo(); else docUndoManager.undo(); } catch (_) {}
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      removeDocUndoTarget(docUndoManager);
    };
  }, [canEdit, docUndoManager]);
  // Subscribe to the awareness instance lazily — it's only created after the
  // realtime channel attaches in yboard.js. getAwareness() returns null
  // until then, and yboard doesn't trigger a re-render here when realtime
  // attaches, so we poll until non-null then store in state.
  const [awareness, setAwareness] = useState(() => getAwareness?.() || null);
  useEffect(() => {
    // No getAwareness at all (public /share viewer) — there is nothing to
    // poll for; skip the loop and its give-up warning entirely.
    if (!getAwareness) return;
    if (awareness) return;
    let cancelled = false;
    let attempts = 0;
    const tick = () => {
      if (cancelled) return;
      const aw = getAwareness?.();
      if (aw) { setAwareness(aw); return; }
      // Give up after ~10s — if the realtime channel never attaches,
      // presence simply won't render; polling forever just burns timers.
      // The board-change reset effect below re-arms the loop.
      attempts += 1;
      if (attempts >= 50) {
        console.warn('[doc] awareness never attached — presence disabled for this board');
        return;
      }
      setTimeout(tick, 200);
    };
    tick();
    return () => { cancelled = true; };
  }, [getAwareness, board.id, awareness]);
  // Reset awareness when the board changes — getAwareness will return the
  // new board's awareness once attach completes; the effect above re-runs.
  useEffect(() => { setAwareness(null); }, [board.id]);
  const [activePageId, setActivePageIdState] = useState(() => loadActivePage(board.id));
  const setActivePageId = (id) => {
    setActivePageIdState(id);
    try {
      if (id) localStorage.setItem(ACTIVE_PAGE_KEY(board.id), id);
      else localStorage.removeItem(ACTIVE_PAGE_KEY(board.id));
    } catch (_) {}
    onActivePageChange?.(id || null);
  };
  // Tell the parent about the initial activePageId (loaded from sessionStorage)
  // and re-tell it whenever it changes via the keep-valid effect below.
  useEffect(() => { onActivePageChange?.(activePageId || null); }, [activePageId, onActivePageChange]);
  const [rails, setRails] = useState(loadRails);
  useEffect(() => { saveRails(rails); }, [rails]);
  // On phone the rail is a slide-over drawer (the desktop rail + its only
  // toggle are display:none at <=640px, which stranded multi-page navigation).
  const [mobileRailOpen, setMobileRailOpen] = useState(false);

  // A mode or page-layout change remounts every sheet editor (see the
  // DocPageEditor key below). When a COLLABORATOR flips it, I may be mid-
  // sentence: the old editor's DOM goes away with my caret in it and focus
  // drops to <body>. So the meta observers below note the focused editor's
  // selection BEFORE they re-render — Yjs runs these shallow observers ahead
  // of y-prosemirror's deep observer, so the old editor still holds the
  // pre-change state — and the new editor for that sheet puts the caret back
  // and refocuses (DocPageEditor `takeRefocus`). The mode switch keeps every
  // top-level block 1:1 and the same size, so the absolute positions hold.
  const refocusRef = useRef(null);
  const noteFocusedEditor = () => {
    for (const [sid, ed] of editorsRef.current.entries()) {
      try {
        if (ed && !ed.isDestroyed && ed.view.hasFocus()) {
          const { from, to } = ed.state.selection;
          refocusRef.current = { sheetId: sid, from, to, at: Date.now() };
          return;
        }
      } catch (_) {}
    }
  };
  const takeRefocus = useCallback((sheetId) => {
    const r = refocusRef.current;
    if (!r || r.sheetId !== sheetId || Date.now() - r.at > 3000) return null;
    refocusRef.current = null;
    return r;
  }, []);

  // Doc mode ('doc' | 'screenplay'). Lives in the per-scope docMeta map so it
  // persists + collaborates; observe it so a peer's toggle reflects here.
  const [docMode, setDocModeState] = useState(() => getDocMode(ydoc, scope));
  const docModeRef = useRef(docMode);
  useEffect(() => {
    const m = metaMap(ydoc, scope);
    const update = () => {
      const next = getDocMode(ydoc, scope);
      if (next !== docModeRef.current) noteFocusedEditor();
      docModeRef.current = next;
      setDocModeState(next);
    };
    update();
    if (!m) return;
    m.observe(update);
    return () => m.unobserve(update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, scope]);
  // Only an editor converts, and only the one who flipped: switchDocMode
  // rewrites the content in the same transaction as the mode.
  const toggleScreenplay = useCallback(() => {
    if (!canEdit) return;
    switchDocMode(ydoc, scope, docMode === 'screenplay' ? 'doc' : 'screenplay');
  }, [ydoc, scope, docMode, canEdit]);

  // Screenplay title page (docMeta-backed). observeDeep so a peer's field edit
  // (nested Y.Map) reflects here, not just enable/disable. Single source of
  // truth: this state + commitTitlePage feed both the toolbar toggle and the
  // on-page ScreenplayTitlePage editor.
  const [titlePage, setTitlePageState] = useState(() => getTitlePage(ydoc, scope));
  useEffect(() => {
    const m = metaMap(ydoc, scope);
    setTitlePageState(getTitlePage(ydoc, scope));
    if (!m) return;
    const update = () => setTitlePageState(getTitlePage(ydoc, scope));
    m.observeDeep(update);
    return () => m.unobserveDeep(update);
  }, [ydoc, scope]);
  const commitTitlePage = useCallback((patch) => setTitlePage(ydoc, scope, patch), [ydoc, scope]);

  // Scene-number visibility (lock state lives on the blocks). Observe so a peer's
  // toggle reflects here; the plugin always stamps numbers, CSS gates display.
  const [sceneNumbersShow, setSceneNumbersShowState] = useState(() => getSceneNumbersShow(ydoc, scope));
  useEffect(() => {
    const m = metaMap(ydoc, scope);
    setSceneNumbersShowState(getSceneNumbersShow(ydoc, scope));
    if (!m) return;
    const update = () => setSceneNumbersShowState(getSceneNumbersShow(ydoc, scope));
    m.observe(update);
    return () => m.unobserve(update);
  }, [ydoc, scope]);
  const onSetSceneNumbersShow = useCallback((v) => setSceneNumbersShow(ydoc, scope, v), [ydoc, scope]);

  // Prose page layout: pageless (default, continuous) vs paged. docMeta-backed
  // + collaborative — observe so a peer's toggle reflects here. Drives both the
  // toolbar pill and whether DocPageEditor mounts the paginator + page sheets.
  const [pageless, setPagelessState] = useState(() => getPageless(ydoc, scope));
  const pagelessRef = useRef(pageless);
  useEffect(() => {
    const m = metaMap(ydoc, scope);
    const update = () => {
      const next = getPageless(ydoc, scope);
      // Screenplay ignores the layout, so its editors don't remount for it.
      if (next !== pagelessRef.current && docModeRef.current !== 'screenplay') noteFocusedEditor();
      pagelessRef.current = next;
      setPagelessState(next);
    };
    update();
    if (!m) return;
    m.observe(update);
    return () => m.unobserve(update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, scope]);
  const onTogglePageless = useCallback(() => setPageless(ydoc, scope, !pageless), [ydoc, scope, pageless]);
  const toggleTitlePage = useCallback(() => {
    const next = !titlePage.enabled;
    commitTitlePage({ enabled: next });
    // Enabling: make sure screenplay mode is on, then scroll the new page into
    // view on the next frame.
    if (next) {
      if (docMode !== 'screenplay' && canEdit) switchDocMode(ydoc, scope, 'screenplay');
      requestAnimationFrame(() => {
        paperRef.current?.querySelector('.sp-title-page')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [titlePage.enabled, commitTitlePage, docMode, ydoc, scope, canEdit]);

  // Ref to .doc-paper — declared early because the zoom/pinch effect
  // below needs it. The DocPresence overlay also uses it later (cursor/
  // caret coords are paper-relative).
  const paperRef = useRef(null);

  // Page zoom. Card-scoped docs remember their OWN zoom (keyed by card id) so
  // each doc opens where you left it; the legacy root path keeps the single
  // global preference. Cmd +/−/0 + toolbar buttons + Ctrl+wheel all adjust it.
  const zoomStorageKey = scope?.cardId ? `${ZOOM_KEY}.${scope.cardId}` : ZOOM_KEY;
  const [zoom, setZoomState] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem(zoomStorageKey) || '');
      return Number.isFinite(v) ? clampZoom(v) : 1;
    } catch (_) { return 1; }
  });
  // ── Fit-to-width ───────────────────────────────────────────────────────────
  // A doc sheet is a fixed 816px (8.5in) box; on a phone that's ~2× the
  // viewport, and there is nothing to auto-shrink it. Screenplay is worse: its
  // whole contract is that the on-screen wrap column, the paginator, and the
  // exported PDF agree, which only holds while the sheet keeps its real
  // geometry. So instead of reflowing we scale the WHOLE sheet down to the
  // available width via the existing CSS `zoom` — proportions, the 60ch
  // column, the ch indents and the page breaks all stay byte-identical.
  //
  // Phones start fitted; any manual zoom leaves fit mode; the zoom-reset
  // button (⌘0 / the % pill) returns to it.
  //
  // Scoped to layouts whose sheet is genuinely a FIXED 816px box — screenplay,
  // and paged prose (.doc-flow). Pageless prose is already fluid
  // (.doc-editor-wrap is width:100%, max-width:816px), so it fits a phone on
  // its own; scaling that would shrink perfectly readable text for nothing.
  const { isPhone } = useBreakpoint();
  const fitEligible = isPhone && (docMode === 'screenplay' || !pageless);
  const [fitWanted, setFitWanted] = useState(true);
  const fitMode = fitEligible && fitWanted;
  const [fitZoom, setFitZoom] = useState(1);

  useLayoutEffect(() => {
    const paper = paperRef.current;
    if (!paper || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      // clientWidth excludes the scrollbar; subtracting the paper's own
      // horizontal padding is what makes this self-consistent with the
      // .is-fit-width padding overrides in CSS.
      const cs = getComputedStyle(paper);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const avail = paper.clientWidth - padX;
      if (avail <= 0) return;
      // FLOOR, not clampZoom's round-to-2dp: rounding up makes
      // 816 × zoom wider than the space we just measured, and the sheet
      // overflows by a couple of px — enough to leave the paper horizontally
      // scrollable, which is the exact thing fit mode exists to prevent.
      const raw = avail / PAGE_W;
      setFitZoom(Math.max(ZOOM_MIN, Math.floor(raw * 100) / 100));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(paper);
    return () => ro.disconnect();
    // Re-measure when the layout changes: .is-fit-width alters the paper's own
    // padding, and show-scene-numbers widens it further.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitMode, docMode, sceneNumbersShow]);

  // What actually gets applied. Everything downstream (CSS var, toolbar
  // readout, DocPresence coordinate math) must use this, never raw `zoom`.
  const effectiveZoom = fitMode ? fitZoom : zoom;

  const setZoom = (z) => {
    // Step from what the user currently SEES, so leaving fit mode is
    // continuous rather than jumping back to the last manual value.
    const base = fitMode ? fitZoom : zoom;
    const next = clampZoom(typeof z === 'function' ? z(base) : z);
    setFitWanted(false);
    setZoomState(next);
    try { localStorage.setItem(zoomStorageKey, String(next)); } catch (_) {}
  };
  // ⌘0 / the % pill: on a phone "reset" means fit (100% is unusable there);
  // on desktop it keeps meaning actual size.
  const resetZoom = () => {
    if (fitEligible) { setFitWanted(true); return; }
    setZoom(1);
  };

  const [findOpen, setFindOpen] = useState(false);
  // Embed-board picker — DocPageEditor calls our request fn (which sets a
  // pending callback); the picker, on selection, runs the callback so the
  // editor inserts the embed at the cursor.
  const [embedPickerOpen, setEmbedPickerOpen] = useState(false);
  const embedPickedRef = useRef(null);
  const requestBoardEmbed = (cb) => {
    embedPickedRef.current = cb;
    setEmbedPickerOpen(true);
  };

  // (A DocLinkPicker URL/bookmark modal used to be declared here but was
  // never reachable — DocPageEditor ignored onRequestLink, and its onPick
  // called setLink/unsetLink, commands this schema doesn't have (links are
  // LinkMark: setLinkMark/unsetLinkMark). ⌘K and the toolbar link button go
  // through DocPageEditor's EntityPicker, which is the real link surface.
  // Deleted rather than wired: dead code that LOOKED like a feature.)

  // ⌘F opens find. ⌘⇧F also opens find (legacy macOS Pages-style).
  // ⌘+ / ⌘- / ⌘0 zoom in / out / reset (when the cursor is in this doc).
  useEffect(() => {
    const onKey = (e) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd) return;
      const inDoc = e.target?.closest?.('.tt-editor')
                 || e.target?.closest?.('.doc-find')
                 || e.target?.closest?.('.doc-surface');
      if (!inDoc) return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setFindOpen(true);
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        setZoom((z) => z + ZOOM_STEP);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoom((z) => z - ZOOM_STEP);
      } else if (e.key === '0') {
        e.preventDefault();
        resetZoom();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // Trackpad pinch — Chrome/Safari deliver pinch as wheel events with
  // `ctrlKey: true`. Hijack those (preventDefault) and translate the
  // delta into a zoom adjustment.
  useEffect(() => {
    const paper = paperRef.current;
    if (!paper) return;
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.01);
      setZoom((z) => z * factor);
    };
    paper.addEventListener('wheel', onWheel, { passive: false });
    return () => paper.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // Keep activePageId valid: pick first page if none selected, or current is gone.
  useEffect(() => {
    if (!ready) return;
    if (!pages.length) return;
    if (!activePageId || !pages.some(p => p.id === activePageId)) {
      setActivePageId(pages[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pages, activePageId]);

  // First-load: brand-new doc → drop a single empty page.
  // We use a ref-flag because the effect depends on pages.length and we don't
  // want StrictMode's dev double-mount to seed twice.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!ready || seededRef.current) return;
    if (pages.length === 0) {
      seededRef.current = true;
      const id = addPage(ydoc, { name: titleOverride || board.name || 'Untitled', scope });
      setActivePageId(id);
      // The auto-seed must not be the first undoable step: a stray ⌘Z right
      // after opening a brand-new doc deleted its only page, and everything
      // typed afterwards went into an orphaned fragment (invisible after
      // reload). Clear only when the seed IS the whole history, so seeding
      // after a user deleted their last page never eats their undo.
      try {
        if (docUndoManager && docUndoManager.undoStack.length <= 1) docUndoManager.clear();
      } catch (_) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pages.length]);

  // Keep the first page's name in sync with the card title (titleOverride),
  // but ONLY while that page is still "tracking" the title — i.e. its name
  // equals the previous title or a seeded default. The moment the user gives
  // the page its own name, we stop touching it so a card rename never clobbers
  // intentional page names. (No-op for the root path, where titleOverride is null.)
  const prevTitleRef = useRef(titleOverride);
  useEffect(() => {
    const prev = prevTitleRef.current;
    prevTitleRef.current = titleOverride;
    if (!titleOverride || titleOverride === prev || !pages.length) return;
    followTitle(ydoc, scope, prev, titleOverride);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleOverride]);

  // Reactive list of sheet ids for the active page. Always starts with the
  // implicit primary (id === activePageId) and grows with addPageSheet calls.
  const sheetIds = usePageSheets(ydoc, activePageId, scope);

  // Append a new sheet to the active page (visually stacks below the last
  // sheet). Used by the manual "+ New page" button and by the
  // ResizeObserver-driven auto-create below.
  const addSheetBelow = useCallback(() => {
    if (!activePageId) return;
    addPageSheet(ydoc, activePageId, scope);
  }, [activePageId, ydoc, scope]);

  // Delete a (non-primary) sheet from the active page. The primary sheet
  // (sheetId === pageId) is protected — to remove that, the user deletes
  // the whole page from the tree.
  const feedback = useFeedback();
  const deleteSheet = useCallback((sheetId) => {
    if (!activePageId || !sheetId || sheetId === activePageId) return;
    // One DOC_ORIGIN transaction (sheet entry + content fragment) that the
    // doc UndoManager reverses atomically — via the toast OR Cmd+Z, with no
    // expiry. This replaces the old detach → purge-after-6.5s dance, whose
    // content was unrecoverable the moment the timer fired (and whose toast
    // used to die 2.3s before that).
    docUndoManager?.stopCapturing();
    deletePageSheet(ydoc, activePageId, sheetId, scope);
    const item = docUndoManager?.undoStack?.length
      ? docUndoManager.undoStack[docUndoManager.undoStack.length - 1]
      : null;
    docUndoManager?.stopCapturing();
    undoToast(feedback, {
      message: 'Page deleted',
      undoManager: docUndoManager,
      stackItem: item,
      onUndo: () => { try { docUndoManager?.undo(); } catch (_) {} },
      supersededMessage: 'The document changed since — press ⌘Z in it to step back instead.',
    });
  }, [activePageId, ydoc, scope, feedback, docUndoManager]);

  // Prose pagination is now handled inside the editor by the DocPagination
  // plugin (true reflow: content flows + splits line-level across real pages,
  // drawn as white sheets behind the text). The old cosmetic "fill 92% → append
  // an empty sheet" effect — which never moved content and stranded the caret —
  // is gone. Screenplay still uses its own line-accurate ScreenplayPagination.

  // Honor a "jump to this bookmark on open" request that came in via a
  // soleil:// link from another doc. Switch to its page first; the editor
  // mounts and we scroll once it's ready.
  useEffect(() => {
    if (!pendingBookmark || !ready) return;
    const target = bookmarks.find(b => b.id === pendingBookmark.bookmarkId);
    if (!target) return;
    setActivePageId(target.pageId);
    let tries = 0;
    const tick = () => {
      // A sheet-scoped bookmark must resolve against THAT sheet's editor (its
      // relAnchor is tied to one fragment). Wait for that editor specifically;
      // legacy bookmarks (no sheetId) fall back to the focused editor.
      const sheetEd = target.sheetId ? editorsRef.current.get(target.sheetId) : null;
      if (target.sheetId && !sheetEd) { if (tries++ < 30) setTimeout(tick, 40); return; }
      const ed = sheetEd || editorRef.current;
      if (!ed) { if (tries++ < 30) setTimeout(tick, 40); return; }
      const docSize = ed.state.doc.content.size;
      // Prefer the durable relative anchor (rides along with edits); fall back
      // to the legacy raw int for bookmarks saved before relAnchor existed.
      const resolved = resolveAnchor(ed, target.relAnchor);
      const raw = (resolved != null) ? resolved : (target.anchor || 1);
      const pos = Math.max(1, Math.min(raw, Math.max(1, docSize - 1)));
      ed.commands.focus();
      ed.commands.setTextSelection(pos);
      try {
        const dom = ed.view.domAtPos(pos)?.node;
        const el = dom?.nodeType === 3 ? dom.parentElement : dom;
        el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      } catch (_) {}
      onPendingBookmarkConsumed?.();
    };
    tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBookmark, ready, bookmarks]);

  const handleNavigateTarget = (target) => {
    switch (target?.kind) {
      case 'url':
        window.open(target.href, '_blank', 'noopener,noreferrer');
        break;
      // Internal navigation (board/card/doc/docPos) is wired up by App.jsx's
      // navigation in a follow-up wiring task; for Phase 2 we just log.
      default:
        console.info('navigate to', target);
    }
  };

  // Hold the live Tiptap editor instance so the toolbar + bookmarks can
  // operate on it. With stacked sheets there are N editor instances; we
  // route the toolbar to whichever editor the user most recently focused.
  // onEditorReady fires on mount (used to seed editorRef when the page
  // first loads); onEditorFocus fires every time the user clicks into a
  // particular sheet and re-points editorRef at that editor.
  const editorRef = useRef(null);
  // Registry of ALL live sheet editors (sheetId → editor) so find/replace can
  // span every sheet of the active page, not just the focused one.
  const editorsRef = useRef(new Map());
  const docEditLoggedRef = useRef(false); // doc_edit: once per doc surface mount
  const [, force] = useState(0);
  // Dev-only: surface the active editor to the doc QA harness bridge so
  // Playwright can exercise editor-bound logic (e.g. bookmark relative-position
  // durability). No-op in production (isDocQaMode is false outside DEV+?docqa=1).
  const exposeEditor = (ed) => {
    // The literal import.meta.env.DEV lets the bundler strip this whole block
    // (and the bridge string) from production builds.
    if (import.meta.env.DEV && isDocQaMode() && typeof window !== 'undefined') {
      (window.__soleilDocTest || (window.__soleilDocTest = {})).editor = ed;
    }
  };
  // Stable identities (useCallback) so DocPageEditor's register/deregister
  // effect doesn't churn on every parent render — and so it can pair
  // register-on-setup with deregister-on-cleanup in ONE effect (which is what
  // makes it survive React StrictMode's dev mount→unmount→mount cycle).
  const onEditorReady = useCallback((ed, sheetId) => {
    if (sheetId) editorsRef.current.set(sheetId, ed);
    if (!editorRef.current) editorRef.current = ed;
    force(n => n + 1);
    exposeEditor(ed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onEditorDestroy = useCallback((sheetId) => {
    if (!sheetId || !editorsRef.current.has(sheetId)) return;
    const ed = editorsRef.current.get(sheetId);
    editorsRef.current.delete(sheetId);
    if (editorRef.current === ed) {
      editorRef.current = editorsRef.current.values().next().value || null;
    }
    force(n => n + 1);
  }, []);
  const onEditorFocus = (ed) => {
    if (editorRef.current !== ed) {
      editorRef.current = ed;
      force(n => n + 1);
    }
    // Depth signal for docs (a flagship surface with zero telemetry until now):
    // the user clicked into the editor to write. Once per doc surface mount.
    if (!docEditLoggedRef.current) {
      docEditLoggedRef.current = true;
      logEvent(EV.DOC_EDIT, { board_id: board?.id });
    }
    exposeEditor(ed);
  };

  // Mobile soft-keyboard: the layout viewport doesn't shrink when the iOS/
  // Android keyboard opens, so the caret + footer can hide behind it. Pad the
  // bottom of .doc-paper by the occluded height (so the last lines can scroll
  // clear) and keep the caret in view.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const paper = paperRef.current;
    if (!vv || !paper) return;
    // Only on the keyboard OPENING does the caret get pulled into view, and
    // the padding is only written when it changes. This used to run on every
    // visualViewport `scroll` too, so on iOS each scroll frame forced a layout
    // (padding write) and yanked the page back to the caret mid-swipe.
    let wasOpen = false;
    let lastPad = '';
    const onVV = () => {
      const occluded = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const open = occluded > 80;
      const pad = open ? `${occluded}px` : '';
      if (pad !== lastPad) { paper.style.paddingBottom = pad; lastPad = pad; }
      if (open && !wasOpen) { try { editorRef.current?.commands?.scrollIntoView(); } catch (_) {} }
      wasOpen = open;
    };
    vv.addEventListener('resize', onVV);
    return () => {
      vv.removeEventListener('resize', onVV);
      if (paper) paper.style.paddingBottom = '';
    };
  }, []);

  // Broadcast scrollTop on the doc-paper so workspace presence can carry
  // it for click-to-jump. Throttle to 200ms — peer scroll-sync only needs
  // to be coarse.
  useEffect(() => {
    if (!onPaperScroll) return;
    const paper = paperRef.current;
    if (!paper) return;
    let timer = null;
    const fire = () => {
      timer = null;
      onPaperScroll(paper.scrollTop || 0);
    };
    const onScroll = () => { if (!timer) timer = setTimeout(fire, 200); };
    paper.addEventListener('scroll', onScroll);
    fire();
    return () => {
      paper.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [onPaperScroll, activePageId]);

  // Consume a pending click-to-jump scroll target. If pendingScroll names
  // a different pageId than what's active, switch pages first — the
  // editor needs to mount on the new page before the scrollTo can land.
  // The effect re-runs once activePageId catches up, then scrolls and
  // calls onPendingScrollConsumed.
  useEffect(() => {
    if (!pendingScroll) return;
    if (pendingScroll.boardId !== board.id) return;
    if (pendingScroll.pageId && pendingScroll.pageId !== activePageId) {
      setActivePageId(pendingScroll.pageId);
      return;
    }
    if (!activePageId) return;
    const paper = paperRef.current;
    if (!paper) return;
    paper.scrollTo({ top: pendingScroll.scrollTop || 0, behavior: 'auto' });
    onPendingScrollConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScroll, board.id, activePageId, onPendingScrollConsumed]);

  // ── Reopen where the reader left off ──────────────────────────────────
  // The position saved on the last visit, read ONCE per mount. It only
  // applies if it names the page we opened on, and a click-to-jump or a
  // bookmark jump arriving with the open always wins over it.
  const restoreRef = useRef(null);
  if (restoreRef.current === null) {
    const saved = loadDocPos(board.id);
    // 'soleil-open-doc-card' doubles as the plain "open this doc" event
    // ({ pageId: null, scrollTop: 0 }), so only a pendingScroll that names a
    // page or a spot is a real jump.
    const jumping = !!pendingScroll && (!!pendingScroll.pageId || (pendingScroll.scrollTop || 0) > 0);
    restoreRef.current = (saved && saved.pageId === activePageId && !jumping && !pendingBookmark)
      ? saved : false;
  }

  // Record the block at the top of the viewport while scrolling (throttled)
  // and on unmount — unmount is the one path every close takes, the overlay's
  // Esc / backdrop / button and the docked pane alike.
  useEffect(() => {
    const paper = paperRef.current;
    if (!paper || !activePageId) return undefined;
    const capture = () => {
      if (restoreRef.current) return; // never overwrite a position we haven't restored yet
      const pr = paper.getBoundingClientRect();
      if (!pr.height) return;
      const probeY = pr.top + 12;
      const rec = { pageId: activePageId, sheetId: null, rel: null, offset: 0, top: paper.scrollTop || 0, at: Date.now() };
      for (const [sid, ed] of editorsRef.current.entries()) {
        const dom = ed?.view?.dom;
        if (!dom || !dom.isConnected) continue;
        const r = dom.getBoundingClientRect();
        if (r.bottom < probeY) continue;          // sheet entirely above the fold
        const y = Math.max(probeY, r.top + 1);
        const hit = ed.view.posAtCoords({ left: r.left + Math.min(40, r.width / 2), top: y });
        if (!hit) break;
        try {
          const $p = ed.state.doc.resolve(hit.pos);
          const blockPos = $p.depth > 0 ? $p.before(1) + 1 : hit.pos;
          const c = ed.view.coordsAtPos(blockPos);
          rec.sheetId = sid;
          rec.rel = encodeAnchor(ed, blockPos);
          rec.offset = c.top - pr.top;
        } catch (_) {}
        break;
      }
      saveDocPos(board.id, rec);
    };
    let timer = null;
    const onScroll = () => { if (!timer) timer = setTimeout(() => { timer = null; capture(); }, 250); };
    paper.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      paper.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
      capture();
    };
  }, [board.id, activePageId]);

  // Put the reader back. The editors mount asynchronously (one per sheet) and
  // images / pagination can still settle afterwards, so re-apply a few times
  // over the first ~0.6s — but stop the instant the reader scrolls, taps or
  // types, so we never fight them.
  useEffect(() => {
    const saved = restoreRef.current;
    const paper = paperRef.current;
    if (!saved || !paper || !ready || !activePageId) return undefined;
    // The saved page is gone (deleted, or the keep-valid effect moved us):
    // drop the restore so scrolling starts recording again.
    if (saved.pageId !== activePageId) { restoreRef.current = false; return undefined; }
    let stopped = false;
    let focused = false;
    const timers = [];
    const stop = () => { stopped = true; restoreRef.current = false; };
    const apply = () => {
      if (stopped) return;
      const ed = (saved.sheetId && editorsRef.current.get(saved.sheetId)) || null;
      const pos = ed && saved.rel ? resolveAnchor(ed, saved.rel) : null;
      if (ed && pos != null) {
        try {
          const clamped = Math.max(1, Math.min(pos, ed.state.doc.content.size - 1));
          const c = ed.view.coordsAtPos(clamped);
          const pr = paper.getBoundingClientRect();
          paper.scrollTop += (c.top - pr.top) - (saved.offset || 0);
          if (!focused && ed.isEditable) {
            focused = true;
            ed.commands.focus(clamped, { scrollIntoView: false });
          }
          return;
        } catch (_) {}
      }
      paper.scrollTop = saved.top || 0;
    };
    const interrupt = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    interrupt.forEach(t => paper.addEventListener(t, stop, { passive: true }));
    requestAnimationFrame(apply);
    for (const ms of [120, 300, 600]) timers.push(setTimeout(apply, ms));
    timers.push(setTimeout(stop, 650));
    return () => {
      timers.forEach(clearTimeout);
      interrupt.forEach(t => paper.removeEventListener(t, stop));
    };
    // Re-run as sheet editors register (force() bumps on each).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, activePageId, editorsRef.current.size]);

  // Cross-component link-picker wiring: DocPageEditor registers its
  // openLinkPicker function here; the toolbar calls it via onOpenLink.
  const openLinkPickerRef = useRef(null);
  const registerOpenLinkPicker = useCallback((fn) => { openLinkPickerRef.current = fn; }, []);

  // Cross-component comment-add wiring: DocPageEditor registers its
  // addComment.open function here; the toolbar button calls it via onAddComment.
  const openAddCommentRef = useRef(null);
  const registerOpenAddComment = useCallback((fn) => { openAddCommentRef.current = fn; }, []);

  const insertBookmarkAtCaret = async (editor) => {
    if (!editor || !activePageId) return;
    const anchor = editor.state.selection.from;
    // Use the surrounding text as a default name suggestion.
    let suggested = '';
    try {
      const $pos = editor.state.doc.resolve(anchor);
      const para = $pos.parent;
      suggested = para?.textContent?.slice(0, 40) || '';
    } catch (_) {}
    const name = await feedback.prompt({
      title: 'Add bookmark',
      label: 'Bookmark name',
      defaultValue: suggested || 'Bookmark',
      confirmLabel: 'Add',
    });
    if (name == null) return; // cancelled
    // Store a durable relative anchor (survives edits) alongside the raw int,
    // plus the sheetId this editor is bound to (so a multi-sheet page resolves
    // the anchor against the right sheet on jump).
    const relAnchor = encodeAnchor(editor, anchor);
    let sheetId = activePageId;
    for (const [sid, ed] of editorsRef.current.entries()) { if (ed === editor) { sheetId = sid; break; } }
    addBookmark(ydoc, { name: name.trim() || 'Bookmark', pageId: activePageId, sheetId, anchor, relAnchor, scope });
  };

  // Toolbar "+" insert menu — upload an image from disk into the active editor.
  const pickImageFromDisk = (editor) => {
    if (!editor) return;
    if (!workspaceId || !userId) { feedback.toast({ type: 'error', message: 'Sign in to add images.' }); return; }
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !file.type?.startsWith('image/')) return;
      try {
        const payload = await uploadImage({ file, workspaceId, userId });
        editor.chain().focus().setImage({ src: payload.publicUrl }).run();
      } catch (e) {
        console.error('image upload failed', e);
        feedback.toast({ type: 'error', message: `Image upload failed: ${e?.message || e}` });
      }
    };
    input.click();
  };

  // Toolbar "+" insert menu — insert a board/card embed via the existing picker.
  const pickBoardEmbed = (editor) => {
    if (!editor) return;
    requestBoardEmbed((picked) => {
      if (!picked) return;
      editor.chain().focus().insertContent({
        type: 'boardEmbed',
        attrs: { boardId: picked.boardId, cardId: picked.cardId || null, label: picked.label || null },
      }).run();
    });
  };

  if (!ready) {
    return (
      <div className="doc-surface">
        <div className="doc-loading">
          <span className="t-eyebrow">Document</span>
          <div className="doc-state-title">Opening…</div>
          <div className="doc-state-sub">Syncing the latest changes.</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`doc-surface no-right-rail ${rails.left ? '' : 'rail-left-collapsed'} ${mobileRailOpen ? 'mobile-rail-open' : ''}`}>
      {/* Phone-only backdrop that closes the page drawer. */}
      {mobileRailOpen && <div className="doc-rail-backdrop" onClick={() => setMobileRailOpen(false)} />}
      {/* Left rail — page tree */}
      <aside className="doc-rail doc-rail-left">
        <button className="doc-rail-toggle"
                title={rails.left ? 'Hide pages' : 'Show pages'}
                aria-label={rails.left ? 'Hide pages' : 'Show pages'}
                aria-expanded={rails.left}
                onClick={() => setRails(r => ({ ...r, left: !r.left }))}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d={rails.left ? 'M8 3 L4 7 L8 11' : 'M6 3 L10 7 L6 11'} />
          </svg>
        </button>
        {rails.left && (
          <DocPageTree
            ydoc={ydoc}
            scope={scope}
            boardId={board.id}
            pages={pages}
            activePageId={activePageId}
            onSelectPage={(id) => { setActivePageId(id); setMobileRailOpen(false); }}
            peers={peersOnBoard}
            onJumpToPeer={onJumpToPeer}
          />
        )}
        {rails.left && docMode === 'screenplay' && (
          <ScreenplaySceneNav
            editor={editorRef.current}
            titlePageEnabled={titlePage.enabled}
            onJumpTitlePage={() => {
              setMobileRailOpen(false);
              paperRef.current?.querySelector('.sp-title-page')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          />
        )}
      </aside>

      {/* Center — toolbar + editor. The toolbar is an editing surface —
          hidden for anonymous public viewers (view-only members keep it). */}
      <section className="doc-center">
        {/* Phone-only entry point to the page list (the desktop rail is hidden
            at <=640px). Opens the rail as a slide-over drawer. */}
        <button className="doc-mobile-pages-btn"
                aria-label={docMode === 'screenplay' ? 'Pages and scenes' : 'Pages'} aria-expanded={mobileRailOpen}
                onClick={() => { setRails(r => ({ ...r, left: true })); setMobileRailOpen(o => !o); }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3 H12 M2 7 H12 M2 11 H12" />
          </svg>
          {/* The drawer carries the scene nav too in screenplay mode — say so,
              or the only way to jump between scenes on a phone is invisible. */}
          {docMode === 'screenplay' ? 'Scenes' : 'Pages'}
        </button>
        {!isPublic && (
        <DocToolbar editor={editorRef.current}
                    docName={board.name}
                    ydoc={ydoc}
                    scope={scope}
                    docMode={docMode}
                    authorName={currentUser?.name || ''}
                    onToggleScreenplay={toggleScreenplay}
                    titlePageEnabled={titlePage.enabled}
                    onToggleTitlePage={toggleTitlePage}
                    sceneNumbersShow={sceneNumbersShow}
                    onSetSceneNumbersShow={onSetSceneNumbersShow}
                    pageless={pageless}
                    onTogglePageless={onTogglePageless}
                    onInsertBookmark={insertBookmarkAtCaret}
                    onInsertImage={pickImageFromDisk}
                    onInsertBoardEmbed={pickBoardEmbed}
                    onOpenFind={() => setFindOpen(true)}
                    onOpenLink={(editor) => openLinkPickerRef.current?.(editor)}
                    onAddComment={() => openAddCommentRef.current?.()}
                    zoom={effectiveZoom}
                    fitMode={fitMode}
                    onZoomIn={() => setZoom((z) => z + ZOOM_STEP)}
                    onZoomOut={() => setZoom((z) => z - ZOOM_STEP)}
                    onZoomReset={resetZoom} />
        )}
        <DocFindReplace editor={editorRef.current}
                        editors={activePageId ? sheetIds.map(sid => editorsRef.current.get(sid)).filter(Boolean) : []}
                        open={findOpen}
                        onClose={() => setFindOpen(false)} />
        <div className={`doc-paper${fitMode ? ' is-fit-width' : ''}${docMode === 'screenplay' ? ' is-screenplay' : ''}${docMode === 'screenplay' && sceneNumbersShow ? ' show-scene-numbers' : ''}${docMode !== 'screenplay' && pageless ? ' is-pageless' : ''}`} ref={paperRef}
             style={{ position: 'relative', '--doc-zoom': effectiveZoom }}>
          {/* Grain texture is painted as a background-image on .doc-paper
              with background-attachment:local so it tiles across the
              full scrollHeight — no separate <div> needed. */}
          {activePageId && awareness && (
            <DocPresence getAwareness={getAwareness} boardId={board.id} pageId={activePageId}
                         paperRef={paperRef} editor={editorRef.current}
                         currentUser={currentUser} />
          )}
          {/* Screenplay title page — a real first page, before the script body. */}
          {docMode === 'screenplay' && titlePage.enabled && (
            <ScreenplayTitlePage
              titlePage={titlePage}
              onCommit={commitTitlePage}
              editable={canEdit && !isPublic}
            />
          )}
          {activePageId ? (
            sheetIds.map(sid => (
              // key forces a fresh editor instance per sheet — Tiptap's
              // Collaboration extension can't re-bind to a different fragment.
              <DocPageEditor
                // Screenplay has its own page model, so the prose layout
                // flag is no reason to rebuild (and lose the caret) there.
                key={`${sid}:${docMode === 'screenplay' ? 'sp' : (pageless ? 'pl' : 'pg')}`}
                ydoc={ydoc}
                scope={scope}
                docMode={docMode}
                pageless={pageless}
                zoom={effectiveZoom}
                pageId={activePageId}
                sheetId={sid}
                activePageId={activePageId}
                workspaceId={workspaceId}
                userId={userId}
                currentUser={currentUser}
                autofocus={!restoreRef.current}
                takeRefocus={takeRefocus}
                onEditorReady={onEditorReady}
                onEditorDestroy={onEditorDestroy}
                onEditorFocus={onEditorFocus}
                awareness={awareness}
                onNavigateTarget={handleNavigateTarget}
                registerOpenLinkPicker={registerOpenLinkPicker}
                registerOpenAddComment={registerOpenAddComment}
                boards={Object.values(boards || {})}
                editable={canEdit}
                isPublic={isPublic}
                onDeleteSheet={canEdit && sid !== activePageId ? () => deleteSheet(sid) : null}
              />
            ))
          ) : (
            <div className="doc-empty">
              <span className="t-eyebrow">Pages</span>
              <div className="doc-state-title">Nothing open yet</div>
              <div className="doc-state-sub">Pick a page on the left, or create your first one.</div>
            </div>
          )}
          {/* Pages are now created automatically as content flows (DocPagination).
              The manual "+ New page" sheet button is obsolete in the reflow model. */}
        </div>
        <DocStatusFooter editor={editorRef.current} ydoc={ydoc} boardId={board.id} />
      </section>

      {embedPickerOpen && (
        <DocBoardEmbedPicker
          boards={boards}
          onPick={(picked) => { embedPickedRef.current?.(picked); embedPickedRef.current = null; }}
          onClose={() => { setEmbedPickerOpen(false); embedPickedRef.current = null; }}
        />
      )}

    </div>
  );
}
