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
import { cardScope, readDocSummary, initCardDocStore, followTitle } from '../lib/docState.js';
import { readDocOpenMode, writeDocOpenMode } from '../lib/docOpenMode.js';
import { RELOAD_EVENT, noteReopen, reopenMode, clearReopen } from '../lib/docResets.js';
import { isEditableTarget } from '../lib/isEditableTarget.js';
import { registerModalOpen } from '../lib/modalGuard.js';
import { lazyWithReload } from '../lib/lazyWithReload.js';
import { SurfaceErrorBoundary } from './SurfaceErrorBoundary.jsx';
import { DocOpening } from './DocOpening.jsx';
import { Avatar } from './primitives.jsx';
import { useMessagesUi } from '../hooks/useOpenDm.js';
import { EditableText } from './EditableText.jsx';
import { FileShareButton } from './fileShare/FileShareButton.jsx';
import { docSharesAllowed } from '../lib/appHost.js';
import { isShareableDoc } from '../lib/fileShares.js';

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

// How many doc-card overlays are currently mounted — drives the
// body[data-doc-overlay] flag (see DocCardOverlay's presence effect).
let openOverlayCount = 0;

// Fired by whichever card is opening so every OTHER open card closes itself.
// Two overlays can be alive at once (side mode leaves the canvas live, so a
// second card can open before the first unmounts) and in side mode they dock
// to the same coordinates — the newer one would simply bury the older. One
// doc is open at a time; opening the next hands it the layout.
const OPEN_EVENT = 'soleil-doccard-open';

const NO_SUMMARY = { pages: [], firstText: '', firstPageName: '' };

// The closed card's preview: the first page's name and opening text, and the
// page count. It keeps itself fresh, observing this card's own doc store
// (rAF-coalesced, so a burst of edits refreshes it once) — this used to be
// state on the card, so every keystroke in the open doc re-rendered the card
// and, with it, the whole open doc in its overlay. `children` draws it.
function DocCardSummary({ ydoc, cardYMap, scope, children }) {
  const [, setRev] = useState(0);
  useEffect(() => {
    if (!ydoc || !cardYMap) return;
    const sc = cardScope(cardYMap);
    const targets = [sc.content, sc.pages, sc.sheetContent].filter(Boolean);
    if (!targets.length) return;
    let raf = 0;
    const bump = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; setRev((n) => n + 1); });
    };
    targets.forEach((t) => t.observeDeep(bump));
    return () => {
      targets.forEach((t) => t.unobserveDeep(bump));
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ydoc, cardYMap]);
  // A generous slice of the first page, so the preview fills the card with
  // prose (600 chars ≈ a paragraph-and-a-half at the preview's size).
  return children((ydoc && scope?.pages) ? readDocSummary(ydoc, 600, scope) : NO_SUMMARY);
}

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
  // Hand the dock off to the workspace. When present, "open beside" hoists the
  // doc into App's split pane instead of portaling an overlay from here — the
  // overlay lives inside the canvas, so navigating to another cluster unmounted
  // the card and the dock vanished, which is the exact opposite of what side
  // mode is for. The split pane keeps this board's Y.Doc alive on its own.
  // Absent (the ?docqa harness, the public /share viewer) → the original
  // self-hosted overlay, unchanged.
  onDock = null,
  // True when THIS card is the one currently docked in the split pane.
  isDocked = false,
  // Set while ANOTHER doc is docked: opening this one (a double-click, a double
  // tap, a jump to it) puts it beside the docked one, in the board's place, so
  // two docs can be read at once (lib/docPanes.js). The buttons on the card
  // keep their own meaning: the dock button swaps what is docked.
  onOpenBeside = null,
  // The cluster this card sits on. The doc scope carries it as `boardId`:
  // comment @-mention notifications, doc tagging and the save footer are all
  // keyed by the HOST board, and without it they silently did nothing.
  hostBoardId = null,
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
  //
  // MUST be memoized: cardScope() returns a fresh object literal, and an
  // unstable `scope` identity makes every downstream effect that deps on it
  // re-run each render. That silently broke the doc_page_index sync — its 2s
  // debounce was cleared on every re-render before it could ever fire, so
  // NO doc ever got indexed (which also starved candidate-name detection,
  // "Appears in docs", and doc tag-search). cardYMap (= a stable Yjs map
  // child) + card.id are stable, and cardScope only reads stable Y-type refs.
  const scope = useMemo(
    () => (cardYMap ? { ...cardScope(cardYMap), cardId: card.id, docCardId: card.id, boardId: hostBoardId || null } : null),
    [cardYMap, card.id, hostBoardId],
  );
  // New docs no longer auto-open their full editor — autoFocus now means
  // "focus the title for renaming," letting the user rename + place the
  // card on the canvas first. The full editor opens on double-click,
  // explicit Open buttons, or peer-jump events. A card back from its
  // cluster's reload under it (a restore, cards moved in) opens as it was
  // before it went: the reload takes the card away, and it comes back closed
  // (lib/docResets.js; noted below).
  const [mode, setMode] = useState(() => reopenMode(card.id) || 'closed'); // 'closed' | 'full' | 'side'
  useEffect(() => { clearReopen(card.id); }, [card.id]);
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

  // Public viewers can open docs too — read-only, and always FULLSCREEN
  // (side mode's dock layout assumes the workspace topbar, and the dock
  // affordance is pointless on the chromeless /share surface).
  //
  // Opening also REMEMBERS the layout (lib/docOpenMode.js) and evicts any
  // other open doc. Fullscreen-vs-docked is how this person is working right
  // now, not a property of one card: without the memory, someone reading
  // docked lost the dock the moment they opened the next doc, because the
  // mode was per-card local state that always started at 'full'.
  const open = (m) => {
    const next = isPublic ? 'full' : m;
    if (!isPublic) writeDocOpenMode(next);
    try { document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { cardId: card.id } })); } catch (_) {}
    // Docking is the workspace's business when it offered to take it.
    if (next === 'side' && onDock) { setMode('closed'); onDock({ cardId: card.id }); return; }
    setMode(next);
  };
  // What a plain double-click (or a peer jump) should do — the layout the user
  // last chose, falling back to fullscreen for anyone who has never docked.
  // With another doc docked, beside it. Read through a ref: the open-event
  // listener below outlives the render that made it, and a doc docked after
  // this card mounted must still count.
  const onOpenBesideRef = useRef(onOpenBeside);
  onOpenBesideRef.current = isPublic ? null : onOpenBeside;
  const openRemembered = () => {
    const beside = onOpenBesideRef.current;
    if (!beside) { open(isPublic ? 'full' : readDocOpenMode()); return; }
    // One overlay doc at a time still: a doc this canvas has open goes.
    try { document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { cardId: card.id } })); } catch (_) {}
    beside({ cardId: card.id });
  };

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
    // Flush the last ~250ms of typing synchronously on the close ACTION (App's
    // soleil-doccard-unmount handler calls yboard.flushNow) rather than relying
    // solely on the overlay's later unmount-effect — so closing then
    // immediately leaving the tab can't drop the tail of an edit.
    try { document.dispatchEvent(new CustomEvent('soleil-doccard-unmount', { detail: { cardId: card.id } })); } catch (_) {}
    setMode('closed');
  };

  // Listen for jump-to-this-doc-card events. App.jumpToPeer fires these
  // after navigating to the host board; whichever RichDocCard matches the
  // cardId pops itself open (in the remembered layout) and primes
  // pendingScroll so the inner DocSurface switches to the peer's page +
  // scrolls to their exact spot. pendingScroll carries pageId so an
  // already-open card can also switch pages on click — not just scroll.
  useEffect(() => {
    const onOpen = (e) => {
      const { cardId, pageId, scrollTop } = e.detail || {};
      if (cardId !== card.id) return;
      if (pageId) {
        try { localStorage.setItem(`soleil.boards.docActivePage.${card.id}`, pageId); } catch (_) {}
      }
      // Beside the docked doc, the workspace hosts it: the page above is where
      // it opens, and this card's own overlay has nothing to scroll.
      if (!onOpenBesideRef.current) setPendingScroll({ boardId: card.id, pageId: pageId || null, scrollTop: scrollTop || 0 });
      openRemembered();
    };
    document.addEventListener('soleil-open-doc-card', onOpen);
    return () => document.removeEventListener('soleil-open-doc-card', onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, isPublic]);

  // One doc open at a time — see OPEN_EVENT. Closing (rather than merely
  // hiding) is deliberate: close() flushes the tail of any in-flight edit
  // before the overlay goes away.
  // The flush dispatch reads the CURRENT mode through a ref rather than riding
  // inside a setMode updater: updaters must be pure, and React invokes them
  // twice under StrictMode — which would have fired two flushes per eviction.
  const modeRef = useRef(mode);
  // Closed (or handed to the dock) while its cluster reloads: it stays so.
  useEffect(() => { modeRef.current = mode; if (mode === 'closed') clearReopen(card.id); }, [mode]);
  useEffect(() => {
    if (!hostBoardId) return undefined;
    const onReload = (e) => {
      if (e.detail?.boardId === hostBoardId) noteReopen(card.id, modeRef.current);
    };
    window.addEventListener(RELOAD_EVENT, onReload);
    return () => window.removeEventListener(RELOAD_EVENT, onReload);
  }, [card.id, hostBoardId]);
  useEffect(() => {
    const onOtherOpen = (e) => {
      if (e.detail?.cardId === card.id) return;
      if (modeRef.current === 'closed') return;
      close();
    };
    document.addEventListener(OPEN_EVENT, onOtherOpen);
    return () => document.removeEventListener(OPEN_EVENT, onOtherOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // A dblclick a finger made is the canvas's to answer (CanvasSurface
  // onCardDoubleClick, from its own double tap): it waits for both taps on this
  // card, where the browser pairs a tap anywhere with the next one — the tap
  // that placed the doc and the first tap on it read as a double-click.
  const lastPointerRef = useRef('mouse');

  return (
    <>
      <div className="doc-card"
           onDoubleClick={(e) => {
             e.stopPropagation();
             if (lastPointerRef.current === 'touch') return;
             openRemembered();
           }}
           onPointerDown={(e) => {
             lastPointerRef.current = e.pointerType || 'mouse';
             if (isPublic) onPublicPointerDown(e);
           }}>
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
            onChange={(v) => {
              if (!onUpdate) return;
              const next = v || null;
              // The first page follows the title while it tracks it — the open
              // doc does this, and a card renamed before its first open (a
              // dropped script) must too. One canvas step for both.
              if (ydoc && scope && next) {
                ydoc.transact(() => {
                  try { followTitle(ydoc, scope, card.title || '', next); } catch (_) {}
                  onUpdate({ title: next });
                }, 'local');
              } else {
                onUpdate({ title: next });
              }
            }}
          />
        )}
        <DocCardSummary ydoc={ydoc} cardYMap={cardYMap} scope={scope}>
          {(summary) => (<>
            <div className="doc-card-page">
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
                {summary.pages.length > 0 ? `${summary.pages.length} ${summary.pages.length === 1 ? 'page' : 'pages'}` : 'no pages'}
              </span>
              {/* Gold marks the active state (house rule) — while this doc holds
                  the side pane, its own button says so. */}
              <button className={`doc-card-open${isDocked ? ' is-active' : ''}`}
                      title={isDocked ? 'Docked beside the canvas' : 'Open beside (dock to right)'}
                      aria-label="Open beside"
                      aria-pressed={isDocked || undefined}
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
          </>)}
        </DocCardSummary>
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
          /* The header's dock/maximize toggles are the clearest possible
             statement of preference, so they record it too — and "dock to
             side" hands off to the workspace on the same terms as `open`. */
          onSetMode={(m) => {
            if (!isPublic) writeDocOpenMode(m);
            if (m === 'side' && onDock) { setMode('closed'); onDock({ cardId: card.id }); return; }
            setMode(m);
          }}
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

// The docked doc, hosted by the workspace instead of by the canvas card.
//
// App renders this in the split pane against splitYb — the second Y.Doc the
// pane already keeps alive — so moving the LEFT side to another cluster no
// longer tears the doc down. Everything doc-shaped (the Y scope, the peer
// filter, the mount/presence lifecycle) stays in this file; App only supplies
// the board's ydoc and the card.
//
// `full` lifts the same doc to the fullscreen overlay without releasing the
// pane, which is what keeps its board loaded.
export function DockedDocPane({
  card, ydoc, cardYMap, workspaceId, userId, currentUser, getAwareness,
  boards = {}, wsPeers = [], onJumpToPeer, canEdit = true,
  onUpdate, onClose, full = false, onSetFull,
  hostBoardId = null, // the cluster the card lives on — see RichDocCard
  // Which pane of the workspace it takes (lib/docPanes.js): 'split' docked,
  // 'beside' opened next to the docked one, in the board's place.
  pane = 'split',
}) {
  if (cardYMap) initCardDocStore(ydoc, cardYMap);
  const scope = useMemo(
    () => (cardYMap ? { ...cardScope(cardYMap), cardId: card.id, docCardId: card.id, boardId: hostBoardId || null } : null),
    [cardYMap, card.id, hostBoardId],
  );
  const peersOnCard = useMemo(() => (wsPeers || []).filter(p =>
    p?.location?.docCardId === card.id && p?.user?.id !== currentUser?.id
  ), [wsPeers, card.id, currentUser?.id]);
  const body = (
    <DocCardOverlay
      mode={full ? 'full' : 'side'}
      variant={full ? 'overlay' : 'pane'}
      sideRatio={DEFAULT_SIDE_RATIO}
      card={card}
      ydoc={ydoc}
      scope={scope}
      workspaceId={workspaceId}
      userId={userId}
      currentUser={currentUser}
      getAwareness={getAwareness}
      boards={boards}
      onUpdate={onUpdate}
      onSetMode={(m) => { writeDocOpenMode(m); onSetFull?.(m === 'full'); }}
      onClose={onClose}
      peersOnCard={peersOnCard}
      onJumpToPeer={onJumpToPeer}
      canEdit={canEdit}
      pane={full ? null : pane} />
  );
  // Fullscreen still portals to <body> so it clears the pane and the topbar;
  // the pane variant renders in flow, sized by the split divider.
  return full ? createPortal(body, document.body) : body;
}

// Exported because App renders it too. See the `variant` prop: when the dock
// lives in the workspace's split pane it is laid out BY that pane, not by a
// fixed-position overlay.
export function DocCardOverlay({
  mode, sideRatio, card, ydoc, scope, workspaceId, userId, currentUser,
  getAwareness, boards, onUpdate, onSetMode, onClose, onDividerDown,
  pendingScroll, onPendingScrollConsumed,
  peersOnCard = [], onJumpToPeer,
  canEdit = true,
  isPublic = false,
  // 'overlay' — fixed-position, portaled to <body> (fullscreen, and the
  //   legacy self-hosted dock the QA harness / public viewer still use).
  // 'pane'   — rendered in flow inside the split pane, which owns the width
  //   and supplies the resize divider. No inset, no scrim, no divider here.
  variant = 'overlay',
  // The workspace pane the doc sits in (lib/activePane.js), for its ⌘Z; null
  // when it covers them all.
  pane = null,
}) {
  const inPane = variant === 'pane';
  // Esc closes from either mode — but never while typing: Escape inside the
  // title input / editor / a mention popover belongs to that control, and
  // closing the whole overlay mid-edit was how doc text got "lost".
  //
  // Not in a pane: there the doc is a persistent half of the workspace, like
  // a split cluster, and nothing else in the workspace closes on a stray Esc
  // pressed over the canvas. The × in the pane's bar is the way out.
  //
  // Fullscreen covers the canvas, so it is a layer like any dialog
  // (lib/modalGuard): the canvas's window shortcuts stand down while it is up
  // (Backspace on a header button deleted the selected cards behind it, this
  // doc's own card among them), and Escape comes to it through the layer
  // stack. The canvas's Escape (clear the selection) used to take the key
  // first, so the doc stayed open. A menu inside the doc claims its own
  // Escape, so one press closes one layer.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isFull = mode === 'full';
  useEffect(() => {
    if (inPane || !isFull) return undefined;
    return registerModalOpen({
      onEscape: (e) => {
        if (isEditableTarget(e)) return false;
        onCloseRef.current?.();
        return true;
      },
    });
  }, [inPane, isFull]);
  useEffect(() => {
    if (inPane || isFull) return;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (isEditableTarget(e)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, inPane, isFull]);

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
    // Body flag so CSS can lift the (body-portaled) messages panel above this
    // overlay while it's up — and only while it's up, so the panel still sits
    // below ordinary modals the rest of the time. Refcounted: side mode leaves
    // the canvas live, so a second card can open before the first unmounts.
    openOverlayCount += 1;
    document.body.setAttribute('data-doc-overlay', '1');
    return () => {
      document.dispatchEvent(new CustomEvent('soleil-doccard-unmount', { detail: { cardId: card.id }}));
      openOverlayCount = Math.max(0, openOverlayCount - 1);
      if (openOverlayCount === 0) document.body.removeAttribute('data-doc-overlay');
    };
  }, [card.id]);
  const emitPage = (pageId) => {
    document.dispatchEvent(new CustomEvent('soleil-doccard-page', { detail: { cardId: card.id, pageId }}));
  };
  const emitScroll = (scrollTop) => {
    document.dispatchEvent(new CustomEvent('soleil-doccard-scroll', { detail: { cardId: card.id, scrollTop }}));
  };

  const isSide = mode === 'side' && !inPane;
  const widthPct = isSide ? `${Math.round(sideRatio * 100)}%` : undefined;

  return (
    <>
      {/* Side-mode divider sits on the LEFT edge of the panel so users can
          drag to resize. Pointer-events stay outside the canvas drag-handlers
          because the divider itself is fixed-position above them. Top
          mirrors the panel's top (below the workspace topbar) so it doesn't
          stick up over the bar. In a pane the split divider already does this. */}
      {isSide && (
        <div className="doc-card-side-divider"
             style={{ right: widthPct, top: 42 }}
             onPointerDown={onDividerDown} />
      )}
      {/* Full mode: a scrim behind the inset modal so the 24px frame isn't a
          live canvas hit-zone (a pointerdown there used to start a pan/marquee
          behind the "fullscreen" doc). Click to close. */}
      {mode === 'full' && !inPane && (
        <div className="doc-card-modal-backdrop"
             onPointerDown={(e) => e.stopPropagation()}
             onClick={onClose} />
      )}
      <div className={`doc-card-modal doc-card-modal-${inPane ? 'pane' : mode}`}
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
          {/* Share this doc on its own, to read or edit together (held:
              docSharesAllowed). Its cluster is the scope's host board. */}
          {!isPublic && canEdit && scope?.boardId && docSharesAllowed() && isShareableDoc(card) && (
            <FileShareButton variant="doc" surface="doc" boardId={scope.boardId} cardId={card.id}
                             card={{ id: card.id, kind: 'doc', title: card.title || 'Untitled doc' }} />
          )}
          {/* Messages. Fullscreen covers the whole workspace and side mode
              docks over exactly where the panel lives, so without this the
              doc is a dead end for conversation — you had to close the
              document to answer someone. The panel itself is portaled to
              <body> above this overlay (App.jsx), so it just appears. */}
          {!isPublic && <DocCardMessagesButton />}
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
          {/* A crash stays in here (SurfaceErrorBoundary): the doc puts itself
              back, its header and the way out stay, and the canvas is left alone. */}
          <SurfaceErrorBoundary resetKey={card.id} logKind="doc" retryInPlace
                                message="This doc hit a problem." retryLabel="Reopen"
                                fallbackClassName="is-in-doc">
          <Suspense fallback={<DocOpening />}>
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
            pane={pane}
          />
          </Suspense>
          </SurfaceErrorBoundary>
        </div>
      </div>
    </>
  );
}

// Messages toggle for the doc-card header. Reads the workspace-level unread
// count straight off MessagesUiContext (it lives in App and stays subscribed
// whether or not the panel is mounted), so the badge here is the same number
// the sidebar shows. Renders nothing outside a provider — e.g. the /share
// viewer, which has no inbox.
function DocCardMessagesButton() {
  const messagesUi = useMessagesUi();
  if (!messagesUi) return null;
  const { unread = 0, open = false, toggle } = messagesUi;
  return (
    <button className={`doc-card-icon doc-card-messages${open ? ' is-active' : ''}`}
            title={unread > 0 ? `Messages (${unread} unread)` : 'Messages'}
            aria-label="Messages"
            aria-pressed={open}
            onClick={() => toggle?.()}>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor"
           strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 12a2 2 0 0 1-2 2H7l-4 3V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
      {unread > 0 && <span className="doc-card-messages-dot" aria-hidden="true" />}
    </button>
  );
}
