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

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Selection } from '@tiptap/pm/state';
import { useDocBoard, usePageSheets } from '../hooks/useDocBoard.js';
import { useBreakpoint } from '../hooks/useBreakpoint.js';
import { PAGE_W } from './docExtensions/DocPagination.js';
import { paperRoom, railRoom } from '../lib/docRoom.js';
import { addBookmark, addPage, addPageSheet, deletePageSheet, getDocMode, switchDocMode, healDocMode, getTitlePage, setTitlePage, getSceneNumbersShow, setSceneNumbersShow, getPageless, setPageless, metaMap, getDocUndoManager, followTitle, pagesArray, healPages, readPageBlocks, getPageSheetIds } from '../lib/docState.js';
import { RELOAD_EVENT, noteDocReset, refreshDocReset, settleDocReset } from '../lib/docResets.js';
import { pushDocUndoTarget, removeDocUndoTarget, getDocUndoTarget } from '../lib/overlayRouting.js';
import { isEditableTarget } from '../lib/isEditableTarget.js';
import { undoToast } from '../lib/undoToast.js';
import { encodeAnchor, resolveAnchor } from '../lib/bookmarkRelPos.js';
import { uploadImageIntoDoc } from './docExtensions/ImageUpload.js';
import { isDocQaMode } from '../lib/localMode.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useFeedback } from './AppFeedback.jsx';
import { DocPageTree } from './DocPageTree.jsx';
import { DocBookmarkList } from './DocBookmarkList.jsx';
import { DocPageEditor } from './DocPageEditor.jsx';
import { DocPresence } from './DocPresence.jsx';
import { DocToolbar } from './DocToolbar.jsx';
import { ScreenplayTitlePage } from './ScreenplayTitlePage.jsx';
import { ScreenplaySceneNav } from './ScreenplaySceneNav.jsx';
import { DocFindReplace } from './DocFindReplace.jsx';
import { DocStatusFooter } from './DocStatusFooter.jsx';
import { DocOpening } from './DocOpening.jsx';
import { DocBoardEmbedPicker } from './DocBoardEmbedPicker.jsx';
import { lazyWithReload } from '../lib/lazyWithReload.js';
import { IconWeightContext } from './Icon.jsx';
import { readDocPanel, writeDocPanel } from '../lib/docFrame.js';
import { openableUrl } from '../lib/openableUrl.js';

// The doc look's side panel, footer and one row of tools (held;
// components/doc/DocFrameA.jsx): lazy, so the doc as it is never downloads
// the look.
const DocSidePanel = lazyWithReload(() => import('./doc/DocFrameA.jsx').then(m => ({ default: m.DocSidePanel })));
const DocFootA = lazyWithReload(() => import('./doc/DocFrameA.jsx').then(m => ({ default: m.DocFootA })));
const DocBarA = lazyWithReload(() => import('./doc/DocFrameA.jsx').then(m => ({ default: m.DocBarA })));
const DocCommentsTab = lazyWithReload(() => import('./doc/DocFrameA.jsx').then(m => ({ default: m.DocCommentsTab })));
const DocFindTab = lazyWithReload(() => import('./doc/DocFrameA.jsx').then(m => ({ default: m.DocFindTab })));
const DocElementsTab = lazyWithReload(() => import('./doc/DocFrameA.jsx').then(m => ({ default: m.DocElementsTab })));
const DocStarters = lazyWithReload(() => import('./doc/DocFrameA.jsx').then(m => ({ default: m.DocStarters })));
const DocTableBar = lazyWithReload(() => import('./doc/DocFrameA.jsx').then(m => ({ default: m.DocTableBar })));

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
// The screenplay sheet's text block: 816px less the industry 1.5in/1.0in
// left/right margins (see .doc-paper.is-screenplay in styles.css). Phone fit
// mode scales THIS to the width, not the whole sheet.
const SP_LEFT_MARGIN = 144;
const SP_COLUMN_W = PAGE_W - SP_LEFT_MARGIN - 96;
// 12pt (16px) Courier at 0.6 renders ~9.6px: the smallest the fitted script
// is allowed to get.
const FIT_MIN = 0.6;
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
                              // true → a doc shared with this reader on its own
                              // (components/fileShare/DocShareView.jsx), in its
                              // live room. They may read or edit its words but
                              // bring nothing in (no images, no cluster embeds,
                              // no @-links), and the doc's housekeeping (healing
                              // the mode, seeding a page, following the title) is
                              // left to its members: the room refuses a guest's
                              // write outside the doc, and two healers race.
                              guestMode = false,
                              // false → no Export in the toolbar (a doc shared without
                              // "Allow exporting").
                              allowExport = true,
                              // The pane this doc sits in beside the canvas
                              // (lib/activePane.js): its ⌘Z answers only while
                              // the keyboard is there. null covers every pane.
                              pane = null,
                              // The doc look's frame (lib/docFrame.js): its window draws the
                              // header, whose switches change the page list and the side
                              // panel this surface keeps. Only the look passes one.
                              frame = null,
                              // The doc look's window renames the card from here: a new doc
                              // a script was imported into takes the script's title.
                              onRename = null,
                              onClose }) {
  // ?docqa=1's crash hook: the harness's crash() makes this doc throw the way
  // a real render crash would, so doc-crash.spec can drive the boundary
  // around it. State, not a flag read once, so React's retry of the render
  // throws too and the error reaches the boundary. The literal
  // import.meta.env.DEV drops the throw from production builds.
  const [qaCrash, setQaCrash] = useState(false);
  useEffect(() => {
    if (!(import.meta.env.DEV && isDocQaMode())) return undefined;
    const crash = () => setQaCrash(true);
    document.addEventListener('soleil-docqa-crash', crash);
    return () => document.removeEventListener('soleil-docqa-crash', crash);
  }, []);
  if (import.meta.env.DEV && isDocQaMode() && (qaCrash || window.__soleilDocCrashAlways)) {
    throw new Error('docqa: this doc crashed');
  }
  const { pages, bookmarks, comments } = useDocBoard(ydoc, scope);
  const lookA = !!frame;

  // Doc STRUCTURAL undo: one cached UndoManager per doc scope (DOC_ORIGIN —
  // page add/delete/move/rename, sheets, bookmarks, comment threads; not the
  // Screenplay switch, which is its own inverse). Text editing keeps its own y-undo stack inside Tiptap; these are
  // separate by design (see docState.js). While this surface is mounted it
  // OWNS Cmd+Z: CanvasSurface stands down (lib/overlayRouting.js) so a
  // shortcut can never silently undo canvas ops hidden behind the overlay.
  // In a pane, only while the keyboard is in that pane: the canvas beside it
  // keeps its own.
  const docUndoManager = useMemo(() => (ydoc ? getDocUndoManager(ydoc, scope) : null), [ydoc, scope]);
  useEffect(() => {
    if (!canEdit || !docUndoManager) return undefined;
    pushDocUndoTarget(docUndoManager, pane);
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
  }, [canEdit, docUndoManager, pane]);
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
  // Where the doc is too narrow for the page list beside a page (docked beside
  // the board, one of two side by side: lib/docRoom.js) the list tucks away to
  // its toggle, which brings it back for as long as the doc stays narrow and
  // stores nothing: `rails` is how it opens wherever there is room.
  const [railFits, setRailFits] = useState(true);
  const [railAskedBack, setRailAskedBack] = useState(false);
  useEffect(() => { if (railFits) setRailAskedBack(false); }, [railFits]);
  const railOpen = railFits ? rails.left : railAskedBack;
  const toggleRail = () => {
    if (railFits) setRails(r => ({ ...r, left: !r.left }));
    else setRailAskedBack(v => !v);
  };
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
  // Heal content that reached this doc in the other mode's shape (a page
  // restored by a structural undo, a peer's line that raced the flip, an old
  // bundle mid-rollout) — editors used to convert on every mount and that is
  // what duplicated docs, so exactly ONE client heals: the editor with the
  // lowest awareness client id. Viewers write nothing. If the lowest is a
  // viewer nobody heals this time, which is fine — the lines are still
  // exported as Action. A no-op (no update at all) when nothing is stranded.
  // (Two editors opening in the same instant, before either sees the other's
  // awareness, could both heal — that needs stranded lines too, so it is
  // vanishingly rare, which is not true of converting on every mount.)
  useEffect(() => {
    if (!canEdit || !awareness || guestMode) return;
    if (awareness.clientID !== Math.min(...awareness.getStates().keys())) return;
    try { healDocMode(ydoc, scope); } catch (_) {}
  }, [ydoc, scope, canEdit, awareness, docMode]);
  // Clear the extra entries a page is left with when two edits to it meet
  // (docState.healPages). Unlike the mode, any editor may: it only deletes,
  // never anything the list shows, so two at once agree. A beat after the list
  // last changed, never mid-drag; it is no undo step. Viewers and guests leave
  // it to the doc's members, as they do the mode.
  useEffect(() => {
    if (!ready || !canEdit || guestMode) return undefined;
    const arr = pagesArray(ydoc, scope);
    if (!arr) return undefined;
    let timer = 0;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { try { healPages(ydoc, scope); } catch (_) {} }, 2000);
    };
    soon();
    arr.observe(soon);
    return () => { clearTimeout(timer); arr.unobserve(soon); };
  }, [ydoc, scope, ready, canEdit, guestMode]);
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
  // Scoped to screenplay, the one layout whose sheet must stay a FIXED 816px
  // box. And it fits the 6.0in TEXT COLUMN to the width, not the whole sheet:
  // the full 8.5in fitted a 390px phone at ~0.4, which rendered 12pt Courier
  // at about 6px — unreadable, let alone editable. The column (60ch, the part
  // with words in it) fills the width instead; the margins sit just off either
  // edge, a pan away, and the sheet's geometry is untouched.
  //
  // Paged prose has no such contract — pagination is decoration over a single
  // content fragment — so on a phone it simply shows continuous (the reader's
  // view only: the doc's Pages setting, exports and wider screens keep real
  // pages). Pageless prose is already fluid and fits a phone on its own.
  //
  // Not phones only: a doc docked beside the board, or one of two side by
  // side, can be as narrow as a phone's on any screen, so the paper's own width
  // decides (lib/docRoom.js). Narrower than a page, a script fits its column
  // as on a phone, and prose takes the narrow margins (is-narrow / is-tight)
  // without leaving its pages; coming into a narrow pane fits the script again,
  // whatever zoom it was given with room.
  const { isPhone, isTablet, isTouch } = useBreakpoint();
  // Where the page list is a drawer rather than a column (styles.css's mobile
  // shell, App.jsx mobileShell): a phone, or a tablet under a finger.
  const drawerRail = isPhone || (isTablet && isTouch);
  const phoneReflow = isPhone && docMode !== 'screenplay' && !pageless;
  const layoutPageless = pageless || phoneReflow;
  const [room, setRoom] = useState('page');
  const roomRef = useRef('page');
  const fitEligible = docMode === 'screenplay' && (isPhone || room !== 'page');
  const [fitWanted, setFitWanted] = useState(true);
  const fitMode = fitEligible && fitWanted;
  const [fitZoom, setFitZoom] = useState(1);

  useLayoutEffect(() => {
    const paper = paperRef.current;
    if (!paper || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const nextRoom = paperRoom(paper.clientWidth, roomRef.current);
      if (nextRoom !== roomRef.current) {
        if (roomRef.current === 'page') setFitWanted(true);
        roomRef.current = nextRoom;
        setRoom(nextRoom);
      }
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
      // Floored at FIT_MIN: on the narrowest phones the column would land
      // below ~10px type, so there the line ends pan instead.
      const raw = avail / SP_COLUMN_W;
      setFitZoom(Math.min(1, Math.max(FIT_MIN, Math.floor(raw * 100) / 100)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(paper);
    return () => ro.disconnect();
    // Re-measure when the layout changes: .is-fit-width alters the paper's own
    // padding, and show-scene-numbers widens it further. `ready` because the
    // paper itself only mounts once the doc has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitMode, docMode, sceneNumbersShow, ready]);

  // Column fit: the sheet is now wider than the paper, so open it scrolled to
  // the column, centred in the width (on a phone the column fills it; in a
  // pane with room to spare, a little of each margin shows). A sheet that fits
  // whole has nothing to pan to: its auto margins centre it. Once per fitted
  // zoom, so rotation re-centres it but a sheet added while typing doesn't
  // yank a panned view back. It has to wait for the sheet itself: on a cold
  // open (no remembered page) the paper first renders the empty state, and
  // even then the editor's wrap mounts a beat after the page id lands, so
  // setting scrollLeft before the paper overflows clamps to 0 and leaves
  // every line cut off on the right. Watch the paper until it can scroll.
  useLayoutEffect(() => {
    const paper = paperRef.current;
    if (!fitMode || !paper) return undefined;
    const apply = () => {
      const cs = getComputedStyle(paper);
      const avail = paper.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      if (PAGE_W * fitZoom <= avail) return true;
      if (paper.scrollWidth <= paper.clientWidth) return false;
      paper.scrollLeft = SP_LEFT_MARGIN * fitZoom - Math.max(0, (avail - SP_COLUMN_W * fitZoom) / 2);
      return true;
    };
    if (apply() || typeof MutationObserver === 'undefined') return undefined;
    const mo = new MutationObserver(() => { if (apply()) mo.disconnect(); });
    mo.observe(paper, { childList: true, subtree: true });
    return () => mo.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitMode, fitZoom, ready]);

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

  // The doc look's side panel (Comments, Find, and Elements for a screenplay):
  // open or not and on which tab, the reader's own for every doc they open.
  // Not for the public viewer, who has no comments to see. On a phone it is a
  // sheet over the doc, so a doc opens with it put away there, and putting
  // it away there isn't kept.
  const [panel, setPanel] = useState(() => (isPhone ? { ...readDocPanel(), open: false } : readDocPanel()));
  useEffect(() => { if (lookA && !isPhone) writeDocPanel(panel); }, [lookA, panel, isPhone]);
  const panelOpen = lookA && !isPublic && panel.open;
  const panelSheet = panelOpen && isPhone;
  const closePanel = useCallback(() => setPanel((p) => ({ ...p, open: false })), []);
  // ⌘F and the bar's Find: in the doc look, the side panel's Find, searching
  // for the words selected in the text (within one block: a search never runs
  // across two); the find bar for the public viewer and outside the look.
  const [findSeed, setFindSeed] = useState(null);
  const openFind = () => {
    if (!lookA || isPublic) { setFindOpen(true); return; }
    let q = '';
    try {
      const { state } = editorRef.current;
      const { $from, $to, empty } = state.selection;
      if (!empty && $from.sameParent($to)) q = state.doc.textBetween($from.pos, $to.pos);
    } catch (_) {}
    setPanel({ open: true, tab: 'find' });
    setFindSeed((s) => ({ q: q.length <= 200 ? q : '', n: (s?.n || 0) + 1 }));
  };
  const openFindRef = useRef(openFind);
  openFindRef.current = openFind;
  const openComments = useMemo(() => comments.filter((t) => !t.resolved).length, [comments]);
  // The thread the panel's Comments has picked (its words lit in the page),
  // and the one just jumped to (its words flashed).
  const [panelThread, setPanelThread] = useState(null);
  const [flashThread, setFlashThread] = useState(null);
  const showThreadInPanel = useCallback((id) => {
    setPanel({ open: true, tab: 'comments' });
    setPanelThread(id);
  }, []);
  // A flash is once: gone when it's done, or a span ProseMirror redraws later
  // (typing in those words) would flash again.
  useEffect(() => {
    if (!flashThread) return undefined;
    const t = setTimeout(() => setFlashThread(null), 1500);
    return () => clearTimeout(t);
  }, [flashThread]);
  // What the look's header shows and switches (lib/docFrame.js): the page
  // list, as a column or, on a phone or a tablet under a finger, the drawer;
  // and the panel, which its button opens on Comments and closes from any tab.
  useLayoutEffect(() => {
    if (!frame) return;
    frame.act.toggleRail = () => {
      if (!drawerRail) { toggleRail(); return; }
      setRails((r) => ({ ...r, left: true }));
      setMobileRailOpen((o) => !o);
    };
    frame.act.togglePanel = (tab = 'comments') => setPanel((p) => (p.open ? { ...p, open: false } : { open: true, tab }));
    // Enter in the header's title goes on to the text (mockup S-open), at
    // once: TipTap's focus() waits a frame, and the keys typed straight after
    // Enter went into the title.
    frame.act.focusText = () => {
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed) return;
      try {
        const { state, view } = ed;
        view.dispatch(state.tr.setSelection(Selection.atStart(state.doc)).scrollIntoView());
        view.focus();
      } catch (_) {}
    };
    frame.publish({ railOpen: drawerRail ? mobileRailOpen : railOpen, panelOpen, panelTab: panel.tab, openComments });
  });
  useEffect(() => () => frame?.reset(), [frame]);
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
  // THIS doc: two can be open at once (docked, and beside it or fullscreen
  // over it), and a check for any doc's surface opened find in both.
  const rootRef = useRef(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setRailFits((prev) => railRoom(root.clientWidth, prev));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [ready]);
  useEffect(() => {
    const onKey = (e) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd) return;
      if (!rootRef.current?.contains?.(e.target)) return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        openFindRef.current();
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
    // A reader's seed would exist only in their tab (the board room drops a
    // viewer's writes) — they get the "Nothing open yet" state instead. So
    // does a guest: the doc's members seed it.
    if (!canEdit || guestMode) return;
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
    if (!titleOverride || titleOverride === prev || !pages.length || guestMode) return;
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

  // Honor a "jump to this bookmark" request: from the Bookmarks list under
  // the page tree, a soleil://bookmark link inside this doc, or a host's
  // pendingBookmark prop. Switch to its page first; the editor mounts and we
  // scroll once it's ready.
  const [localBookmarkJump, setLocalBookmarkJump] = useState(null);
  const bookmarkJump = localBookmarkJump || pendingBookmark || null;
  useEffect(() => {
    const onOpen = (e) => {
      const id = e.detail?.bookmarkId;
      if (id && bookmarks.some(b => b.id === id)) setLocalBookmarkJump({ bookmarkId: id });
    };
    document.addEventListener('soleil-open-bookmark', onOpen);
    return () => document.removeEventListener('soleil-open-bookmark', onOpen);
  }, [bookmarks]);
  useEffect(() => {
    if (!bookmarkJump || !ready) return;
    const target = bookmarks.find(b => b.id === bookmarkJump.bookmarkId);
    if (!target) {
      // A clicked bookmark was checked when clicked, so missing now means a
      // peer deleted it meanwhile: drop the request, or it would shadow any
      // later pendingBookmark. A host's pending request is left alone — the
      // bookmarks may simply not have loaded yet.
      if (localBookmarkJump) setLocalBookmarkJump(null);
      return;
    }
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
      if (localBookmarkJump) setLocalBookmarkJump(null);
      else onPendingBookmarkConsumed?.();
    };
    tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarkJump, ready, bookmarks]);

  const handleNavigateTarget = (target) => {
    switch (target?.kind) {
      case 'url': {
        const u = openableUrl(target.href);
        if (u) window.open(u, '_blank', 'noopener,noreferrer');
        break;
      }
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

  // The side panel shows a place in the doc: its page opened first if it isn't
  // the one open, and once that page's editors are up, `locate` finds the
  // place in them ({ ed, from, to }, or null while it can't) and `land` shows
  // it. A newer request drops an older one still waiting.
  const revealRef = useRef(0);
  const reveal = (pageId, locate, land) => {
    const run = ++revealRef.current;
    const want = pageId || activePageId;
    if (!want) return;
    if (want !== activePageId) setActivePageId(want);
    let tries = 0;
    const tick = () => {
      if (run !== revealRef.current) return;
      const eds = getPageSheetIds(ydoc, want, scope).map((sid) => editorsRef.current.get(sid));
      const hit = eds.every((ed) => ed && !ed.isDestroyed) ? locate(eds) : null;
      if (hit) { land(hit); return; }
      if (tries++ < 50) setTimeout(tick, 40);
    };
    tick();
  };
  // A thread's words: scrolled to the middle of the page and flashed (on a
  // phone, with the sheet put away from over them).
  const jumpToThread = (id, pageId) => {
    if (panelSheet) closePanel();
    reveal(pageId, (eds) => {
      for (const ed of eds) {
        const el = ed.view.dom.querySelector(`.tt-comment[data-comment-id="${CSS.escape(id)}"]`);
        if (el) return { ed, el };
      }
      return null;
    }, ({ el }) => {
      el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      setFlashThread((f) => ({ id, n: (f?.n || 0) + 1 }));
    });
  };

  // The cluster this doc is on, reloading under it: a restore, cards moved
  // into it, a repair (lib/docResets.js). It is told before its old copy goes,
  // so note the page this is and what the page holds, and again as this
  // surface goes with the cluster's cards, so a key typed in between counts.
  // The doc that comes back for this card says what happened (below).
  const reloadSeenRef = useRef({ activePageId, pages, title: titleOverride || '' });
  reloadSeenRef.current = { activePageId, pages, title: titleOverride || '' };
  useEffect(() => {
    const boardId = scope?.boardId;
    const cardId = scope?.cardId;
    if (!boardId || !cardId || !ydoc || isPublic || guestMode) return undefined;
    let noted = false;
    const held = () => {
      const { activePageId: pageId = null, pages: list = [] } = reloadSeenRef.current;
      const eds = [...editorsRef.current.values()].filter((ed) => ed && !ed.isDestroyed);
      const blocks = (pageId && readPageBlocks(ydoc, pageId, scope)) || [];
      return {
        pageId,
        pageName: list.find((p) => p.id === pageId)?.name || '',
        blocks,
        text: eds.length ? eds.map((ed) => ed.getText({ blockSeparator: '\n\n' })).join('\n\n') : blocks.join('\n\n'),
        html: eds.map((ed) => ed.getHTML()).join(''),
      };
    };
    const onReload = (e) => {
      if (e.detail?.boardId !== boardId) return;
      noted = true;
      try {
        noteDocReset({
          boardId, cardId, docGuid: ydoc.guid, title: reloadSeenRef.current.title,
          reason: e.detail.reason, canEdit, ...held(),
        }, { feedback });
      } catch (_) { /* a doc too broken to read still reloads */ }
    };
    window.addEventListener(RELOAD_EVENT, onReload);
    return () => {
      window.removeEventListener(RELOAD_EVENT, onReload);
      if (noted) { try { refreshDocReset(cardId, held()); } catch (_) {} }
    };
  }, [ydoc, scope, canEdit, isPublic, guestMode, feedback]);
  // Back after such a reload, on the cluster as it came back: say what
  // happened, now that the page can be set beside what it held. Once
  // (StrictMode's second run finds it said).
  useEffect(() => {
    if (!ready || !ydoc || !scope?.boardId || !scope?.cardId) return;
    settleDocReset({
      boardId: scope.boardId, cardId: scope.cardId, docGuid: ydoc.guid,
      pageBlocks: (pageId) => readPageBlocks(ydoc, pageId, scope),
      feedback,
    });
  }, [ready, ydoc, scope, feedback]);

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
  const namingPageRef = useRef(null);
  if (restoreRef.current === null) {
    const saved = loadDocPos(board.id);
    // 'soleil-open-doc-card' doubles as the plain "open this doc" event
    // ({ pageId: null, scrollTop: 0 }), so only a pendingScroll that names a
    // page or a spot is a real jump.
    const jumping = !!pendingScroll && (!!pendingScroll.pageId || (pendingScroll.scrollTop || 0) > 0);
    restoreRef.current = (saved && saved.pageId === activePageId && !jumping && !bookmarkJump)
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

  // Toolbar "+" insert menu — an image from disk, into the active editor at
  // its caret (docExtensions/ImageUpload.js, the path a paste or drop takes).
  const pickImageFromDisk = (editor) => {
    if (!editor) return;
    if (!workspaceId || !userId) { feedback.toast({ type: 'error', message: 'Sign in to add images.' }); return; }
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) uploadImageIntoDoc(editor, file, { workspaceId, userId, scope, toast: (t) => feedback.toast(t) });
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

  if (!ready) return <DocOpening />;

  return (
    // The look's icons are Phosphor's regular, the sidebar's weight; outside
    // it the floor is unset, as everywhere else.
    <IconWeightContext.Provider value={lookA ? 'regular' : null}>
    <div ref={rootRef} className={`doc-surface ${lookA ? 'dl-surface' : 'no-right-rail'} ${railOpen ? '' : 'rail-left-collapsed'} ${mobileRailOpen ? 'mobile-rail-open' : ''}${panelOpen ? ' has-panel' : ''}${panelOpen && panel.tab === 'comments' ? ' has-panel-comments' : ''}`}>
      {/* Phone-only backdrop that closes the page drawer. */}
      {mobileRailOpen && <div className="doc-rail-backdrop" onClick={() => setMobileRailOpen(false)} />}
      {/* Left rail — page tree */}
      <aside className="doc-rail doc-rail-left">
        {/* In the doc look the window's header has the page list's toggle. */}
        {!lookA && (
        <button className="doc-rail-toggle"
                title={railOpen ? 'Hide pages' : 'Show pages'}
                aria-label={railOpen ? 'Hide pages' : 'Show pages'}
                aria-expanded={railOpen}
                onClick={toggleRail}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d={railOpen ? 'M8 3 L4 7 L8 11' : 'M6 3 L10 7 L6 11'} />
          </svg>
        </button>
        )}
        {/* In the rail, or in the phone and tablet drawer. */}
        {(railOpen || mobileRailOpen) && (
          <DocPageTree
            ydoc={ydoc}
            scope={scope}
            boardId={board.id}
            pages={pages}
            activePageId={activePageId}
            onSelectPage={(id, opts) => {
              // A page just made with "+" opens with its name field focused
              // in the tree: its editor must not take the caret (that blur
              // committed "Untitled"), and on a phone the drawer stays open
              // until the name is in.
              namingPageRef.current = opts?.naming ? id : null;
              setActivePageId(id);
              if (!opts?.keepOpen) setMobileRailOpen(false);
            }}
            peers={peersOnBoard}
            onJumpToPeer={onJumpToPeer}
            canEdit={canEdit && !isPublic}
            defaultName={titleOverride || board.name || 'Untitled'}
            look={lookA}
          />
        )}
        {(railOpen || mobileRailOpen) && (
          <DocBookmarkList
            ydoc={ydoc}
            scope={scope}
            bookmarks={bookmarks}
            pages={pages}
            canEdit={canEdit && !isPublic}
            onJump={(id) => { setLocalBookmarkJump({ bookmarkId: id }); setMobileRailOpen(false); }}
            look={lookA}
          />
        )}
        {(railOpen || mobileRailOpen) && docMode === 'screenplay' && (
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
        {/* Phone / touch-tablet entry point to the page list (the desktop rail
            is hidden under the mobile-shell query). Opens the rail as a
            slide-over drawer. Labelled "Page list", not "Pages": it sits right
            above the toolbar's "Pages" layout toggle, which does another job. */}
        {!lookA && (
        <button className="doc-mobile-pages-btn"
                aria-label={docMode === 'screenplay' ? 'Pages and scenes' : 'Page list'} aria-expanded={mobileRailOpen}
                onClick={() => { setRails(r => ({ ...r, left: true })); setMobileRailOpen(o => !o); }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3 H12 M2 7 H12 M2 11 H12" />
          </svg>
          {/* The drawer carries the scene nav too in screenplay mode — say so,
              or the only way to jump between scenes on a phone is invisible. */}
          {docMode === 'screenplay' ? 'Scenes' : 'Page list'}
        </button>
        )}
        {/* The doc look's one row (a screenplay's is its own, its elements
            in the side panel; a reader gets Find, the zoom and Export). */}
        {!isPublic && lookA && (
          <Suspense fallback={<div className="dl-cap" aria-hidden="true"><div className="dl-bar-ph" /></div>}>
            <DocBarA editor={editorRef.current}
                     docName={board.name}
                     ydoc={ydoc}
                     scope={scope}
                     docMode={docMode}
                     onToggleScreenplay={canEdit ? toggleScreenplay : null}
                     pageless={pageless}
                     pagesShownContinuous={phoneReflow}
                     onTogglePageless={onTogglePageless}
                     onInsertBookmark={insertBookmarkAtCaret}
                     onInsertImage={guestMode ? null : pickImageFromDisk}
                     onInsertBoardEmbed={guestMode ? null : pickBoardEmbed}
                     onOpenFind={openFind}
                     onOpenLink={(editor) => openLinkPickerRef.current?.(editor)}
                     onAddComment={() => openAddCommentRef.current?.()}
                     zoom={effectiveZoom}
                     fitEligible={fitEligible}
                     onZoomIn={() => setZoom((z) => z + ZOOM_STEP)}
                     onZoomOut={() => setZoom((z) => z - ZOOM_STEP)}
                     onZoomReset={resetZoom}
                     canEdit={canEdit}
                     canExport={allowExport}
                     onOpenElements={() => setPanel({ open: true, tab: 'elements' })} />
          </Suspense>
        )}
        {!isPublic && !lookA && (
        <DocToolbar editor={editorRef.current}
                    docName={board.name}
                    ydoc={ydoc}
                    scope={scope}
                    docMode={docMode}
                    onToggleScreenplay={toggleScreenplay}
                    titlePageEnabled={titlePage.enabled}
                    onToggleTitlePage={toggleTitlePage}
                    sceneNumbersShow={sceneNumbersShow}
                    onSetSceneNumbersShow={onSetSceneNumbersShow}
                    pageless={pageless}
                    pagesShownContinuous={phoneReflow}
                    onTogglePageless={onTogglePageless}
                    onInsertBookmark={insertBookmarkAtCaret}
                    canExport={allowExport}
                    onInsertImage={guestMode ? null : pickImageFromDisk}
                    onInsertBoardEmbed={guestMode ? null : pickBoardEmbed}
                    onOpenFind={openFind}
                    onOpenLink={(editor) => openLinkPickerRef.current?.(editor)}
                    onAddComment={() => openAddCommentRef.current?.()}
                    zoom={effectiveZoom}
                    fitMode={fitMode}
                    onZoomIn={() => setZoom((z) => z + ZOOM_STEP)}
                    onZoomOut={() => setZoom((z) => z - ZOOM_STEP)}
                    onZoomReset={resetZoom}
                    canEdit={canEdit} />
        )}
        <DocFindReplace editor={editorRef.current}
                        editors={activePageId ? sheetIds.map(sid => editorsRef.current.get(sid)).filter(Boolean) : []}
                        open={findOpen}
                        canEdit={canEdit && !isPublic}
                        onClose={() => setFindOpen(false)} />
        <div className={`doc-paper${fitMode ? ' is-fit-width' : ''}${room !== 'page' ? ' is-narrow' : ''}${room === 'tight' ? ' is-tight' : ''}${docMode === 'screenplay' ? ' is-screenplay' : ''}${docMode === 'screenplay' && sceneNumbersShow ? ' show-scene-numbers' : ''}${docMode !== 'screenplay' && layoutPageless ? ' is-pageless' : ''}`} ref={paperRef}
             style={{ position: 'relative', '--doc-zoom': effectiveZoom }}>
          {/* Grain texture is painted as a background-image on .doc-paper
              with background-attachment:local so it tiles across the
              full scrollHeight — no separate <div> needed. */}
          {activePageId && awareness && (
            <DocPresence getAwareness={getAwareness} boardId={board.id} pageId={activePageId}
                         paperRef={paperRef} editor={editorRef.current}
                         getEditors={() => sheetIds.map(sid => editorsRef.current.get(sid)).filter(Boolean)}
                         zoom={effectiveZoom}
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
                key={`${sid}:${docMode === 'screenplay' ? 'sp' : (layoutPageless ? 'pl' : 'pg')}`}
                ydoc={ydoc}
                scope={scope}
                docMode={docMode}
                pageless={layoutPageless}
                zoom={effectiveZoom}
                pageId={activePageId}
                sheetId={sid}
                activePageId={activePageId}
                workspaceId={workspaceId}
                userId={userId}
                currentUser={currentUser}
                autofocus={!restoreRef.current && namingPageRef.current !== sid}
                takeRefocus={takeRefocus}
                onEditorReady={onEditorReady}
                onEditorDestroy={onEditorDestroy}
                onEditorFocus={onEditorFocus}
                awareness={awareness}
                onNavigateTarget={handleNavigateTarget}
                registerOpenLinkPicker={registerOpenLinkPicker}
                registerOpenAddComment={registerOpenAddComment}
                onShowThread={lookA && !isPublic ? showThreadInPanel : null}
                boards={Object.values(boards || {})}
                editable={canEdit}
                isPublic={isPublic}
                guestMode={guestMode}
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
          {/* An empty doc's other ways in, under its "Start writing…" (the doc
              look's start, mockup S-open). */}
          {lookA && canEdit && !guestMode && !isPublic && docMode !== 'screenplay'
            && pages.length === 1 && sheetIds.length === 1 && editorRef.current && (
            <Suspense fallback={null}>
              <DocStarters editor={editorRef.current} paperRef={paperRef} ydoc={ydoc} scope={scope}
                           pageId={activePageId} onScreenplay={toggleScreenplay} onRename={onRename} />
            </Suspense>
          )}
          {/* A table's own bar, with the caret in one (the doc look's, mockup
              G-table). */}
          {lookA && canEdit && !isPublic && editorRef.current && (
            <Suspense fallback={null}>
              <DocTableBar editor={editorRef.current} paperRef={paperRef} />
            </Suspense>
          )}
        </div>
        {/* Save state is reported per HOST board (yboard persists the board
            that holds the doc); board.id here is the doc card's id. In the
            doc look the footer runs under the whole window instead (below). */}
        {!lookA && (
        <DocStatusFooter editor={editorRef.current} ydoc={ydoc} boardId={scope?.boardId || (scope ? null : board.id)}
                         showSave={!guestMode} />
        )}
      </section>

      {panelOpen && (
        <Suspense fallback={null}>
          <DocSidePanel tab={panel.tab} onTab={(tab) => setPanel((p) => ({ ...p, tab }))}
                        sheet={panelSheet} onClose={closePanel}
                        host={panelSheet ? rootRef.current?.closest('.doc-card-modal') || null : null}
                        screenplay={docMode === 'screenplay' && canEdit} openComments={openComments}
                        onEscape={() => { try { editorRef.current?.commands.focus(); } catch (_) {} }}>
            {{
              elements: (
                <DocElementsTab editor={editorRef.current}
                                titlePage={titlePage.enabled} onToggleTitlePage={toggleTitlePage}
                                sceneNumbers={sceneNumbersShow} onSetSceneNumbers={onSetSceneNumbersShow} />
              ),
              comments: (
                <DocCommentsTab ydoc={ydoc} scope={scope} threads={comments}
                                editor={editorRef.current} currentUser={currentUser}
                                canEdit={canEdit && !guestMode}
                                workspaceId={workspaceId} boardId={scope?.boardId || null} cardId={scope?.docCardId || null}
                                selectedId={panelThread} onSelect={setPanelThread} onJump={jumpToThread} />
              ),
              find: (active) => (
                <DocFindTab ydoc={ydoc} scope={scope} canEdit={canEdit && !guestMode}
                            active={active} activePageId={activePageId}
                            editorsOf={(pid) => (pid ? getPageSheetIds(ydoc, pid, scope) : [])
                              .map((sid) => editorsRef.current.get(sid)).filter((ed) => ed && !ed.isDestroyed)}
                            reveal={reveal} seed={findSeed} sheet={panelSheet}
                            onLeave={panelSheet ? closePanel : null} />
              ),
            }}
          </DocSidePanel>
        </Suspense>
      )}
      {/* The picked thread's words lit in the page, and the one jumped to
          flashed: a rule on the mark's id, since ProseMirror owns the spans
          and redraws over a class put on one. Ids are the comment keys'
          (lib/commentKeys.js), so nothing in one needs escaping. */}
      {panelOpen && panel.tab === 'comments' && /^[A-Za-z0-9_-]{1,64}$/.test(panelThread || '') && (
        <style>{`.dl-surface .tt-comment[data-comment-id="${panelThread}"]{background:var(--soleil-soft);text-decoration-color:var(--soleil)}`}</style>
      )}
      {flashThread && /^[A-Za-z0-9_-]{1,64}$/.test(flashThread.id) && (
        <style>{`.dl-surface .tt-comment[data-comment-id="${flashThread.id}"]{animation:${flashThread.n % 2 ? 'dl-flash-a' : 'dl-flash-b'} 1.4s ease-out}`}</style>
      )}
      {lookA && (
        <Suspense fallback={null}>
          <DocFootA editor={editorRef.current} boardId={scope?.boardId || (scope ? null : board.id)}
                    showSave={!guestMode}
                    zoom={effectiveZoom} fitMode={fitMode} fitEligible={fitEligible}
                    onZoom={(z) => setZoom(z)}
                    onZoomIn={() => setZoom((z) => z + ZOOM_STEP)}
                    onZoomOut={() => setZoom((z) => z - ZOOM_STEP)}
                    onZoomReset={resetZoom} />
        </Suspense>
      )}

      {embedPickerOpen && (
        <DocBoardEmbedPicker
          boards={boards}
          onPick={(picked) => { embedPickedRef.current?.(picked); embedPickedRef.current = null; }}
          onClose={() => { setEmbedPickerOpen(false); embedPickedRef.current = null; }}
        />
      )}

    </div>
    </IconWeightContext.Provider>
  );
}
