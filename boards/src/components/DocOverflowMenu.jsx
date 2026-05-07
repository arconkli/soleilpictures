// `⋯` menu in the doc-card modal head. Holds the global actions
// that don't deserve to be in the (no-longer-existing) top toolbar:
// dock-side / fullscreen, find & replace, export, undo / redo.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { MoreHorizontal } from '../lib/icons.js';

export function DocOverflowMenu({
  // Mode-toggle handlers (DocCardOverlay supplies them).
  mode,                  // 'side' | 'full'
  onToggleSide,
  onToggleFullscreen,
  // Editor + global actions.
  editor,
  onOpenFind,
  onOpenExport,
}) {
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = 220;
    setPos({
      left: Math.max(8, Math.min(window.innerWidth - W - 8, r.right - W)),
      top:  r.bottom + 6,
    });
    setOpen(true);
  };

  return (
    <>
      <button ref={btnRef}
              className="doc-card-icon"
              title="More"
              aria-label="More actions"
              onClick={() => (open ? setOpen(false) : openMenu())}>
        <Icon as={MoreHorizontal} size={16} />
      </button>
      {open && pos && createPortal(
        <div ref={popRef}
             className="doc-overflow-pop"
             role="menu"
             style={{ left: pos.left, top: pos.top }}>
          {onToggleSide && mode !== 'side' && (
            <button className="doc-overflow-item" onClick={() => { setOpen(false); onToggleSide(); }}>
              <span>Dock to side</span>
            </button>
          )}
          {onToggleFullscreen && mode !== 'full' && (
            <button className="doc-overflow-item" onClick={() => { setOpen(false); onToggleFullscreen(); }}>
              <span>Fullscreen</span>
            </button>
          )}
          {(onToggleSide || onToggleFullscreen) && <div className="doc-overflow-divider" />}
          {onOpenFind && (
            <button className="doc-overflow-item" onClick={() => { setOpen(false); onOpenFind(); }}>
              <span>Find &amp; replace</span>
              <span className="doc-overflow-item-shortcut">⌘F</span>
            </button>
          )}
          {onOpenExport && (
            <button className="doc-overflow-item" onClick={() => { setOpen(false); onOpenExport(); }}>
              <span>Export…</span>
            </button>
          )}
          <div className="doc-overflow-divider" />
          <button className="doc-overflow-item"
                  disabled={!editor?.can?.()?.undo?.()}
                  onClick={() => { setOpen(false); editor?.chain().focus().undo().run(); }}>
            <span>Undo</span>
            <span className="doc-overflow-item-shortcut">⌘Z</span>
          </button>
          <button className="doc-overflow-item"
                  disabled={!editor?.can?.()?.redo?.()}
                  onClick={() => { setOpen(false); editor?.chain().focus().redo().run(); }}>
            <span>Redo</span>
            <span className="doc-overflow-item-shortcut">⌘⇧Z</span>
          </button>
        </div>,
        document.body
      )}
    </>
  );
}
