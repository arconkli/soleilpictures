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

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardScope, readDocSummary, initCardDocStore } from '../lib/docState.js';
import { lazyWithReload } from '../lib/lazyWithReload.js';
import { Avatar } from './primitives.jsx';
import { EditableText } from './EditableText.jsx';

// DocSurface drags the entire TipTap/ProseMirror editor stack (vendor-editor,
// ~400KB raw) into whichever chunk imports it statically — which used to be
// CanvasSurface, taxing every board view. Lazy: the chunk loads on the first
// doc-card OPEN; the closed-card preview (readDocSummary) is TipTap-free, so
// a public /share board with no opened docs never downloads the editor.
// AppShell idle-prefetches it for signed-in users so the skeleton is rarely
// seen; public viewers pay the fetch only when they actually open a doc.
const DocSurface = lazyWithReload(() => import('./DocSurface.jsx').then(m => ({ default: m.DocSurface })));

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
  // true → public /share viewer: the closed preview renders normally, but
  // opening the heavy DocSurface editor is suppressed (it needs auth +
  // realtime, and pulls App-only contexts the share tree doesn't provide).
  isPublic = false,
  autoFocus = false, onUpdate,
}) {
  // Backfill any newly-introduced Y types on cards created before this
  // code shipped. initCardDocStore is idempotent — it only sets keys that
  // don't already exist — so it's safe to call on every mount. Without
  // this, sheets won't work on legacy cards because cardYMap.get(
  // 'docPageSheets'/'docSheetContent') returns undefined and addPageSheet
  // bails.
  if (cardYMap) initCardDocStore(ydoc, cardYMap);
  // Augment cardScope with the card's id under both `cardId` and
  // `docCardId` so downstream callers (DocSurface header, link/page-
  // index sync) can identify which card this scope belongs to.
  const scope = cardYMap ? { ...cardScope(cardYMap), cardId: card.id, docCardId: card.id } : null;
  // New docs no longer auto-open their full editor — autoFocus now means
  // "focus the title for renaming," letting the user rename + place the
  // card on the canvas first. The full editor opens on double-click,
  // explicit Open buttons, or peer-jump events.
  const [mode, setMode] = useState('closed'); // 'closed' | 'full' | 'side'
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

  // Pull a generous slice of the first page so the preview fills the blank
  // area with actual prose (rather than 1-2 lines + empty space). 600 chars
  // ≈ a paragraph-and-a-half of body copy at the preview's font size.
  const summary = (ydoc && scope?.pages) ? readDocSummary(ydoc, 600, scope) : { pages: [], firstText: '', firstPageName: '' };
  const pageCount = summary.pages.length;

  // Public viewers can open docs too — read-only, and always FULLSCREEN
  // (side mode's dock layout assumes the workspace topbar, and the dock
  // affordance is pointless on the chromeless /share surface).
  const open = (m) => setMode(isPublic ? 'full' : m);

  // Public single-click-to-open. Mirrors the board-cover pattern in
  // CanvasSurface's read-only branch: a release within 4px is a click and
  // opens; anything longer is a pan (the event still bubbles to the card
  // wrapper, whose public branch starts the pan — no stopPropagation /
  // preventDefault here). A plain onClick can't be used: Chrome fires
  // click after a pan released over the same card, which would pop the
  // doc open at the end of every drag across it.
  const onPublicPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest?.('.editable')) return; // title clicks don't open
    const pid = e.pointerId, sx = e.clientX, sy = e.clientY;
    const onUp = (ev) => {
      if (ev.pointerId !== pid) return;
      cleanup();
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) <= 4) setMode('full');
    };
    const onCancel = (ev) => { if (ev.pointerId === pid) cleanup(); };
    const cleanup = () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };
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
      <div className="doc-card"
           onDoubleClick={(e) => { e.stopPropagation(); open('full'); }}
           onPointerDown={isPublic ? onPublicPointerDown : undefined}>
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
        {/* Title is a top-pinned child of .doc-card (NOT inside the shrinking
            .doc-card-page) so a short card clips the body/footer from the
            bottom and the title is never cut off. */}
        {(card.title || autoFocus || onUpdate) && (
          <EditableText
            className="doc-card-title editable"
            value={card.title || ''}
            placeholder="Untitled doc"
            autoFocus={autoFocus}
            selectAllOnFocus={autoFocus}
            onChange={(v) => onUpdate?.({ title: v || null })}
          />
        )}
        <div className="doc-card-page" key={previewKey}>
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
                  aria-label="Open beside"
                  onClick={(e) => { e.stopPropagation(); open('side'); }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <rect x="1.5" y="2" width="11" height="10" rx="1.4" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M8 2 V12" stroke="currentColor" strokeWidth="1.2"/>
              <rect x="8.5" y="2.5" width="3.5" height="9" fill="currentColor" opacity=".18"/>
            </svg>
          </button>
          <button className="doc-card-open" title="Open fullscreen"
                  aria-label="Open fullscreen"
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
          peersOnCard={peersOnCard}
          onJumpToPeer={onJumpToPeer}
          canEdit={canEdit}
          isPublic={isPublic}
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
  isPublic = false,
}) {
  // Esc closes from either mode.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus management: when a brand-new (untitled) doc card opens, drop the
  // caret in the title input so the user can name it immediately. Restore
  // focus to whatever was focused before (e.g. the canvas card) on close so
  // keyboard users aren't dumped at the top of the page. We only auto-focus
  // when the doc has no title yet — reopening a named doc shouldn't hijack
  // focus away from the editor's own autofocus.
  const titleInputRef = useRef(null);
  const hadTitleOnOpenRef = useRef(!!card.title);
  useEffect(() => {
    const prev = (typeof document !== 'undefined') ? document.activeElement : null;
    if (!hadTitleOnOpenRef.current) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select?.();
    }
    return () => { try { prev?.focus?.(); } catch (_) {} };
    // Mount/unmount once per card open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
                 ref={titleInputRef}
                 aria-label="Document title"
                 value={card.title || ''}
                 placeholder="Untitled doc"
                 readOnly={!canEdit}
                 onChange={(e) => { if (canEdit) onUpdate?.({ title: e.target.value }); }} />
          {/* Peer-avatar stack — one per workspace peer currently in this
              doc card. Click an avatar → jumpToPeer takes you to their
              exact page + scroll. Hover shows their name. */}
          {peersOnCard.length > 0 && (
            <div className="doc-card-peers" title={`${peersOnCard.length} peer${peersOnCard.length === 1 ? '' : 's'} in this doc`}>
              {peersOnCard.slice(0, 4).map(p => (
                <button key={p.tabId || p.user?.id}
                        className="doc-card-peer"
                        title={`${p.user?.name || 'Someone'} — click to jump to their view`}
                        onClick={() => onJumpToPeer?.(p.location)}>
                  <Avatar name={p.user?.name || '?'} color={p.user?.color || '#4f8df8'} size={26} />
                </button>
              ))}
              {peersOnCard.length > 4 && (
                <span className="doc-card-peers-overflow">+{peersOnCard.length - 4}</span>
              )}
            </div>
          )}
          {/* Mode toggles — hidden on public: side mode's dock layout
              assumes the workspace topbar, and the public viewer always
              opens fullscreen. */}
          {isPublic ? null : mode === 'full' ? (
            <button className="doc-card-icon" title="Dock to side (split with canvas)"
                    aria-label="Dock to side"
                    onClick={() => onSetMode('side')}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2.5" y="3" width="15" height="14" rx="1.6" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M11 3 V17" stroke="currentColor" strokeWidth="1.4"/>
                <rect x="11.5" y="3.5" width="5.5" height="13" fill="currentColor" opacity=".18"/>
              </svg>
            </button>
          ) : (
            <button className="doc-card-icon" title="Open fullscreen"
                    aria-label="Open fullscreen"
                    onClick={() => onSetMode('full')}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7 V3 H7 M17 7 V3 H13 M3 13 V17 H7 M17 13 V17 H13" />
              </svg>
            </button>
          )}
          <button className="doc-card-close" title="Close (Esc)" aria-label="Close document" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M5 5 L13 13 M13 5 L5 13" />
            </svg>
          </button>
        </div>
        <div className="doc-card-modal-body">
          <Suspense fallback={<div className="doc-surface-skeleton" aria-hidden="true" />}>
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
            peersOnBoard={peersOnCard}
            onJumpToPeer={onJumpToPeer}
            canEdit={canEdit}
            isPublic={isPublic}
          />
          </Suspense>
        </div>
      </div>
    </>
  );
}
