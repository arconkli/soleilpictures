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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDocBoard, usePageSheets } from '../hooks/useDocBoard.js';
import { addBookmark, addPage, addPageSheet, detachPageSheet, reattachPageSheet, purgeSheetContent, renamePage, getDocMode, setDocMode, getTitlePage, setTitlePage, getSceneNumbersShow, setSceneNumbersShow, getPageless, setPageless, metaMap } from '../lib/docState.js';
import { encodeAnchor, resolveAnchor } from '../lib/bookmarkRelPos.js';
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
import { DocLinkPicker } from './DocLinkPicker.jsx';

const ACTIVE_PAGE_KEY = (boardId) => `soleil.boards.docActivePage.${boardId}`;
const RAILS_KEY = 'soleil.boards.docRails';
const ZOOM_KEY = 'soleil.boards.docZoom';
const ZOOM_MIN = 0.5;
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
  const [activePageId, setActivePageIdState] = useState(() => {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage.getItem(ACTIVE_PAGE_KEY(board.id));
  });
  const setActivePageId = (id) => {
    setActivePageIdState(id);
    try {
      if (id) sessionStorage.setItem(ACTIVE_PAGE_KEY(board.id), id);
      else sessionStorage.removeItem(ACTIVE_PAGE_KEY(board.id));
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

  // Doc mode ('doc' | 'screenplay'). Lives in the per-scope docMeta map so it
  // persists + collaborates; observe it so a peer's toggle reflects here.
  const [docMode, setDocModeState] = useState(() => getDocMode(ydoc, scope));
  useEffect(() => {
    const m = metaMap(ydoc, scope);
    setDocModeState(getDocMode(ydoc, scope));
    if (!m) return;
    const update = () => setDocModeState(getDocMode(ydoc, scope));
    m.observe(update);
    return () => m.unobserve(update);
  }, [ydoc, scope]);
  const toggleScreenplay = useCallback(() => {
    setDocMode(ydoc, scope, docMode === 'screenplay' ? 'doc' : 'screenplay');
  }, [ydoc, scope, docMode]);

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
  useEffect(() => {
    const m = metaMap(ydoc, scope);
    setPagelessState(getPageless(ydoc, scope));
    if (!m) return;
    const update = () => setPagelessState(getPageless(ydoc, scope));
    m.observe(update);
    return () => m.unobserve(update);
  }, [ydoc, scope]);
  const onTogglePageless = useCallback(() => setPageless(ydoc, scope, !pageless), [ydoc, scope, pageless]);
  const toggleTitlePage = useCallback(() => {
    const next = !titlePage.enabled;
    commitTitlePage({ enabled: next });
    // Enabling: make sure screenplay mode is on, then scroll the new page into
    // view on the next frame.
    if (next) {
      if (docMode !== 'screenplay') setDocMode(ydoc, scope, 'screenplay');
      requestAnimationFrame(() => {
        paperRef.current?.querySelector('.sp-title-page')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [titlePage.enabled, commitTitlePage, docMode, ydoc, scope]);

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
  const setZoom = (z) => {
    const next = clampZoom(typeof z === 'function' ? z(zoom) : z);
    setZoomState(next);
    try { localStorage.setItem(zoomStorageKey, String(next)); } catch (_) {}
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

  // Link picker — same modal handles ⌘K + the bubble-menu link button. Two
  // tabs: URL or Bookmark (cross-doc anchor link).
  const [linkPicker, setLinkPicker] = useState(null); // { initialUrl, onPick, onRemove }
  const requestLink = (editor) => {
    const initialUrl = editor.getAttributes('link').href || '';
    setLinkPicker({
      initialUrl,
      onPick: (href) => editor.chain().focus().extendMarkRange('link').setLink({ href }).run(),
      onRemove: () => editor.chain().focus().extendMarkRange('link').unsetLink().run(),
    });
  };

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
        setZoom(1);
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
    const primary = [...pages]
      .filter(p => p.parent_id == null)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
    if (!primary) return;
    // "Tracking" = the page still has an auto-generated name (so syncing the
    // first real card title is welcome) or its name equals the previous title.
    const DEFAULT_NAMES = new Set(['', 'Untitled', 'Untitled doc']);
    const tracking = primary.name === prev || DEFAULT_NAMES.has(primary.name || '');
    if (tracking) renamePage(ydoc, primary.id, titleOverride, scope);
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
    // Detach (keep content) + offer Undo, matching the app's delete→Undo-toast
    // convention. Doc-structural ops are DOC_ORIGIN (untracked by the canvas
    // UndoManager), so restore is explicit. Purge the orphaned content only if
    // the user doesn't undo within the toast window.
    const idx = detachPageSheet(ydoc, activePageId, sheetId, scope);
    let undone = false;
    feedback.toast({
      type: 'info',
      message: 'Page deleted',
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: () => { undone = true; reattachPageSheet(ydoc, activePageId, sheetId, idx, scope); },
      },
    });
    setTimeout(() => { if (!undone) purgeSheetContent(ydoc, sheetId, scope); }, 6500);
  }, [activePageId, ydoc, scope, feedback]);

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
    const onVV = () => {
      const occluded = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const open = occluded > 80;
      paper.style.paddingBottom = open ? `${occluded}px` : '';
      if (open) { try { editorRef.current?.commands?.scrollIntoView(); } catch (_) {} }
    };
    vv.addEventListener('resize', onVV);
    vv.addEventListener('scroll', onVV);
    return () => {
      vv.removeEventListener('resize', onVV);
      vv.removeEventListener('scroll', onVV);
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
                aria-label="Pages" aria-expanded={mobileRailOpen}
                onClick={() => { setRails(r => ({ ...r, left: true })); setMobileRailOpen(o => !o); }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3 H12 M2 7 H12 M2 11 H12" />
          </svg>
          Pages
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
                    onOpenFind={() => setFindOpen(true)}
                    onOpenLink={(editor) => openLinkPickerRef.current?.(editor)}
                    onAddComment={() => openAddCommentRef.current?.()}
                    zoom={zoom}
                    onZoomIn={() => setZoom((z) => z + ZOOM_STEP)}
                    onZoomOut={() => setZoom((z) => z - ZOOM_STEP)}
                    onZoomReset={() => setZoom(1)} />
        )}
        <DocFindReplace editor={editorRef.current}
                        editors={activePageId ? sheetIds.map(sid => editorsRef.current.get(sid)).filter(Boolean) : []}
                        open={findOpen}
                        onClose={() => setFindOpen(false)} />
        <div className={`doc-paper${docMode === 'screenplay' ? ' is-screenplay' : ''}${docMode === 'screenplay' && sceneNumbersShow ? ' show-scene-numbers' : ''}${docMode !== 'screenplay' && pageless ? ' is-pageless' : ''}`} ref={paperRef}
             style={{ position: 'relative', '--doc-zoom': zoom }}>
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
                key={`${sid}:${docMode}:${pageless ? 'pl' : 'pg'}`}
                ydoc={ydoc}
                scope={scope}
                docMode={docMode}
                pageless={pageless}
                zoom={zoom}
                pageId={activePageId}
                sheetId={sid}
                activePageId={activePageId}
                workspaceId={workspaceId}
                userId={userId}
                currentUser={currentUser}
                onEditorReady={onEditorReady}
                onEditorDestroy={onEditorDestroy}
                onEditorFocus={onEditorFocus}
                onRequestBoardEmbed={requestBoardEmbed}
                onRequestLink={requestLink}
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
      {linkPicker && (
        <DocLinkPicker
          initialUrl={linkPicker.initialUrl}
          boards={boards}
          currentBoardId={board.id}
          onPick={linkPicker.onPick}
          onRemove={linkPicker.onRemove}
          onClose={() => setLinkPicker(null)}
        />
      )}

    </div>
  );
}
