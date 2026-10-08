// Files beside the board — one view, two sizes (lib/filesDock.js).
//
// FilesDockLayout lays out a board pane as [board][divider][Files]. The three
// children always sit in the same positions, so React keeps each mounted across
// mode changes: the board survives off ↔ panel (its camera, selection and tool
// stay put while Files opens beside it) and Files survives panel ↔ full (its
// search, sort, selection and scroll come along when it expands). In full mode
// the board child is null — unmounted, exactly as the full Files view always
// was; its camera is restored from lib/boardViewState when it comes back.
//
// The divider resizes the panel; dragging it far enough expands Files to fill
// the pane, narrow enough closes it (releaseDock). It is a focusable separator:
// ←/→ resize, Enter expands, double-click resets the width.

import { useEffect, useMemo, useRef, useState } from 'react';
import { DOCK, canDock, clampWidth, dragPreview, releaseDock } from '../lib/filesDock.js';
import { getActivePane, setActivePane } from '../lib/activePane.js';
import { ancestorPath } from '../lib/boardTree.js';
import { onBoardIndex, fileKeyOf } from '../lib/filesDrag.js';
import { useBoardPreview } from '../hooks/useBoardPreview.js';

export function FilesDockLayout({
  mode,                 // 'off' | 'panel' | 'full'
  width,                // stored panel width (px)
  onResize,             // (px) => void
  onExpand,             // () => void
  onClose,              // () => void
  onRoomChange,         // (bool) => void — the pane can / can't hold a panel
  mobileShell = false,
  canvas,               // the board, or null in full mode
  files,                // the Files view, or null in off mode
}) {
  const rootRef = useRef(null);
  const [paneW, setPaneW] = useState(0);
  const [drag, setDrag] = useState(null);   // { w, preview } while dragging
  const roomRef = useRef(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const report = (w) => {
      setPaneW(w);
      const room = canDock(w, { mobileShell });
      if (room !== roomRef.current) { roomRef.current = room; onRoomChange?.(room); }
    };
    report(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (Number.isFinite(w)) report(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // onRoomChange is read through the closure on purpose: a new function each
    // render must not tear down and re-create the observer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileShell]);

  // Files claims the keyboard while the pointer is over it (ListSurface sets
  // the 'files' pane). Hand it back when the panel goes away, or the board
  // would ignore its own keys until the pointer crossed it again.
  useEffect(() => {
    if (mode !== 'off') return undefined;
    if (getActivePane() === 'files') setActivePane('main');
    return undefined;
  }, [mode]);

  const panelW = drag ? drag.w : clampWidth(width, paneW);

  const widthFromPointer = (clientX) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return panelW;
    return Math.max(0, rect.right - clientX);
  };

  const onDividerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    document.body.classList.add('fdl-resizing');
    const move = (ev) => {
      const w = widthFromPointer(ev.clientX);
      setDrag({ w: Math.min(Math.max(w, 0), paneW), preview: dragPreview(w, paneW) });
    };
    const up = (ev) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      document.body.classList.remove('fdl-resizing');
      const w = widthFromPointer(ev.clientX);
      setDrag(null);
      const res = releaseDock(w, paneW);
      if (res.action === 'expand') onExpand?.();
      else if (res.action === 'close') onClose?.();
      else onResize?.(res.width);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const onDividerKey = (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); onResize?.(clampWidth(panelW + DOCK.KEY_STEP, paneW)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); onResize?.(clampWidth(panelW - DOCK.KEY_STEP, paneW)); }
    else if (e.key === 'Enter') { e.preventDefault(); onExpand?.(); }
  };

  return (
    <div className={`fdl fdl-${mode}`} ref={rootRef}>
      <div className="fdl-canvas">{canvas}</div>
      {mode === 'panel' ? (
        <div className={`fdl-divider${drag ? ' is-dragging' : ''}`}
             role="separator" aria-orientation="vertical" aria-label="Resize Files"
             aria-valuenow={Math.round(panelW)} tabIndex={0}
             title="Drag to resize · drag all the way to fill the screen · double-click to reset"
             onPointerDown={onDividerDown}
             onDoubleClick={() => onResize?.(DOCK.DEFAULT)}
             onKeyDown={onDividerKey}>
          <span className="fdl-grip" aria-hidden="true" />
        </div>
      ) : null}
      <div className="fdl-files" style={mode === 'panel' ? { width: panelW } : undefined}>{files}</div>
      {drag?.preview ? (
        <div className={`fdl-preview is-${drag.preview}`} aria-hidden="true">
          {drag.preview === 'full' ? 'Release for full-screen Files' : 'Release to close Files'}
        </div>
      ) : null}
    </div>
  );
}

// FilesPane — Files with somewhere of its own to be.
//
// Beside the board, Files browses independently: double-click a folder and the
// panel steps into it, the path bar walks back up, "Go to cluster…" jumps
// anywhere in the workspace — and the board doesn't move. Another cluster's
// files come from its saved snapshot (useBoardPreview) and are read-only here;
// the board's own cluster stays live. In full Files there is no separate
// location: opening a folder navigates the app, staying in Files.
//
// It renders the caller's ListSurface through `render(overrides)`, so the one
// ListSurface element keeps its place — and its state — across panel ↔ full.
export function FilesPane({
  mode,                 // 'panel' | 'full'
  home,                 // the board this pane belongs to
  boards,
  render,               // (overrides) => <ListSurface …/>
  dockControls = null,  // the shell's ⤢ ⤡ × (expand is redirected while browsing)
  onOpenInFiles,        // (id) => open a cluster in the app, staying in Files
  onPickCluster = null, // ({ excludeIds }) => Promise<board|null>
  onShowInCluster = null, // (boardId, cardIds) => take the board to a browsed file
  homeCards = null,     // the board's own cards — what is already on it
  onLocate = null,      // (cardId) => fly the board to one of its cards
  cardsFor = null,      // (id) => cards — the local harness's in-memory boards
}) {
  const homeId = home?.id || null;
  const [hist, setHist] = useState(() => [homeId]);
  // A new home (the board navigated) starts the panel over from there.
  useEffect(() => { setHist([homeId]); }, [homeId]);

  const top = hist[hist.length - 1];
  const browseId = mode === 'panel' && top && boards?.[top] ? top : homeId;
  const browsing = !!browseId && browseId !== homeId;
  const preview = useBoardPreview(browsing && !cardsFor ? browseId : null, browsing && !cardsFor);

  const browseCards = browsing ? ((cardsFor ? cardsFor(browseId) : preview?.cards) || []) : null;
  // Browsing another cluster: which of its files this board already shows (a
  // linked copy dropped in earlier), and the card here that shows each one.
  const hereByFile = useMemo(() => (browsing ? onBoardIndex(homeCards || []) : null), [browsing, homeCards]);
  const onBoardIds = useMemo(() => {
    if (!browseCards || !hereByFile?.size) return null;
    const ids = new Set();
    for (const c of browseCards) { const k = fileKeyOf(c); if (k && hereByFile.has(k)) ids.add(c.id); }
    return ids;
  }, [browseCards, hereByFile]);

  const childBoards = useMemo(
    () => (browsing ? Object.values(boards || {}).filter((b) => b && b.parent_board_id === browseId) : null),
    [browsing, boards, browseId]
  );

  const go = (id) => {
    if (!id) return;
    setHist((h) => (h[h.length - 1] === id ? h : [...h, id]));
  };
  const back = () => setHist((h) => (h.length > 1 ? h.slice(0, -1) : h));

  if (mode !== 'panel') {
    return render({ onOpenBoard: (id) => onOpenInFiles?.(id) });
  }

  const pathBar = {
    path: ancestorPath(boards, browseId),
    boards,
    onNavigate: go,
    onBack: back,
    canBack: hist.length > 1,
    onGoTo: onPickCluster
      ? async () => {
          const picked = await onPickCluster({ excludeIds: [browseId] });
          if (picked?.id) go(picked.id);
        }
      : null,
  };
  // Expanding while browsing another cluster takes the app there, in Files.
  const controls = dockControls && browsing
    ? { ...dockControls, onExpand: () => onOpenInFiles?.(browseId) }
    : dockControls;

  return render({
    onOpenBoard: go,
    pathBar,
    dockControls: controls,
    onLocateOnBoard: onLocate,
    ...(browsing ? {
      board: boards[browseId],
      cards: browseCards,
      onBoardIds,
      // A file with a copy here: the click finds that copy.
      onLocateOnBoard: onLocate ? (id) => {
        const c = browseCards.find((x) => x.id === id);
        const here = c ? hereByFile?.get(fileKeyOf(c)) : null;
        if (here) onLocate(here);
      } : null,
      childBoards: childBoards || [],
      canEdit: false,
      mutators: {},
      onDropFilesToCluster: undefined,
      onDropInboxItem: undefined,
      getAwareness: null,
      recentlyAddedIds: null,
      getGridModel: null,
      // The file isn't on this board: double-click shows it where it lives.
      onRevealOnCanvas: onShowInCluster ? (ids) => onShowInCluster(browseId, ids) : null,
      browsingFrom: home,
    } : {}),
  });
}
