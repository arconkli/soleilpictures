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

import { useEffect, useRef, useState } from 'react';
import { DOCK, canDock, clampWidth, dragPreview, releaseDock } from '../lib/filesDock.js';
import { getActivePane, setActivePane } from '../lib/activePane.js';

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
