import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import HapticTap from './HapticTap.jsx';
import { haptic } from '../lib/haptics.js';
import { ChevronLeft, ChevronRight } from '../lib/icons.js';
import { shortcutAria, shortcutCaps } from '../lib/looks.js';
import { useBreakpoint } from '../hooks/useBreakpoint.js';
import { shellOf } from '../lib/deviceShell.js';

// The parts the right-click menus share (CardContextMenu.jsx,
// BackgroundContextMenu.jsx): a row's shortcut, the caret of a row that opens
// a submenu, that row and its submenu, and the keys that walk a menu. In the
// toolbar look (styles/toolbarLook.css) the shortcut is a cap per key, and the
// row says it to a screen reader in its aria-keyshortcuts rather than in its
// name (rowKeys).
//
// A phone has no room beside a menu, so there a submenu steps in instead of
// flying out (as the doc menus do, toolbar/Menu.jsx): the menu's own box swaps
// its rows for ‹ and the submenu's name, a hairline, and the submenu's rows
// (useCtxStep, CtxStepView), and ‹ (or ←, or Escape) brings the menu back.

export function rowKeys(written) {
  return written ? { 'aria-keyshortcuts': shortcutAria(written) } : {};
}

// The caps keep the words' "+" between them, unseen (toolbarLook.css), so
// the shortcut's text is the menu's, "Ctrl+D" as it was.
export function CtxShortcut({ keys }) {
  if (!keys) return null;
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

// A flyout's width, and the gap kept to the window's edge.
const SUB_W = 204;
const PAD = 8;

export function CtxChevron() {
  return <Icon as={ChevronRight} size={12} weight="regular" className="ctx-chevron" aria-hidden="true" />;
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

// A submenu's rows, in its flyout or stepped in.
function CtxSubRows({ item, choose }) {
  return item.submenu.map((sub, j) => {
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
        {sub.danger && <HapticTap />}
      </button>
    );
  });
}

// The submenu a menu has stepped into, for the menu that holds it
// (CardContextMenu, BackgroundContextMenu). `item` is that row, read from the
// menu's current items by its id so its actions are never stale; stepIn is
// what the menu hands CtxSubmenu as onStep; back() returns to the menu's own
// rows, with the focus on the row that stepped in, and says whether there was
// a step to leave (Escape goes back a level first, then closes). `top` and
// `width` are the menu's when it stepped: the stepped view takes its place.
export function useCtxStep(open, items, menuRef) {
  const [at, setAt] = useState(null); // {id, top, width, byKey, hadFocus, scrollTop, cap}
  const backTo = useRef(null);
  useEffect(() => { if (!open) { setAt(null); backTo.current = null; } }, [open]);
  const item = (open && at && items.find((it) => it && it.submenu && it.id === at.id)) || null;
  const steppedRef = useRef(false);
  steppedRef.current = !!item;
  const stepIn = (it, byKey = false) => {
    const el = menuRef.current;
    const r = el?.getBoundingClientRect();
    // scrollTop and cap: where the menu was scrolled to, and the height it
    // was held to. The stepped view reuses its box, which resets both.
    setAt({ id: it.id, top: r?.top ?? 0, width: r?.width, byKey, hadFocus: !!el && el.contains(document.activeElement),
            scrollTop: el?.scrollTop ?? 0, cap: el?.style.maxHeight ?? '' });
  };
  const back = () => {
    if (!steppedRef.current) return false;
    backTo.current = at ? { id: at.id, scrollTop: at.scrollTop, cap: at.cap } : null;
    setAt(null);
    return true;
  };
  const steppedId = item ? item.id : null;
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    if (steppedId != null) {
      // The row that stepped in is gone, and the focus with it: on the first
      // row from the keys, on ‹ from a press that had it.
      if (at?.byKey) el.querySelector('.ctx-step-body button.ctx-item:not(:disabled)')?.focus({ preventScroll: true });
      else if (at?.hadFocus) el.querySelector('button.ctx-item.is-back')?.focus({ preventScroll: true });
      return;
    }
    if (backTo.current == null) return;
    const { id, scrollTop, cap } = backTo.current;
    backTo.current = null;
    // Scrolled to where it was (under the cap it had, or the scroll clamps
    // short), so a row reached by scrolling is on screen again.
    el.style.maxHeight = cap;
    el.scrollTop = scrollTop;
    [...el.querySelectorAll('button.ctx-has-submenu')].find((b) => b.dataset.stepId === String(id))?.focus({ preventScroll: true });
  }, [steppedId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { item, top: at?.top, width: at?.width, stepIn, back };
}

// A stepped-in submenu, in its menu's box: ‹ and its name, a hairline, its
// rows. `root` names the menu ‹ goes back to ("card menu", "canvas menu").
export function CtxStepView({ item, root, onBack, onClose, claimFire = () => true }) {
  const choose = (sub) => { if (!claimFire()) return; if (sub.danger) haptic('delete'); onClose(); sub.run && sub.run(); };
  return (
    <>
      <button className="ctx-item is-back" role="menuitem"
              aria-label={`${item.label}, back to ${root}`}
              onClick={onBack}>
        <Icon as={ChevronLeft} size={20} weight="regular" className="ctx-back-chevron" aria-hidden="true" />
        <span className="ctx-label">{item.label}</span>
      </button>
      <div className="ctx-divider" role="separator" />
      <div className="ctx-step-body">
        <CtxSubRows item={item} choose={choose} />
      </div>
    </>
  );
}

// A stepped menu's keys: ← goes back; the rest walk it.
export function stepMenuKeys(step) {
  return (e) => {
    if (e.key === 'ArrowLeft' && step.back()) { e.preventDefault(); e.stopPropagation(); return; }
    walkMenu(e);
  };
}

// A row that opens a submenu, and the submenu, portaled to <body> so its
// position: fixed escapes the menu's transform. The pointer over the row
// opens it; a tap or a click toggles it (hover alone is out of a finger's
// reach); → Enter or Space opens it with its first row focused, and ← closes
// it, back on the row. With onStep, on a phone's shell (or wherever neither
// side of the menu has room for it) it steps in instead: the menu shows it in
// its own box (useCtxStep), and nothing flies out.
export function CtxSubmenu({ item, onClose, claimFire = () => true, onStep = null }) {
  const { mobileShell, coarse } = shellOf(useBreakpoint());
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

  // No room on either side of the menu for a flyout SUB_W wide.
  const noRoomBeside = () => {
    const menu = wrapRef.current?.closest('.ctx-menu');
    if (!menu) return false;
    const r = menu.getBoundingClientRect();
    return r.right + SUB_W > window.innerWidth - PAD && r.left - SUB_W < PAD;
  };
  const steps = () => !!onStep && (mobileShell || noRoomBeside());

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
    const itemCount = item.submenu.length;
    // Rows are 40px to a finger (styles.css), 30px to a mouse.
    const estH = Math.min(itemCount * (coarse ? 40 : 30) + 8, window.innerHeight - 2 * PAD);
    const opensOffRight = menuRect.right + SUB_W > window.innerWidth - PAD;
    const hasRoomLeft = menuRect.left - SUB_W >= PAD;
    const left = (opensOffRight && hasRoomLeft) ? menuRect.left - SUB_W - 2 : menuRect.right + 2;
    let top = itemRect.top - 4;
    if (top + estH > window.innerHeight - PAD) top = Math.max(PAD, window.innerHeight - PAD - estH);
    return { left, top, maxHeight: window.innerHeight - top - PAD };
  };

  const show = (keys = false) => {
    if (steps()) { onStep(item, keys); return; }
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    setPos(computePos());
    setOpen(true);
    setByKey(keys);
  };
  // The pointer coming back over it keeps a submenu the keys opened as it is.
  // (A tap's own mouseenter must not step in ahead of its click.)
  const hover = () => { if (!steps()) show(open && byKey); };
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
  const choose = (sub) => { if (!claimFire()) return; if (sub.danger) haptic('delete'); onClose(); sub.run && sub.run(); };

  return (
    <div ref={wrapRef} className="ctx-submenu-wrap" onMouseEnter={hover} onMouseLeave={handleLeave}>
      <button ref={rowRef} className={`ctx-item ctx-has-submenu ${item.danger ? 'danger' : ''}`} disabled={item.disabled}
              role="menuitem" aria-haspopup="menu" aria-expanded={open}
              data-step-id={item.id}
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
          <CtxSubRows item={item} choose={choose} />
        </div>,
        document.body
      )}
    </div>
  );
}
