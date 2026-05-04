// Card right-click menu — supports flat items, dividers, and nested submenus
// (item.submenu = [...]). Hover an item with a submenu to expand.
//
// Submenus render through a body portal so position:fixed actually pins to
// the viewport — the parent .ctx-menu has a CSS transform (open animation),
// which would otherwise turn it into the containing block for any fixed
// descendant and send the submenu somewhere off-screen.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function CardContextMenu({ open, x, y, items, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      const inside = e.target.closest('.ctx-menu');
      if (!inside) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  const w = 220, hEst = items.length * 30 + 8;
  const px = Math.min(x, window.innerWidth  - w  - 8);
  const py = Math.min(y, window.innerHeight - hEst - 8);

  return (
    <div className="ctx-menu" style={{ left: px, top: py }} role="menu">
      {items.map((it, i) => {
        if (it.divider) return <div key={`d-${i}`} className="ctx-divider" />;
        if (it.submenu) return <SubmenuItem key={it.id || i} item={it} onClose={onClose} />;
        return (
          <button
            key={it.id || i}
            className={`ctx-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            onClick={async () => { onClose(); it.run && await it.run(); }}
            role="menuitem"
          >
            <span className="ctx-label">{it.label}</span>
            {it.shortcut && <span className="ctx-shortcut">{it.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}

function SubmenuItem({ item, onClose }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // {left, top, maxHeight}
  const wrapRef = useRef(null);
  const closeTimerRef = useRef(null);

  const computePos = () => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const itemRect = wrap.getBoundingClientRect();
    // Submenu opens off the parent MENU's right edge (not the item's), so
    // hovering items deep into the menu doesn't cause the gap to widen and
    // the "open to the left" branch to misfire on items past the menu's
    // right edge.
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
            if (sub.swatch) {
              return (
                <button key={sub.id || j}
                        className="ctx-item ctx-swatch-row"
                        disabled={sub.disabled}
                        onClick={async () => { onClose(); sub.run && await sub.run(); }}>
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
