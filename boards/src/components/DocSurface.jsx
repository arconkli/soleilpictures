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
import { DocToolbar } from './DocToolbar.jsx';
import { DocLinksPanel } from './DocLinksPanel.jsx';
import { DocRefsPanel } from './DocRefsPanel.jsx';
import { DocOutlinePanel } from './DocOutlinePanel.jsx';
import { DocFindReplace } from './DocFindReplace.jsx';
import { DocStatusFooter } from './DocStatusFooter.jsx';
// Templates removed — new docs land in a single empty page.
import { DocBoardEmbedPicker } from './DocBoardEmbedPicker.jsx';
import { DocCommentsPanel } from './DocCommentsPanel.jsx';
import { DocLinkPicker } from './DocLinkPicker.jsx';
import { addCommentThread } from '../lib/docState.js';

const ACTIVE_PAGE_KEY = (boardId) => `soleil.boards.docActivePage.${boardId}`;
const RAILS_KEY = 'soleil.boards.docRails';
const DEFAULT_RAILS = { left: true, right: true };

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
                              onClose }) {
  const { pages, bookmarks, comments } = useDocBoard(ydoc, scope);
  // Subscribe to the awareness instance lazily — it's only created after the
  // realtime channel attaches in yboard.js.
  const awareness = getAwareness?.() || null;
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
  };
  const [rails, setRails] = useState(loadRails);
  useEffect(() => { saveRails(rails); }, [rails]);
  const [rightTab, setRightTab] = useState('outline'); // 'outline' | 'links' | 'refs' | 'comments'

  // From the bubble-menu "comment" button. Wraps the current selection with
  // a comment mark + creates a thread in Y.Map. Threads are anchored by mark
  // id (NOT by position) so edits inside the comment range can't drift it.
  const startComment = (editor) => {
    if (!editor || !activePageId) return;
    const sel = editor.state.selection;
    if (sel.empty) return;
    // eslint-disable-next-line no-alert
    const body = window.prompt('Add a comment');
    if (!body || !body.trim()) return;
    const id = addCommentThread(ydoc, {
      pageId: activePageId,
      body: body.trim(),
      author: currentUser?.name || currentUser?.email || 'You',
      authorColor: currentUser?.color || '#4f8df8',
      scope,
    });
    editor.chain().focus().setMark('comment', { id }).run();
    setRightTab('comments');
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
  useEffect(() => {
    const onKey = (e) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && (e.key === 'f' || e.key === 'F')) {
        // Only intercept when the user is actually typing in our editor.
        const target = e.target;
        if (target?.closest?.('.tt-editor') || target?.closest?.('.doc-find')) {
          e.preventDefault();
          setFindOpen(true);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  // Cross-component link-picker wiring: DocPageEditor registers its
  // openLinkPicker function here; the toolbar calls it via onOpenLink.
  const openLinkPickerRef = useRef(null);
  const registerOpenLinkPicker = useCallback((fn) => { openLinkPickerRef.current = fn; }, []);

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
    <div className={`doc-surface ${rails.left ? '' : 'rail-left-collapsed'} ${rails.right ? '' : 'rail-right-collapsed'}`}>
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
          />
        )}
      </aside>

      {/* Center — toolbar + editor */}
      <section className="doc-center">
        <DocToolbar editor={editorRef.current}
                    docName={board.name}
                    onInsertBookmark={insertBookmarkAtCaret}
                    onOpenFind={() => setFindOpen(true)}
                    onOpenLink={(editor) => openLinkPickerRef.current?.(editor)} />
        <DocFindReplace editor={editorRef.current}
                        open={findOpen}
                        onClose={() => setFindOpen(false)} />
        <div className="doc-paper">
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
              onEditorReady={onEditorReady}
              onRequestBoardEmbed={requestBoardEmbed}
              onRequestLink={requestLink}
              onStartComment={startComment}
              awareness={awareness}
              onNavigateTarget={handleNavigateTarget}
              registerOpenLinkPicker={registerOpenLinkPicker}
              boards={Object.values(boards || {})}
            />
          ) : (
            <div className="doc-empty">No page selected.</div>
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

      {/* Right rail — Outline / Bookmarks tabs */}
      <aside className="doc-rail doc-rail-right">
        <button className="doc-rail-toggle"
                title={rails.right ? 'Hide panel' : 'Show panel'}
                onClick={() => setRails(r => ({ ...r, right: !r.right }))}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d={rails.right ? 'M6 3 L10 7 L6 11' : 'M8 3 L4 7 L8 11'} />
          </svg>
        </button>
        {rails.right && (
          <div className="doc-rail-inner">
            <div className="doc-tabs">
              <button className={`doc-tab ${rightTab === 'outline' ? 'is-active' : ''}`}
                      onClick={() => setRightTab('outline')}>Outline</button>
              <button className={`doc-tab ${rightTab === 'links' ? 'is-active' : ''}`}
                      onClick={() => setRightTab('links')}>Links</button>
              <button className={`doc-tab ${rightTab === 'refs' ? 'is-active' : ''}`}
                      onClick={() => setRightTab('refs')}>Refs</button>
              <button className={`doc-tab ${rightTab === 'comments' ? 'is-active' : ''}`}
                      onClick={() => setRightTab('comments')}>Comments{comments.length > 0 && <span className="doc-tab-count">{comments.length}</span>}</button>
            </div>
            {rightTab === 'outline' && (
              <DocOutlinePanel
                getEditor={() => editorRef.current}
                activePageId={activePageId}
              />
            )}
            {rightTab === 'links' && (
              <DocLinksPanel
                ydoc={ydoc}
                pages={pages}
                activePageId={activePageId}
                onSelectPage={setActivePageId}
                getEditor={() => editorRef.current}
              />
            )}
            {rightTab === 'refs' && (
              <DocRefsPanel
                workspaceId={workspaceId}
                docCardId={scope?.cardId ?? null}
                onOpenSource={(r) => console.info('open source backlink', r)}
              />
            )}
            {rightTab === 'comments' && (
              <DocCommentsPanel
                ydoc={ydoc}
                scope={scope}
                pages={pages}
                comments={comments}
                activePageId={activePageId}
                onSelectPage={setActivePageId}
                getEditor={() => editorRef.current}
                currentUser={currentUser}
              />
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
