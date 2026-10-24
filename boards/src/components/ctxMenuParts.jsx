import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import { ChevronRight } from '../lib/icons.js';
import { shortcutAria, shortcutCaps, toolbarLook } from '../lib/looks.js';

// The parts the right-click menus share (CardContextMenu.jsx,
// BackgroundContextMenu.jsx): a row's shortcut, the › of a row that opens a
// submenu, that row and its submenu, and the keys that walk a menu. In the toolbar look (lib/looks.js; styles/toolbarLook.css) the
// shortcut is a cap per key, and the row says it to a screen reader in its
// aria-keyshortcuts rather than in its name (rowKeys); the › is the look's
// caret. Today's look keeps the words and the glyph.

export function rowKeys(written, look = toolbarLook()) {
  return look && written ? { 'aria-keyshortcuts': shortcutAria(written) } : {};
}

// The caps keep the words' "+" between them, unseen (toolbarLook.css), so
// the shortcut's text is the menu's, "Ctrl+D" as it was.
export function CtxShortcut({ keys }) {
  if (!keys) return null;
  if (!toolbarLook()) return <span className="ctx-shortcut">{keys}</span>;
  const caps = shortcutCaps(keys);
  const plus = caps.length > 1 && caps.join('+') === String(keys).trim();
  return (
    <span className="ctx-shortcut is-caps" aria-hidden="true">
      {caps.map((k, i) => (
        <Fragment key={i}>
          {plus && i > 0 && <span className="ctx-kplus">+</span>}
          <kbd>{k}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

export function CtxChevron() {
  return toolbarLook()
    ? <Icon as={ChevronRight} size={12} weight="regular" className="ctx-chevron" aria-hidden="true" />
    : <span className="ctx-chevron" aria-hidden="true">›</span>;
}

// The WAI-ARIA menu pattern's keys, for a menu's onKeyDown: ↑ ↓ walk its
// rows, round the ends, and Home and End jump. A submenu is portaled out of
// its menu's box, so its rows are its own.
export function walkMenu(e) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  // A submenu's keys reach the menu it opened from too, through the portal.
  e.stopPropagation();
  const items = Array.from(e.currentTarget.querySelectorAll('button.ctx-item:not(:disabled)'));
  if (!items.length) return;
  const idx = items.indexOf(document.activeElement);
  let next;
  if (e.key === 'Home') next = items[0];
  else if (e.key === 'End') next = items[items.length - 1];
  else if (e.key === 'ArrowDown') next = items[(idx + 1 + items.length) % items.length];
  else next = items[(idx - 1 + items.length) % items.length];
  next?.focus();
}

// A row that opens a submenu, and the submenu, portaled to <body> so its
// position: fixed escapes the menu's transform. The pointer over the row
// opens it; a tap or a click toggles it (hover alone is out of a finger's
// reach); → Enter or Space opens it with its first row focused, and ← closes
// it, back on the row.
export function CtxSubmenu({ item, onClose, claimFire = () => true }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // {left, top, maxHeight}
  // Opened from the keys: its first row takes the focus.
  const [byKey, setByKey] = useState(false);
  const wrapRef = useRef(null);
  const rowRef = useRef(null);
  const subRef = useRef(null);
  const closeTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(closeTimerRef.current), []);
  useEffect(() => {
    if (open && byKey) subRef.current?.querySelector('button.ctx-item:not(:disabled)')?.focus();
  }, [open, byKey]);

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

  const show = (keys = false) => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    setPos(computePos());
    setOpen(true);
    setByKey(keys);
  };
  // The pointer coming back over it keeps a submenu the keys opened as it is.
  const hover = () => show(open && byKey);
  const handleLeave = () => {
    closeTimerRef.current = setTimeout(() => setOpen(false), 140);
  };
  const onRowKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    show(true);
  };
  const onSubKey = (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      rowRef.current?.focus();
      return;
    }
    walkMenu(e);
  };
  const choose = (sub) => { if (!claimFire()) return; onClose(); sub.run && sub.run(); };

  return (
    <div ref={wrapRef} className="ctx-submenu-wrap" onMouseEnter={hover} onMouseLeave={handleLeave}>
      <button ref={rowRef} className={`ctx-item ctx-has-submenu ${item.danger ? 'danger' : ''}`} disabled={item.disabled}
              role="menuitem" aria-haspopup="menu" aria-expanded={open}
              onKeyDown={onRowKey}
              onClick={() => { if (open) setOpen(false); else show(); }}>
        <span className="ctx-label">{item.label}</span>
        <CtxChevron />
      </button>
      {open && pos && createPortal(
        <div ref={subRef} className="ctx-menu ctx-submenu is-scrollable"
             role="menu" aria-label={item.label}
             style={{ position: 'fixed', left: pos.left, top: pos.top, maxHeight: pos.maxHeight, overflowY: 'auto' }}
             onKeyDown={onSubKey}
             onMouseEnter={hover}
             onMouseLeave={handleLeave}>
          {item.submenu.map((sub, j) => {
            if (sub.divider) return <div key={`sd-${j}`} className="ctx-divider" />;
            if (sub.header) return <div key={`sh-${j}`} className="ctx-header" aria-hidden="true">{sub.header}</div>;
            if (sub.swatch) {
              return (
                <button key={sub.id || j}
                        className="ctx-item ctx-swatch-row"
                        role="menuitem"
                        disabled={sub.disabled}
                        onClick={() => choose(sub)}>
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
                      role="menuitem"
                      disabled={sub.disabled}
                      {...rowKeys(sub.shortcut)}
                      onClick={() => choose(sub)}>
                <span className="ctx-label">{sub.label}</span>
                <CtxShortcut keys={sub.shortcut} />
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
