// Canvas card that holds an entire rich-text doc (pages + bookmarks +
// comments) inline. The card itself is a small preview — click to expand.
//
// Open modes:
//   'full'  — fullscreen overlay (default; canvas is hidden behind).
//   'side'  — docked to the right, draggable width; canvas remains
//             interactive on the left so users can click into boards while
//             reading or writing.
// Toggle between the two with the dock/maximize buttons in the modal header.
//
// Per-card storage means each doc card on a canvas is independent and travels
// with the canvas's snapshot.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardScope, readDocSummary } from '../lib/docState.js';
import { DocSurface } from './DocSurface.jsx';
import { DocOverflowMenu } from './DocOverflowMenu.jsx';
import { Avatar } from './primitives.jsx';

const DEFAULT_SIDE_RATIO = 0.5;
const RATIO_KEY = 'soleil.boards.docCardSideRatio';

export function RichDocCard({
  card, ydoc, cardYMap,
  workspaceId, userId, currentUser, getAwareness, boards = {},
  // Workspace peers + jump-to-peer handler — used by DocCardOverlay to
  // render peer avatars in its modal header and pass per-page presence
  // dots into DocPageTree. Filtered to peers whose docCardId === card.id.
  wsPeers = [], onJumpToPeer,
  // false → view-only board: pass through to DocSurface so Tiptap
  // becomes non-editable.
  canEdit = true,
  autoFocus = false, onUpdate,
}) {
  // Augment cardScope with the card's id under both `cardId` and
  // `docCardId` so downstream callers (DocSurface header, link/page-
  // index sync) can identify which card this scope belongs to.
  const scope = cardYMap ? { ...cardScope(cardYMap), cardId: card.id, docCardId: card.id } : null;
  const [mode, setMode] = useState(autoFocus ? 'full' : 'closed'); // 'closed' | 'full' | 'side'
  const [previewKey, setPreviewKey] = useState(0);
  // Click-to-jump landing target: when App.jumpToPeer dispatches a
  // soleil-open-doc-card event, we self-open and stash the peer's
  // pageId+scrollTop here so DocSurface inside the overlay can consume
  // it via its existing pendingScroll flow.
  const [pendingScroll, setPendingScroll] = useState(null);
  const [sideRatio, setSideRatio] = useState(() => {
    try { const v = parseFloat(localStorage.getItem(RATIO_KEY) || ''); return Number.isFinite(v) && v > .25 && v < .75 ? v : DEFAULT_SIDE_RATIO; }
    catch (_) { return DEFAULT_SIDE_RATIO; }
  });
  useEffect(() => {
    try { localStorage.setItem(RATIO_KEY, String(sideRatio)); } catch (_) {}
  }, [sideRatio]);

  const summary = (ydoc && scope?.pages) ? readDocSummary(ydoc, 220, scope) : { pages: [], firstText: '', firstPageName: '' };
  const pageCount = summary.pages.length;

  const open = (m) => setMode(m);
  const close = () => {
    setMode('closed');
    setPreviewKey((n) => n + 1);
  };

  // Listen for jump-to-this-doc-card events. App.jumpToPeer fires these
  // after navigating to the host board; whichever RichDocCard matches the
  // cardId pops itself open (in 'full' mode) and primes pendingScroll so
  // the inner DocSurface switches to the peer's page + scrolls to their
  // exact spot. pendingScroll carries pageId so an already-open card can
  // also switch pages on click — not just scroll.
  useEffect(() => {
    const onOpen = (e) => {
      const { cardId, pageId, scrollTop } = e.detail || {};
      if (cardId !== card.id) return;
      if (pageId) {
        try { sessionStorage.setItem(`soleil.boards.docActivePage.${card.id}`, pageId); } catch (_) {}
      }
      setPendingScroll({ boardId: card.id, pageId: pageId || null, scrollTop: scrollTop || 0 });
      setMode('full');
    };
    document.addEventListener('soleil-open-doc-card', onOpen);
    return () => document.removeEventListener('soleil-open-doc-card', onOpen);
  }, [card.id]);

  // Filter workspace peers to those currently inside THIS doc card (and
  // not me). Used both for the avatar stack in the modal header and for
  // the per-page dots that DocPageTree renders inside DocSurface.
  const peersOnCard = useMemo(() => (wsPeers || []).filter(p =>
    p?.location?.docCardId === card.id && p?.user?.id !== currentUser?.id
  ), [wsPeers, card.id, currentUser?.id]);

  // Drag the side-mode divider. Stop propagation + capture pointer so the
  // canvas underneath never sees the events (otherwise dragging the divider
  // could accidentally trigger card-drag handlers on the canvas behind).
  const onDividerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch (_) {}
    const onMove = (ev) => {
      ev.preventDefault?.();
      const next = Math.max(.28, Math.min(.78, 1 - (ev.clientX / window.innerWidth)));
      setSideRatio(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <>
      <div className="doc-card" onDoubleClick={(e) => { e.stopPropagation(); open('full'); }}>
        {/* Peer-presence dots — shown on the card preview when peers are
            inside this doc card. Same visual + interaction model as the
            BoardCard presence stack so the breadcrumb trail (canvas →
            board → doc card → page) reads consistently. */}
        {peersOnCard.length > 0 && (
          <div className="doc-card-presence" aria-label={`${peersOnCard.length} in this doc`}>
            {peersOnCard.slice(0, 3).map(p => (
              <button key={p.user?.id}
                      className="doc-card-presence-dot"
                      style={{ background: p.user?.color || '#4f8df8' }}
                      title={`${p.user?.name || 'Someone'} — jump to their page`}
                      onClick={(e) => { e.stopPropagation(); onJumpToPeer?.(p.location); }}>
                {(p.user?.name || p.user?.email || '?')[0].toUpperCase()}
              </button>
            ))}
            {peersOnCard.length > 3 && (
              <span className="doc-card-presence-dot is-overflow"
                    title={`+${peersOnCard.length - 3} more`}>+{peersOnCard.length - 3}</span>
            )}
          </div>
        )}
        {/* Magazine-tile preview — title + thin soleil rule + byline +
            serif excerpt. No "DOC" tag, no footer bar. Open buttons
            fade in on hover at the bottom-right (.doc-card-actions). */}
        <div className="doc-card-page" key={previewKey}>
          <div className="doc-card-title">{card.title || 'Untitled'}</div>
          <div className="doc-card-rule" />
          <div className="doc-card-byline">
            {pageCount > 0 && (
              <span>{pageCount} {pageCount === 1 ? 'page' : 'pages'}</span>
            )}
          </div>
          {summary.firstText && (
            <div className="doc-card-text">{summary.firstText}</div>
          )}
        </div>
        <div className="doc-card-actions">
          <button className="doc-card-open" title="Open beside (dock to right)"
                  onClick={(e) => { e.stopPropagation(); open('side'); }}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <rect x="1.5" y="2" width="11" height="10" rx="1.4" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M8 2 V12" stroke="currentColor" strokeWidth="1.2"/>
              <rect x="8.5" y="2.5" width="3.5" height="9" fill="currentColor" opacity=".18"/>
            </svg>
          </button>
          <button className="doc-card-open" title="Open fullscreen"
                  onClick={(e) => { e.stopPropagation(); open('full'); }}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 5 V2 H5 M12 5 V2 H9 M2 9 V12 H5 M12 9 V12 H9" />
            </svg>
          </button>
        </div>
      </div>

      {mode !== 'closed' && createPortal(
        <DocCardOverlay
          mode={mode}
          sideRatio={sideRatio}
          card={card}
          ydoc={ydoc}
          scope={scope}
          workspaceId={workspaceId}
          userId={userId}
          currentUser={currentUser}
          getAwareness={getAwareness}
          boards={boards}
          onUpdate={onUpdate}
          onSetMode={setMode}
          onClose={close}
          onDividerDown={onDividerDown}
          pendingScroll={pendingScroll}
          onPendingScrollConsumed={() => setPendingScroll(null)}
          peersOnCard={peersOnCard}
          onJumpToPeer={onJumpToPeer}
          canEdit={canEdit}
        />,
        document.body
      )}
    </>
  );
}

function DocCardOverlay({
  mode, sideRatio, card, ydoc, scope, workspaceId, userId, currentUser,
  getAwareness, boards, onUpdate, onSetMode, onClose, onDividerDown,
  pendingScroll, onPendingScrollConsumed,
  peersOnCard = [], onJumpToPeer,
  canEdit = true,
}) {
  // Pages-rail visibility (driven by the modal-head "Pages" toggle).
  // We can't reach DocSurface's internal rails state, so we fan out
  // to a class on the modal that overrides the grid columns when the
  // user wants pages hidden.
  const [pagesOpen, setPagesOpen] = useState(true);
  // Hold the live editor instance so DocOverflowMenu can surface
  // undo / redo / find. Captured via DocSurface's onEditorReady prop.
  const editorRef = useRef(null);
  const onEditorReady = useCallback((ed) => { editorRef.current = ed; }, []);

  // Esc closes from either mode.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Workspace-presence lifecycle. Tell App.jsx that this doc-card is
  // currently open so workspace presence can include docCardId/pageId/
  // scrollTop, and other peers can click our avatar → land in this card
  // on this exact page+scroll. Mount once per card, unmount on close.
  useEffect(() => {
    document.dispatchEvent(new CustomEvent('soleil-doccard-mount', { detail: { cardId: card.id }}));
    return () => {
      document.dispatchEvent(new CustomEvent('soleil-doccard-unmount', { detail: { cardId: card.id }}));
    };
  }, [card.id]);
  const emitPage = (pageId) => {
    document.dispatchEvent(new CustomEvent('soleil-doccard-page', { detail: { cardId: card.id, pageId }}));
  };
  const emitScroll = (scrollTop) => {
    document.dispatchEvent(new CustomEvent('soleil-doccard-scroll', { detail: { cardId: card.id, scrollTop }}));
  };

  const isSide = mode === 'side';
  const widthPct = isSide ? `${Math.round(sideRatio * 100)}%` : undefined;

  return (
    <>
      {/* Side-mode divider sits on the LEFT edge of the panel so users can
          drag to resize. Pointer-events stay outside the canvas drag-handlers
          because the divider itself is fixed-position above them. Top
          mirrors the panel's top (below the workspace topbar) so it doesn't
          stick up over the bar. */}
      {isSide && (
        <div className="doc-card-side-divider"
             style={{ right: widthPct, top: 42 }}
             onPointerDown={onDividerDown} />
      )}
      <div className={`doc-card-modal doc-card-modal-${mode}`}
           // Position via inline style. IMPORTANT: declare `inset` FIRST,
           // then override individual sides — otherwise React applies them
           // in object order and `inset: auto` clobbers our explicit edges.
           // Side mode starts at top: 42px so the workspace topbar (and the
           // sidebar to its left) stay visible + interactive while the doc
           // is open. Fullscreen still uses the .doc-card-modal-full inset.
           style={isSide ? { inset: 'auto', top: 42, right: 0, bottom: 0, left: 'auto', width: widthPct } : undefined}
           onPointerDown={(e) => e.stopPropagation()}>
        {/* Minimal modal chrome — just enough to navigate / dismiss.
            Title moved into the editor body (DocTitleBlock). */}
        <div className="doc-card-modal-head">
          <button
            className={`doc-card-pages-toggle ${pagesOpen ? 'is-active' : ''}`}
            title={pagesOpen ? 'Hide pages' : 'Show pages'}
            onClick={() => setPagesOpen(o => !o)}>
            Pages
          </button>
          <span className="doc-card-modal-head-spacer" />
          {peersOnCard.length > 0 && (
            <div className="doc-card-peers" title={`${peersOnCard.length} peer${peersOnCard.length === 1 ? '' : 's'} in this doc`}>
              {peersOnCard.slice(0, 4).map(p => (
                <button key={p.tabId || p.user?.id}
                        className="doc-card-peer"
                        title={`${p.user?.name || 'Someone'} — click to jump to their view`}
                        onClick={() => onJumpToPeer?.(p.location)}>
                  <Avatar name={p.user?.name || '?'} color={p.user?.color || '#4f8df8'} size={24} />
                </button>
              ))}
              {peersOnCard.length > 4 && (
                <span className="doc-card-peers-overflow">+{peersOnCard.length - 4}</span>
              )}
            </div>
          )}
          <DocOverflowMenu
            mode={mode}
            onToggleSide={mode === 'side' ? null : () => onSetMode('side')}
            onToggleFullscreen={mode === 'full' ? null : () => onSetMode('full')}
            editor={editorRef.current}
            onOpenFind={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, ctrlKey: true }))}
            onOpenExport={null}
          />
          <button className="doc-card-close" title="Close (Esc)" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M5 5 L13 13 M13 5 L5 13" />
            </svg>
          </button>
        </div>
        <div className="doc-card-modal-body">
          <DocSurface
            board={{ id: card.id, name: card.title || 'Untitled doc' }}
            ydoc={ydoc}
            ready={!!ydoc && !!scope?.pages}
            scope={scope}
            titleOverride={card.title}
            onTitleChange={(v) => onUpdate?.({ title: v })}
            onEditorReady={onEditorReady}
            workspaceId={workspaceId}
            userId={userId}
            boards={boards}
            getAwareness={getAwareness}
            currentUser={currentUser}
            onActivePageChange={emitPage}
            onPaperScroll={emitScroll}
            pendingScroll={pendingScroll}
            onPendingScrollConsumed={onPendingScrollConsumed}
            peersOnBoard={peersOnCard}
            onJumpToPeer={onJumpToPeer}
            canEdit={canEdit}
            railsLeftDefault={pagesOpen}
          />
        </div>
      </div>
    </>
  );
}
