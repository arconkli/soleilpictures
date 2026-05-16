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
import { useDocBoard } from '../hooks/useDocBoard.js';
import { addBookmark, addPage } from '../lib/docState.js';
import { DocPageTree } from './DocPageTree.jsx';
import { DocPageEditor } from './DocPageEditor.jsx';
import { DocPresence } from './DocPresence.jsx';
import { DocToolbar } from './DocToolbar.jsx';
import { DocFindReplace } from './DocFindReplace.jsx';
import { DocStatusFooter } from './DocStatusFooter.jsx';
// Templates removed — new docs land in a single empty page.
import { DocBoardEmbedPicker } from './DocBoardEmbedPicker.jsx';
import { DocLinkPicker } from './DocLinkPicker.jsx';

const ACTIVE_PAGE_KEY = (boardId) => `soleil.boards.docActivePage.${boardId}`;
const RAILS_KEY = 'soleil.boards.docRails';
const ZOOM_KEY = 'soleil.boards.docZoom';
const ZOOM_MIN = 0.5;
// Auto-create a sibling page when the editor wrap grows past ~90% of one
// printed page (1056px = 11" at 96dpi). Fires at most once per active page.
const AUTO_NEW_PAGE_THRESHOLD = 950;
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
                              onClose }) {
  const { pages, bookmarks, comments } = useDocBoard(ydoc, scope);
  // Subscribe to the awareness instance lazily — it's only created after the
  // realtime channel attaches in yboard.js. getAwareness() returns null
  // until then, and yboard doesn't trigger a re-render here when realtime
  // attaches, so we poll until non-null then store in state.
  const [awareness, setAwareness] = useState(() => getAwareness?.() || null);
  useEffect(() => {
    if (awareness) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const aw = getAwareness?.();
      if (aw) { setAwareness(aw); return; }
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

  // Ref to .doc-paper — declared early because the zoom/pinch effect
  // below needs it. The DocPresence overlay also uses it later (cursor/
  // caret coords are paper-relative).
  const paperRef = useRef(null);

  // Page zoom — global preference (every doc opens at the user's last
  // zoom level). Cmd +/−/0 + toolbar buttons + Ctrl+wheel (trackpad pinch)
  // all adjust this value.
  const [zoom, setZoomState] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem(ZOOM_KEY) || '');
      return Number.isFinite(v) ? clampZoom(v) : 1;
    } catch (_) { return 1; }
  });
  const setZoom = (z) => {
    const next = clampZoom(typeof z === 'function' ? z(zoom) : z);
    setZoomState(next);
    try { localStorage.setItem(ZOOM_KEY, String(next)); } catch (_) {}
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

  // First-load: brand-new doc → drop a single empty page (no template picker).
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

  // Add a sibling page right after the active page (no view switch).
  // Used by both the manual "+ New page" button below the editor and the
  // ResizeObserver-driven auto-create below.
  const pagesRef = useRef(pages);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  const addSiblingBelow = useCallback(() => {
    const cur = pagesRef.current.find(p => p.id === activePageId);
    if (!cur) return;
    addPage(ydoc, { parent_id: cur.parent_id ?? null, scope });
  }, [activePageId, ydoc, scope]);

  // Auto-create a sibling when the current page's editor wrap fills up.
  // Keyed by activePageId so each page fires at most once. Skipped if a
  // next-sibling already exists.
  const autoFiredRef = useRef(new Map());
  useEffect(() => {
    if (!ready || !activePageId) return;
    const paper = paperRef.current;
    if (!paper) return;
    const wrap = paper.querySelector('.doc-editor-wrap');
    if (!wrap) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.contentRect.height < AUTO_NEW_PAGE_THRESHOLD) continue;
        if (autoFiredRef.current.get(activePageId)) continue;
        const all = pagesRef.current;
        const cur = all.find(p => p.id === activePageId);
        if (!cur) continue;
        const hasNext = all.some(p =>
          p.parent_id === cur.parent_id && (p.order ?? 0) > (cur.order ?? 0)
        );
        if (hasNext) continue;
        autoFiredRef.current.set(activePageId, true);
        addPage(ydoc, { parent_id: cur.parent_id ?? null, scope });
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [activePageId, ready, ydoc, scope]);

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
      const ed = editorRef.current;
      if (!ed) { if (tries++ < 30) setTimeout(tick, 40); return; }
      const docSize = ed.state.doc.content.size;
      const pos = Math.max(1, Math.min(target.anchor || 1, Math.max(1, docSize - 1)));
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
  // operate on it. DocPageEditor passes it up via onEditorReady.
  const editorRef = useRef(null);
  const [, force] = useState(0);
  const onEditorReady = (ed) => { editorRef.current = ed; force(n => n + 1); };

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

  const insertBookmarkAtCaret = (editor) => {
    if (!editor || !activePageId) return;
    const anchor = editor.state.selection.from;
    // Use the surrounding text as a default name suggestion.
    let suggested = '';
    try {
      const $pos = editor.state.doc.resolve(anchor);
      const para = $pos.parent;
      suggested = para?.textContent?.slice(0, 40) || '';
    } catch (_) {}
    // eslint-disable-next-line no-alert
    const name = window.prompt('Bookmark name', suggested || 'Bookmark');
    if (!name) return;
    addBookmark(ydoc, { name: name.trim() || 'Bookmark', pageId: activePageId, anchor, scope });
  };

  if (!ready) {
    return <div className="doc-surface"><div className="doc-loading">Loading…</div></div>;
  }

  return (
    <div className={`doc-surface no-right-rail ${rails.left ? '' : 'rail-left-collapsed'}`}>
      {/* Left rail — page tree */}
      <aside className="doc-rail doc-rail-left">
        <button className="doc-rail-toggle"
                title={rails.left ? 'Hide pages' : 'Show pages'}
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
            onSelectPage={setActivePageId}
            peers={peersOnBoard}
            onJumpToPeer={onJumpToPeer}
          />
        )}
      </aside>

      {/* Center — toolbar + editor */}
      <section className="doc-center">
        <DocToolbar editor={editorRef.current}
                    docName={board.name}
                    onInsertBookmark={insertBookmarkAtCaret}
                    onOpenFind={() => setFindOpen(true)}
                    onOpenLink={(editor) => openLinkPickerRef.current?.(editor)}
                    onAddComment={() => openAddCommentRef.current?.()}
                    zoom={zoom}
                    onZoomIn={() => setZoom((z) => z + ZOOM_STEP)}
                    onZoomOut={() => setZoom((z) => z - ZOOM_STEP)}
                    onZoomReset={() => setZoom(1)} />
        <DocFindReplace editor={editorRef.current}
                        open={findOpen}
                        onClose={() => setFindOpen(false)} />
        <div className="doc-paper" ref={paperRef}
             style={{ position: 'relative', '--doc-zoom': zoom }}>
          {/* Same grain layer the canvas uses — opacity:0.03 ambient
              noise — so the doc's dark gutter matches the canvas's
              texture exactly. The .doc-editor-wrap (the actual page
              you type on) sits above it and isn't grained. */}
          <div className="grain-canvas" aria-hidden="true" />
          {activePageId && awareness && (
            <DocPresence getAwareness={getAwareness} boardId={board.id} pageId={activePageId}
                         paperRef={paperRef} editor={editorRef.current}
                         currentUser={currentUser} />
          )}
          {activePageId ? (
            // key forces a fresh editor instance on page switch (Collaboration
            // extension can't re-bind to a different fragment).
            <DocPageEditor
              key={activePageId}
              ydoc={ydoc}
              scope={scope}
              pageId={activePageId}
              activePageId={activePageId}
              workspaceId={workspaceId}
              userId={userId}
              currentUser={currentUser}
              onEditorReady={onEditorReady}
              onRequestBoardEmbed={requestBoardEmbed}
              onRequestLink={requestLink}
              awareness={awareness}
              onNavigateTarget={handleNavigateTarget}
              registerOpenLinkPicker={registerOpenLinkPicker}
              registerOpenAddComment={registerOpenAddComment}
              boards={Object.values(boards || {})}
              editable={canEdit}
            />
          ) : (
            <div className="doc-empty">No page selected.</div>
          )}
          {activePageId && canEdit && (
            <button className="doc-add-page-below"
                    type="button"
                    onClick={addSiblingBelow}
                    title="Add a new page after this one">
              + New page
            </button>
          )}
        </div>
        <DocStatusFooter editor={editorRef.current} ydoc={ydoc} />
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
