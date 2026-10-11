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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DOCK, canDock, clampWidth, dragPreview, releaseDock } from '../lib/filesDock.js';
import { getActivePane, setActivePane, subscribeActivePane } from '../lib/activePane.js';
import { ancestorPath } from '../lib/boardTree.js';
import { onBoardIndex, fileKeyOf } from '../lib/filesDrag.js';
import { useBoardPreview } from '../hooks/useBoardPreview.js';
import { onDragSession } from '../lib/springLoad.js';

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

  // Layout effect: the first measurement lands before the first paint, so the
  // panel opens at its stored width instead of flashing at the minimum.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const report = (w) => {
      setPaneW(w);
      const room = canDock(w, { mobileShell });
      if (room !== roomRef.current) { roomRef.current = room; onRoomChange?.(room); }
    };
    report(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
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

  // Files claims the keyboard while the pointer is over it: as its own 'files'
  // pane beside the board, as the pane itself when full. Keep the claim with
  // Files as it changes size, and hand it back when the panel goes away — or
  // the board would ignore its own keys until the pointer crossed it again.
  const prevModeRef = useRef(mode);
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (mode !== 'panel' && getActivePane() === 'files') setActivePane('main');
    else if (mode === 'panel' && prev === 'full' && getActivePane() === 'main') setActivePane('files');
  }, [mode]);

  // A divider drag in progress, so anything that ends it early — the panel
  // closing under it (F), capture lost, unmount — can tear it down.
  const dragEndRef = useRef(null);
  useEffect(() => {
    if (mode !== 'panel') dragEndRef.current?.();
  }, [mode]);
  useEffect(() => () => dragEndRef.current?.(), []);

  const panelW = drag ? drag.w : clampWidth(width, paneW);

  // Which side has the keyboard, for the styles: the other side's selection
  // shows in ink rather than gold (styles.css, "Two panes, one keyboard").
  const [activePane, setActivePaneState] = useState(() => getActivePane());
  useEffect(() => subscribeActivePane(setActivePaneState), []);

  // Toasts stack top-right. While the panel is docked against the window's
  // right edge they'd sit on its ⤢ and ×, so publish its width for
  // .toast-stack to move over by (styles.css). Cleared whenever it isn't.
  const filesRef = useRef(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const r = mode === 'panel' ? filesRef.current?.getBoundingClientRect?.() : null;
    if (r && window.innerWidth - r.right < 24) root.style.setProperty('--files-dock-w', `${Math.round(r.width)}px`);
    else root.style.removeProperty('--files-dock-w');
  }, [mode, panelW, paneW]);
  useEffect(() => () => document.documentElement.style.removeProperty('--files-dock-w'), []);

  const onDividerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const startX = e.clientX;
    const startW = panelW;
    let moved = false;
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    document.body.classList.add('fdl-resizing');
    // Width follows the pointer from where it grabbed, so grabbing either side
    // of the 7px divider doesn't jump the panel.
    const widthAt = (clientX) => Math.min(Math.max(startW + (startX - clientX), 0), paneW);
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) < DOCK.CLICK_SLOP) return;
      moved = true;
      const w = widthAt(ev.clientX);
      setDrag({ w, preview: dragPreview(w, paneW) });
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('lostpointercapture', end);
      document.body.classList.remove('fdl-resizing');
      // Anything that waited out the drag (a big grid) lays out once, now.
      try { window.dispatchEvent(new Event('fdl-resize-end')); } catch (_) {}
      dragEndRef.current = null;
      setDrag(null);
    };
    // Only a real drag commits; a click (or the first click of the reset
    // double-click) leaves the panel as it was.
    const up = (ev) => {
      const w = widthAt(ev.clientX);
      const wasDrag = moved;
      end();
      if (!wasDrag) return;
      const res = releaseDock(w, paneW);
      if (res.action === 'expand') onExpand?.();
      else if (res.action === 'close') onClose?.();
      else onResize?.(res.width);
    };
    dragEndRef.current = end;
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  };

  const widest = clampWidth(Number.MAX_SAFE_INTEGER, paneW);
  const onDividerKey = (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); onResize?.(clampWidth(panelW + DOCK.KEY_STEP, paneW)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); onResize?.(clampWidth(panelW - DOCK.KEY_STEP, paneW)); }
    else if (e.key === 'Home') { e.preventDefault(); onResize?.(DOCK.MIN); }
    else if (e.key === 'End') { e.preventDefault(); onResize?.(widest); }
    else if (e.key === 'Enter') { e.preventDefault(); onExpand?.(); }
  };

  // Opening beside the board slides the panel in (from off only — not when
  // full Files shrinks to it); the styles skip it under reduced motion.
  const [entering, setEntering] = useState(false);
  const lastModeRef = useRef(mode);
  useLayoutEffect(() => {
    const prev = lastModeRef.current;
    lastModeRef.current = mode;
    if (mode !== 'panel' || prev !== 'off') return undefined;
    setEntering(true);
    const t = setTimeout(() => setEntering(false), 240);
    // Expanding inside the slide must not carry the class into full Files.
    return () => { clearTimeout(t); setEntering(false); };
  }, [mode]);

  return (
    <div className={`fdl fdl-${mode}${drag?.preview === 'close' ? ' is-closing' : ''}`} ref={rootRef}
         data-active-pane={mode === 'panel' ? activePane : undefined}>
      <div className="fdl-canvas">{canvas}</div>
      {mode === 'panel' ? (
        <div className={`fdl-divider${drag ? ' is-dragging' : ''}`}
             role="separator" aria-orientation="vertical" aria-label="Resize Files"
             aria-valuenow={Math.round(panelW)} aria-valuemin={DOCK.MIN} aria-valuemax={widest} tabIndex={0}
             title="Drag to resize · drag all the way to fill the screen · double-click to reset"
             onPointerDown={onDividerDown}
             onDoubleClick={() => onResize?.(DOCK.DEFAULT)}
             onKeyDown={onDividerKey}>
          <span className="fdl-grip" aria-hidden="true" />
        </div>
      ) : null}
      <div className={`fdl-files${entering ? ' is-entering' : ''}`} ref={filesRef} style={mode === 'panel' ? { width: panelW } : undefined}>{files}</div>
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
// the board's own cluster stays live. In full Files opening a folder navigates
// the app, staying in Files — except mid-drag, when a held drag springs into
// folders here without moving the app, so the files keep their live board.
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
  revealRequest = null, // { ids, token } — show files of the home cluster
}) {
  const homeId = home?.id || null;
  const [hist, setHist] = useState(() => [homeId]);
  // A new home (the board navigated) starts the panel over from there — and
  // so does a request to show one of its files.
  useEffect(() => { setHist([homeId]); }, [homeId]);
  useEffect(() => { if (revealRequest?.token) setHist([homeId]); }, [revealRequest?.token]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Spring-loading (lib/springLoad.js): holding a drag over a folder, Back or a
  // path step browses there mid-drag. Full Files browses too while a drag has
  // sprung (otherwise it navigates the app, which would swap the dragged
  // files' own board out from under the drop).
  const [springing, setSpringing] = useState(false);
  const top = hist[hist.length - 1];
  const browseId = (mode === 'panel' || springing) && top && boards?.[top] ? top : homeId;
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

  // The drag that sprang ends: a cancel goes back to where it started; a drop
  // that moved something leaves you where it landed — beside the board the
  // panel just stays, full Files opens that cluster once the move is saved
  // (navigating sooner would tear down the board the files came from).
  const stateRef = useRef(null);
  stateRef.current = { hist, mode, homeId, springing, browseId };
  const startHistRef = useRef(null);
  const pendingRef = useRef(null);
  const openRef = useRef(onOpenInFiles);
  openRef.current = onOpenInFiles;
  useEffect(() => onDragSession((e) => {
    const st = stateRef.current;
    if (e.type === 'start') { startHistRef.current = st.hist; pendingRef.current = null; return; }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!st.springing) return;
    const snapBack = () => { setHist(startHistRef.current || [st.homeId]); setSpringing(false); };
    if (!e.dropped) { snapBack(); return; }
    if (st.mode === 'panel') { setSpringing(false); return; }
    if (!pending) { snapBack(); return; }
    const where = st.browseId;
    pending.then(
      (ok) => {
        if (ok && where && where !== st.homeId) { setSpringing(false); openRef.current?.(where); }
        else snapBack();
      },
      () => snapBack(),
    );
  }), []);
  const spring = {
    into: (id) => { if (!id || !boards?.[id]) return; setSpringing(true); go(id); },
    back: () => { setSpringing(true); back(); },
    // A drop in the place sprung to hands over its move (a promise of whether
    // anything moved), so full Files knows when it's safe to go there.
    drop: (promise) => { pendingRef.current = Promise.resolve(promise); },
  };

  const browseOverrides = browsing ? {
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
    // Its snapshot is still on the way: not "no files" yet.
    loading: !cardsFor && preview == null,
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
  } : {};

  if (mode !== 'panel') {
    // Full Files: where you are, above the title — its ancestors to hold a
    // drag over (or click, which opens them), and Back once a drag has sprung.
    return render({
      onOpenBoard: (id) => (springing ? spring.into(id) : onOpenInFiles?.(id)),
      revealRequest: browsing ? null : revealRequest,
      spring,
      fullPathBar: {
        path: ancestorPath(boards, browseId),
        boards,
        onNavigate: (id) => (springing ? go(id) : onOpenInFiles?.(id)),
        onBack: back,
        canBack: springing && hist.length > 1,
        onSpringBack: spring.back,
        onSpringTo: spring.into,
        trail: true,
      },
      ...browseOverrides,
    });
  }

  const pathBar = {
    path: ancestorPath(boards, browseId),
    boards,
    onNavigate: go,
    onBack: back,
    canBack: hist.length > 1,
    onSpringBack: spring.back,
    onSpringTo: spring.into,
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
    spring,
    dockControls: controls,
    onLocateOnBoard: onLocate,
    revealRequest: browsing ? null : revealRequest,
    ...browseOverrides,
  });
}
