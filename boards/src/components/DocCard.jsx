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

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardScope, readDocSummary } from '../lib/docState.js';
import { DocSurface } from './DocSurface.jsx';

const DEFAULT_SIDE_RATIO = 0.5;
const RATIO_KEY = 'soleil.boards.docCardSideRatio';

export function RichDocCard({
  card, ydoc, cardYMap,
  workspaceId, userId, currentUser, getAwareness, boards = {},
  autoFocus = false, onUpdate,
}) {
  const scope = cardYMap ? cardScope(cardYMap) : null;
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
  // the inner DocSurface scrolls to the peer's exact spot.
  useEffect(() => {
    const onOpen = (e) => {
      const { cardId, pageId, scrollTop } = e.detail || {};
      if (cardId !== card.id) return;
      if (pageId) {
        try { sessionStorage.setItem(`soleil.boards.docActivePage.${card.id}`, pageId); } catch (_) {}
      }
      setPendingScroll({ boardId: card.id, scrollTop: scrollTop || 0 });
      setMode('full');
    };
    document.addEventListener('soleil-open-doc-card', onOpen);
    return () => document.removeEventListener('soleil-open-doc-card', onOpen);
  }, [card.id]);

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
        <div className="doc-card-page" key={previewKey}>
          {card.title && <div className="doc-card-title">{card.title}</div>}
          {summary.firstPageName && summary.firstPageName !== card.title && (
            <div className="doc-card-h1">{summary.firstPageName}</div>
          )}
          <div className="doc-card-rule" />
          {summary.firstText && (
            <div className="doc-card-text">{summary.firstText}</div>
          )}
        </div>
        <div className="doc-card-foot">
          <span className="doc-card-tag">DOC</span>
          <span className="doc-card-meta">
            {pageCount > 0 ? `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}` : 'no pages'}
          </span>
          <button className="doc-card-open" title="Open beside (dock to right)"
                  onClick={(e) => { e.stopPropagation(); open('side'); }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <rect x="1.5" y="2" width="11" height="10" rx="1.4" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M8 2 V12" stroke="currentColor" strokeWidth="1.2"/>
              <rect x="8.5" y="2.5" width="3.5" height="9" fill="currentColor" opacity=".18"/>
            </svg>
          </button>
          <button className="doc-card-open" title="Open fullscreen"
                  onClick={(e) => { e.stopPropagation(); open('full'); }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
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
}) {
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
        <div className="doc-card-modal-head">
          <input className="doc-card-title-input"
                 value={card.title || ''}
                 placeholder="Untitled doc"
                 onChange={(e) => onUpdate?.({ title: e.target.value })} />
          {/* Mode toggles */}
          {mode === 'full' ? (
            <button className="doc-card-icon" title="Dock to side (split with canvas)"
                    onClick={() => onSetMode('side')}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2.5" y="3" width="15" height="14" rx="1.6" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M11 3 V17" stroke="currentColor" strokeWidth="1.4"/>
                <rect x="11.5" y="3.5" width="5.5" height="13" fill="currentColor" opacity=".18"/>
              </svg>
            </button>
          ) : (
            <button className="doc-card-icon" title="Open fullscreen"
                    onClick={() => onSetMode('full')}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7 V3 H7 M17 7 V3 H13 M3 13 V17 H7 M17 13 V17 H13" />
              </svg>
            </button>
          )}
          <button className="doc-card-close" title="Close (Esc)" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
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
            workspaceId={workspaceId}
            userId={userId}
            boards={boards}
            getAwareness={getAwareness}
            currentUser={currentUser}
            onActivePageChange={emitPage}
            onPaperScroll={emitScroll}
            pendingScroll={pendingScroll}
            onPendingScrollConsumed={onPendingScrollConsumed}
          />
        </div>
      </div>
    </>
  );
}
