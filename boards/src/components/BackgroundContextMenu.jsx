// Background right-click menu — supports nested submenus via item.submenu = [...].
// Hover an item with a submenu to expand. Submenu is portaled to body so its
// position:fixed escapes the parent menu's transform-induced containing block.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase.js';

export function BackgroundContextMenu({ open, x, y, items, onClose, workspaceId, boardId, boardName }) {
  // Combined count from BOTH manual entity_links targeting the board
  // AND text occurrences of the board's name across the workspace.
  const [refCount, setRefCount] = useState(null);

  useEffect(() => {
    if (!supabase || !workspaceId || !boardId) return;
    let cancelled = false;
    (async () => {
      let n = 0;
      try {
        const { count } = await supabase.from('entity_links')
          .select('*', { count: 'exact', head: true })
          .eq('target_kind', 'board')
          .eq('target_board_id', boardId);
        n += count || 0;
      } catch (_) {}
      const term = (boardName || '').trim();
      if (term && term.length >= 4) {
        try {
          const { data } = await supabase.rpc('get_entity_mentions', {
            p_term: term, p_workspace: workspaceId, p_limit: 1,
          });
          n += (data?.total_appears || 0);
        } catch (_) {}
      }
      if (!cancelled) setRefCount(n);
    })();
    return () => { cancelled = true; };
  }, [workspaceId, boardId, boardName]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (!e.target.closest?.('.ctx-menu')) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    // Capture phase + both pointer and mouse so a card's stopPropagation can't
    // swallow the outside-tap on touch (pointerdown fires before mousedown).
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('mousedown', onDocDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('mousedown', onDocDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose]);

  if (!open) return null;
  const w = 240, hEst = items.length * 30 + 8;
  const px = Math.min(x, window.innerWidth  - w  - 8);
  const py = Math.min(y, window.innerHeight - hEst - 8);

  return (
    <div className="ctx-menu" style={{ left: px, top: py }} role="menu">
      {items.map((it, i) => {
        if (it.divider) return <div key={`d-${i}`} className="ctx-divider" />;
        if (it.header) return <div key={`h-${i}`} className="ctx-header" aria-hidden="true">{it.header}</div>;
        if (it.submenu) return <SubmenuItem key={it.id || i} item={it} onClose={onClose} />;
        return (
          <button
            key={it.id || i}
            className={`ctx-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            onClick={() => { onClose(); it.run && it.run(); }}
            role="menuitem"
          >
            <span className="ctx-label">{it.label}</span>
            {it.shortcut && <span className="ctx-shortcut">{it.shortcut}</span>}
          </button>
        );
      })}
      {boardId && (
        <>
          {items.length > 0 && items[items.length - 1].divider !== true && <div className="ctx-divider" />}
          <button className="ctx-item" onClick={() => {
            onClose();
            document.dispatchEvent(new CustomEvent('soleil-open-backlinks', {
              detail: {
                ref: { kind: 'board', id: boardId },
                name: boardName || null,
              },
            }));
          }}>
            <span className="ctx-label">
              {refCount === null ? 'Linked from…' : refCount === 0 ? 'Not linked anywhere' : `Linked from ${refCount} ${refCount === 1 ? 'place' : 'places'}`}
            </span>
          </button>
        </>
      )}
    </div>
  );
}

function SubmenuItem({ item, onClose }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);
  const closeTimerRef = useRef(null);

  const computePos = () => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const itemRect = wrap.getBoundingClientRect();
    // Submenu opens off the parent MENU's right edge — see CardContextMenu.
    const menu = wrap.closest('.ctx-menu');
    const menuRect = menu ? menu.getBoundingClientRect() : itemRect;
    const SUB_W = 204;
    const PAD = 8;
    const itemCount = item.submenu.length;
    const estH = Math.min(itemCount * 30 + 8, window.innerHeight - 2 * PAD);
    const opensOffRight = menuRect.right + SUB_W > window.innerWidth - PAD;
    const hasRoomLeft = menuRect.left - SUB_W >= PAD;
    const left = (opensOffRight && hasRoomLeft) ? menuRect.left - SUB_W - 2 : menuRect.right + 2;
    let top = itemRect.top - 4;
    if (top + estH > window.innerHeight - PAD) top = Math.max(PAD, window.innerHeight - PAD - estH);
    return { left, top, maxHeight: window.innerHeight - top - PAD };
  };

  const handleEnter = () => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    setPos(computePos());
    setOpen(true);
  };
  const handleLeave = () => {
    closeTimerRef.current = setTimeout(() => setOpen(false), 140);
  };

  return (
    <div ref={wrapRef} className="ctx-submenu-wrap" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button className={`ctx-item ctx-has-submenu ${item.danger ? 'danger' : ''}`} disabled={item.disabled}>
        <span className="ctx-label">{item.label}</span>
        <span className="ctx-chevron" aria-hidden="true">›</span>
      </button>
      {open && pos && createPortal(
        <div className="ctx-menu ctx-submenu"
             role="menu"
             style={{ position: 'fixed', left: pos.left, top: pos.top, maxHeight: pos.maxHeight, overflowY: 'auto' }}
             onMouseEnter={handleEnter}
             onMouseLeave={handleLeave}>
          {item.submenu.map((sub, j) => {
            if (sub.divider) return <div key={`sd-${j}`} className="ctx-divider" />;
            if (sub.header) return <div key={`sh-${j}`} className="ctx-header" aria-hidden="true">{sub.header}</div>;
            if (sub.swatch) {
              return (
                <button key={sub.id || j}
                        className="ctx-item ctx-swatch-row"
                        disabled={sub.disabled}
                        onClick={() => { onClose(); sub.run && sub.run(); }}>
                  <span className="ctx-swatch-dot" style={{
                    background: sub.swatch === 'transparent'
                      ? 'repeating-linear-gradient(45deg,#222 0 4px,#444 4px 8px)'
                      : sub.swatch
                  }} />
                  <span className="ctx-label">{sub.label}</span>
                </button>
              );
            }
            return (
              <button key={sub.id || j}
                      className={`ctx-item ${sub.danger ? 'danger' : ''}`}
                      disabled={sub.disabled}
                      onClick={() => { onClose(); sub.run && sub.run(); }}>
                <span className="ctx-label">{sub.label}</span>
                {sub.shortcut && <span className="ctx-shortcut">{sub.shortcut}</span>}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
