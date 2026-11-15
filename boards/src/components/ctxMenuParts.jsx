import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import HapticTap from './HapticTap.jsx';
import { haptic } from '../lib/haptics.js';
import { ChevronLeft, ChevronRight } from '../lib/icons.js';
import { shortcutAria, shortcutCaps } from '../lib/looks.js';
import { useBreakpoint } from '../hooks/useBreakpoint.js';
import { shellOf } from '../lib/deviceShell.js';
import { t as tr, ph } from '@lingui/core/macro';

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
//
// A submenu's row can have a submenu of its own (Group > Outline shape). In a
// flyout it opens a flyout beside that one; stepped in, it steps a level
// deeper, and ‹ comes back a level at a time.

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
// Sent to a menu's box when a tap or the keys open one of its flyouts.
const SUB_OPENED = 'soleil-ctx-sub-opened';

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

// A submenu's rows, in its flyout or stepped in. `nest` draws a row that has
// a submenu of its own: a flyout's is another CtxSubmenu, the stepped view's a
// row that steps deeper.
function CtxSubRows({ item, choose, nest }) {
  return item.submenu.map((sub, j) => {
    if (sub.divider) return <div key={`sd-${j}`} className="ctx-divider" />;
    if (sub.header) return <div key={`sh-${j}`} className="ctx-header" aria-hidden="true">{sub.header}</div>;
    if (sub.submenu) return nest(sub, sub.id || j);
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
// (CardContextMenu, BackgroundContextMenu). The step is a path: the ids from
// the menu's own row down to the submenu showing, one per level. `item` is
// that submenu's row and `parent` the row a level up (null at the first
// level), both read from the menu's current items by the path's ids so their
// actions are never stale; stepIn is what the menu hands CtxSubmenu and
// CtxStepView as onStep; back() goes up one level, with the focus on the row
// that stepped in, and says whether there was a step to leave (Escape goes
// back a level first, then closes). `top` and `width` are the menu's when it
// stepped: the stepped view takes its place.
export function useCtxStep(open, items, menuRef) {
  const [at, setAt] = useState(null); // {path: [{id, scrollTop}], top, width, byKey, hadFocus, cap}
  const backTo = useRef(null);
  useEffect(() => { if (!open) { setAt(null); backTo.current = null; } }, [open]);
  // The path, as far as the current items still have it.
  const chain = [];
  if (open && at) {
    let rows = items;
    for (const { id } of at.path) {
      const it = rows.find((r) => r && r.submenu && r.id === id);
      if (!it) break;
      chain.push(it);
      rows = it.submenu;
    }
  }
  const item = chain[chain.length - 1] || null;
  const parent = chain[chain.length - 2] || null;
  const depth = chain.length;
  const depthRef = useRef(0);
  depthRef.current = depth;
  const stepIn = (it, byKey = false) => {
    const el = menuRef.current;
    const hadFocus = !!el && el.contains(document.activeElement);
    if (at && depthRef.current) {
      // A level deeper, from the stepped view: its rows are what scrolled.
      const scrollTop = el?.querySelector('.ctx-step-body')?.scrollTop ?? 0;
      setAt({ ...at, path: [...at.path.slice(0, depthRef.current), { id: it.id, scrollTop }], byKey, hadFocus });
      return;
    }
    const r = el?.getBoundingClientRect();
    // scrollTop and cap: where the menu was scrolled to, and the height it
    // was held to. The stepped view reuses its box, which resets both.
    setAt({ path: [{ id: it.id, scrollTop: el?.scrollTop ?? 0 }], top: r?.top ?? 0, width: r?.width, byKey, hadFocus,
            cap: el?.style.maxHeight ?? '' });
  };
  const back = () => {
    if (!depthRef.current || !at) return false;
    const { id, scrollTop } = at.path[depthRef.current - 1];
    backTo.current = { id, scrollTop, cap: at.cap };
    setAt(depthRef.current > 1 ? { ...at, path: at.path.slice(0, depthRef.current - 1) } : null);
    return true;
  };
  const steppedKey = chain.map((it) => it.id).join('/');
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const from = backTo.current;
    backTo.current = null;
    const stepRow = (within) => [...within.querySelectorAll('button.ctx-has-submenu')].find((b) => b.dataset.stepId === String(from.id));
    if (depth && from == null) {
      // The row that stepped in is gone, and the focus with it: on the first
      // row from the keys, on ‹ from a press that had it.
      if (at?.byKey) el.querySelector('.ctx-step-body button.ctx-item:not(:disabled)')?.focus({ preventScroll: true });
      else if (at?.hadFocus) el.querySelector('button.ctx-item.is-back')?.focus({ preventScroll: true });
      return;
    }
    if (from == null) return;
    if (depth) {
      // Back up a level, still stepped in: its rows where they were.
      const body = el.querySelector('.ctx-step-body');
      if (!body) return;
      body.scrollTop = from.scrollTop;
      stepRow(body)?.focus({ preventScroll: true });
      return;
    }
    // Scrolled to where it was (under the cap it had, or the scroll clamps
    // short), so a row reached by scrolling is on screen again.
    el.style.maxHeight = from.cap;
    el.scrollTop = from.scrollTop;
    stepRow(el)?.focus({ preventScroll: true });
  }, [steppedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return { item, parent, top: at?.top, width: at?.width, stepIn, back };
}

// A stepped-in submenu, in its menu's box: ‹ and its name, a hairline, its
// rows. ‹ says what it goes back to: the submenu a level up (`parent`), or at
// the first level the menu, which `root` names: 'card' or 'canvas'. A row
// with a submenu of its own steps a level deeper (onStep, useCtxStep's
// stepIn): → Enter or Space from the keys, with its first row focused.
export function CtxStepView({ item, parent = null, root, onBack, onClose, onStep = null, claimFire = () => true }) {
  const choose = (sub) => { if (!claimFire()) return; if (sub.danger) haptic('delete'); onClose(); sub.run && sub.run(); };
  const nest = (sub, key) => (
    <button key={key} className={`ctx-item ctx-has-submenu ${sub.danger ? 'danger' : ''}`} disabled={sub.disabled}
            role="menuitem" aria-haspopup="menu" aria-expanded={false}
            data-step-id={sub.id}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.stopPropagation();
              onStep && onStep(sub, true);
            }}
            onClick={() => onStep && onStep(sub)}>
      <span className="ctx-label">{sub.label}</span>
      <CtxChevron />
    </button>
  );
  // The submenu a level up is named in the doc menus' sentence (toolbar/Menu.jsx).
  const backLabel = parent
    ? tr`${ph({ label: item.label })}, back to ${ph({ label2: parent.label })}`
    : root === 'card' ? tr`${ph({ label: item.label })}, back to the card menu` : tr`${ph({ label: item.label })}, back to the canvas menu`;
  return (
    <>
      <button className="ctx-item is-back" role="menuitem"
              aria-label={backLabel}
              onClick={onBack}>
        <Icon as={ChevronLeft} size={20} weight="regular" className="ctx-back-chevron" aria-hidden="true" />
        <span className="ctx-label">{item.label}</span>
      </button>
      <div className="ctx-divider" role="separator" />
      {/* Keyed by the level: a deeper one starts at its top, not where the last was scrolled. */}
      <div className="ctx-step-body" key={item.id}>
        <CtxSubRows item={item} choose={choose} nest={nest} />
      </div>
    </>
  );
}

// A stepped menu's keys: ← goes back a level; the rest walk it.
export function stepMenuKeys(step) {
  return (e) => {
    if (e.key === 'ArrowLeft' && step.back()) { e.preventDefault(); e.stopPropagation(); return; }
    walkMenu(e);
  };
}

// A row that opens a submenu, and the submenu, portaled to <body> so its
// position: fixed escapes the menu's transform. A mouse over the row opens
// it, and closes it 140ms after leaving; a tap or a click toggles it (hover
// is out of a finger's reach, and a tap's own enter and leave are not a
// hover: on a landscape iPad the enter opened it and the same tap's click
// shut it); → Enter or Space opens it with its first row focused, and ←
// closes it, back on the row. With onStep, on a phone's shell (or wherever
// neither side of the menu has room for it) it steps in instead: the menu
// shows it in its own box (useCtxStep), and nothing flies out.
//
// A row of it with a submenu of its own is another of these, inside the
// flyout: its `.ctx-menu` is the flyout, so it opens beside that, on the way
// the flyout went from its menu (`toLeft`) while that side has the room, and
// not back over the menu. React counts the nested flyout as inside this one
// (and this one's row), so a mouse on its way into it never leaves this one.
export function CtxSubmenu({ item, onClose, claimFire = () => true, onStep = null, toLeft = false }) {
  const { mobileShell, coarse } = shellOf(useBreakpoint());
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // {left, top, maxHeight, toLeft}
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
  // One flyout per menu: a tap or the keys opening another row's closes this
  // one (a mouse's leaves it, a finger's doesn't). Under a finger the menu
  // scrolling closes it too: the flyout is fixed, so it would stay where it
  // was while its row scrolled away (a mouse's is placed again on the next
  // enter).
  useEffect(() => {
    const menu = wrapRef.current?.closest('.ctx-menu');
    if (!open || !menu) return undefined;
    const onOther = (e) => { if (e.detail !== wrapRef.current) setOpen(false); };
    const close = () => setOpen(false);
    menu.addEventListener(SUB_OPENED, onOther);
    if (coarse) menu.addEventListener('scroll', close, { passive: true });
    return () => {
      menu.removeEventListener(SUB_OPENED, onOther);
      menu.removeEventListener('scroll', close);
    };
  }, [open, coarse]);

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
    const goLeft = toLeft ? (hasRoomLeft || opensOffRight) : (opensOffRight && hasRoomLeft);
    const side = goLeft ? menuRect.left - SUB_W - 2 : menuRect.right + 2;
    // A flyout's flyout can have the room on neither side (the menu steps in
    // then, a flyout can't): it stays inside the window.
    const left = onStep ? side : Math.max(PAD, Math.min(side, window.innerWidth - SUB_W - PAD));
    let top = itemRect.top - 4;
    if (top + estH > window.innerHeight - PAD) top = Math.max(PAD, window.innerHeight - PAD - estH);
    return { left, top, maxHeight: window.innerHeight - top - PAD, toLeft: goLeft };
  };

  const show = (keys = false) => {
    if (steps()) { onStep(item, keys); return; }
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    setPos(computePos());
    setOpen(true);
    setByKey(keys);
  };
  // Opened by a tap or the keys: the menu's other flyout closes.
  const showAlone = (keys = false) => {
    show(keys);
    wrapRef.current?.closest('.ctx-menu')?.dispatchEvent(new CustomEvent(SUB_OPENED, { detail: wrapRef.current }));
  };
  // A mouse only: a finger's enter and leave come with its tap. The pointer
  // coming back over it keeps a submenu the keys opened as it is.
  const hover = (e) => { if (e.pointerType === 'mouse' && !steps()) show(open && byKey); };
  const handleLeave = (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setOpen(false), 140);
  };
  const onRowKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    showAlone(true);
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
  const nest = (sub, key) => <CtxSubmenu key={key} item={sub} onClose={onClose} claimFire={claimFire} toLeft={!!pos?.toLeft} />;

  return (
    <div ref={wrapRef} className="ctx-submenu-wrap" onPointerEnter={hover} onPointerLeave={handleLeave}>
      <button ref={rowRef} className={`ctx-item ctx-has-submenu ${item.danger ? 'danger' : ''}`} disabled={item.disabled}
              role="menuitem" aria-haspopup="menu" aria-expanded={open}
              data-step-id={item.id}
              onKeyDown={onRowKey}
              onClick={() => { if (open) setOpen(false); else showAlone(); }}>
        <span className="ctx-label">{item.label}</span>
        <CtxChevron />
      </button>
      {open && pos && createPortal(
        <div ref={subRef} className="ctx-menu ctx-submenu is-scrollable"
             role="menu" aria-label={item.label}
             style={{ position: 'fixed', left: pos.left, top: pos.top, maxHeight: pos.maxHeight, overflowY: 'auto' }}
             onKeyDown={onSubKey}
             onPointerEnter={hover}
             onPointerLeave={handleLeave}>
          <CtxSubRows item={item} choose={choose} nest={nest} />
        </div>,
        document.body
      )}
    </div>
  );
}
