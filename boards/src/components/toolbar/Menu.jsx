import { createContext, forwardRef, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Icon, IconWeightContext } from '../Icon.jsx';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover.js';
import { useBreakpoint } from '../../hooks/useBreakpoint.js';
import { ariaKeys } from '../../lib/ariaKeys.js';
import { Check, ChevronLeft, ChevronRight } from '../../lib/icons.js';
import { isComposingKey } from '../../lib/composerKeys.js';
import { menuMove, menuTypeahead } from '../../lib/menuKeys.js';
import { Btn, Caps } from './Toolbar.jsx';
import './toolbar.css';

// A menu in the toolbar look (the owner's pick "A · Islands", 2026-10-21):
// glass, rows with an icon, their words, a value or the shortcut's keys, and
// heads and hairlines between sections. Portaled to <body> and placed against
// the button that opened it (hooks/useAnchoredPopover), which also closes it
// on a press outside.
//
// The WAI-ARIA menu's keys (lib/menuKeys.js): ↓ ↑ walk the rows, round from
// the last to the first, Home and End to either end, a letter to the next row
// it starts. Escape and Tab close it and give the focus back to its button.
// Opened from a key, its first row takes the focus; from a press, the menu
// itself does, and ↓ starts from there. A row picked closes it, and the focus
// is where the row's action left it (a doc's text), or back on the button if
// the action left it nowhere.
//
// A row can open a submenu (`submenu`: its rows), beside it, or on its left
// where the window has no room on its right: under the pointer after a beat,
// from → (Enter, Space) on the keyboard, and ← or Escape closes it again with
// the focus back on its row. A row picked in a submenu closes the whole menu.
//
// A phone has no room beside a menu, so there a submenu steps in instead (the
// owner's pick "A · Step in", 2026-10-27): it takes the menu's place, where the
// menu was and at its width, under ‹ and its own name, and the menu hides under
// it until ‹ (or ←, or Escape) brings it back. A long one scrolls under ‹,
// which stays put, and fades out at its foot while more rows follow.
//
// `keepFocus` is for a menu off a bar that formats a text (a doc's): opened by
// a press it leaves the focus in the text, its rows don't take it either, and
// a row's action runs on the text's selection as the bar's buttons do. From
// the keyboard it takes the focus as any menu does.
//
//   <MenuButton label="Insert" icon={Plus} caret>
//     <MenuHead>Media</MenuHead>
//     <MenuItem icon={Image} label="Image" onSelect={…} />
//     <MenuItem label="Font" value="Serif" submenu={<FontRows />} />
//   </MenuButton>
const MenuCtx = createContext(null);
const ROW = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
const rowsOf = (menu) => [...menu.querySelectorAll(ROW)].filter((r) => !r.disabled && r.closest('[role="menu"]') === menu);
// How long the pointer rests on a row before its submenu opens, and on another
// row before an open one closes (time to cross over to it on the way).
const SUB_OPEN_MS = 120;
const SUB_CLOSE_MS = 260;

// What a menu's own parts reach for: close() closes the whole menu (a row
// picked), keepFocus whether a press may take the focus.
export function useMenu() {
  return useContext(MenuCtx);
}

export function Menu({ open, onClose, anchorRef, label, side = 'below', align = 'start', byKey = false, keepFocus = false, scrim = false, subId = null, className = '', children }) {
  const parent = useContext(MenuCtx);
  const isSub = !!parent && subId != null;
  const { isPhone } = useBreakpoint();
  // On a phone a submenu steps into its menu's place (above), and so do its own.
  const step = isSub ? parent.step : isPhone;
  const stepped = isSub && step;
  const ownTree = useId();
  const tree = isSub ? parent.tree : ownTree;
  const keep = isSub ? parent.keepFocus : keepFocus;
  const popHold = useRef(null);
  const close = useCallback((why) => {
    const menu = popHold.current?.current;
    // In it, or in one of its submenus (a row picked there closes it too).
    const a = document.activeElement;
    const hadFocus = !!menu && (menu.contains(a) || !!a?.closest?.(`[data-tl-sub-of="${tree}"]`));
    onClose?.(why);
    if (!hadFocus || why === 'outside') return;
    const back = () => anchorRef.current?.focus({ preventScroll: true });
    if (why === 'escape') { back(); return; }
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!a || a === document.body) back();
    });
  }, [onClose, anchorRef, tree]);
  // A submenu hangs beside its row. Stepped in, it's placed as its menu is:
  // against the menu's button, on the side the menu went, lined up as it is.
  const at = stepped ? parent.at : { anchorRef, side: isSub ? 'right' : side, align: isSub ? 'start' : align, gap: isSub ? 2 : 6 };
  const { popRef, style, side: went } = useAnchoredPopover({
    open, onClose: close, fitHeight: true,
    anchorRef: at.anchorRef, side: at.side, align: at.align, gap: at.gap,
    // Escape in a submenu is its own (below), and the menu it opened from
    // counts a press in it as inside.
    escape: !isSub, ignore: isSub ? null : `[data-tl-sub-of="${tree}"]`,
  });
  popHold.current = popRef;

  // The row whose submenu is open, and the pointer on its way to it or away.
  const [openSub, setOpenSub] = useState(null);
  const subTimer = useRef(0);
  useLayoutEffect(() => () => clearTimeout(subTimer.current), []);
  const showSub = useCallback((id, delay = 0) => {
    clearTimeout(subTimer.current);
    const go = () => {
      // A submenu closing while the keyboard was in it leaves the focus
      // here, not on <body>: stepped in, once this menu shows again.
      const menu = popHold.current?.current;
      const refocus = id == null && menu && document.activeElement?.closest?.(`[data-tl-sub-of="${tree}"]`);
      if (refocus && step) flushSync(() => setOpenSub(id));
      if (refocus) menu.focus({ preventScroll: true });
      setOpenSub(id);
    };
    if (delay) subTimer.current = setTimeout(go, delay);
    else go();
  }, [tree, step]);
  useLayoutEffect(() => { if (!open) { clearTimeout(subTimer.current); setOpenSub(null); } }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    // Opened by the pointer, a submenu, or a menu that keeps the text's
    // focus, leaves the focus where it is; stepped in, the menu it was in
    // hides, so it comes along.
    if (!byKey && (isSub || keep) && !(stepped && !keep)) return undefined;
    // A frame on: a press focuses what it pressed (the button) once the
    // press's handlers, this menu's opening among them, have run.
    const raf = requestAnimationFrame(() => {
      const menu = popRef.current;
      if (!menu) return;
      // Past ‹, stepped in.
      const rows = byKey ? rowsOf(menu) : [];
      (rows[stepped ? 1 : 0] || rows[0] || menu).focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // A long list stepped in fades out at its foot while more rows follow.
  const bodyRef = useRef(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!open || !body) return undefined;
    const mark = () => body.toggleAttribute('data-more', body.scrollTop + body.clientHeight < body.scrollHeight - 1);
    mark();
    body.addEventListener('scroll', mark, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(mark);
    ro?.observe(body);
    return () => {
      body.removeEventListener('scroll', mark);
      ro?.disconnect();
    };
  }, [open, stepped]);

  const onKeyDown = (e) => {
    if (e.defaultPrevented || isComposingKey(e)) return;
    const menu = e.currentTarget;
    // A key from a submenu bubbles here through React's tree: it's the
    // submenu's.
    if (e.target.closest?.('[role="menu"]') !== menu) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      (isSub ? parent.close : close)('escape');
      return;
    }
    if (isSub && (e.key === 'ArrowLeft' || e.key === 'Escape')) {
      e.preventDefault();
      e.stopPropagation();
      close('escape');
      return;
    }
    const rows = rowsOf(menu);
    const at = rows.indexOf(document.activeElement);
    let to = menuMove(e.key, at, rows.length);
    if (to == null && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      to = menuTypeahead(e.key, rows.map((r) => r.querySelector('.tl-mt')?.textContent || r.textContent), at);
    }
    if (to == null) return;
    // The menu's, and nothing behind it hears it (the canvas would nudge the
    // selection on an arrow).
    e.preventDefault();
    e.stopPropagation();
    rows[to].focus();
  };

  const ctx = useMemo(() => ({
    // A row picked closes the whole menu, from a submenu too.
    close: isSub ? parent.close : close,
    keepFocus: keep,
    tree,
    openSub,
    showSub,
    // What a submenu stepping in takes: where this menu is, its width, and
    // its name for ‹.
    step,
    stepped,
    label,
    menuRef: popRef,
    at: { anchorRef: at.anchorRef, side: went, align: at.align, gap: at.gap },
  }), [isSub, parent, close, keep, tree, openSub, showSub, step, stepped, label, popRef, at.anchorRef, went, at.align, at.gap]);

  if (!open) return null;
  const cls = ['tl-menu'];
  if (stepped) cls.push('is-step');
  if (step && openSub != null) cls.push('is-under');
  if (className) cls.push(className);
  const menu = createPortal(
    <IconWeightContext.Provider value="regular">
      <MenuCtx.Provider value={ctx}>
        <div ref={popRef} role="menu" aria-label={label} tabIndex={-1}
             className={cls.join(' ')}
             // Stepped in, as wide as the menu under it.
             style={stepped ? { ...style, width: parent.menuRef.current?.offsetWidth } : style}
             data-tl-sub-of={isSub ? tree : undefined}
             // The pointer reaching a submenu keeps it open.
             onPointerEnter={isSub ? () => parent.showSub(subId) : undefined}
             onKeyDown={onKeyDown}>
          {stepped ? (
            <>
              <MenuItem icon={ChevronLeft} className="is-back" label={label} aria-label={`${label}, back to ${parent.label}`}
                        keepOpen onSelect={() => close('escape')} />
              <MenuSep />
              <div ref={bodyRef} className="tl-mstep-body">{children}</div>
            </>
          ) : children}
        </div>
      </MenuCtx.Provider>
    </IconWeightContext.Provider>,
    document.body,
  );
  if (!scrim || isSub) return menu;
  // `scrim`: a menu off a bar whose tool acts on a press (the canvas's draw
  // and shape tools) takes the press that closes it, on a layer under it,
  // so the press doesn't also draw a stroke or a shape where it landed.
  return (
    <>
      {createPortal(<div className="tl-scrim" aria-hidden="true" />, document.body)}
      {menu}
    </>
  );
}

// A row. `checked` makes it a menuitemcheckbox (or, with `radio`, one of a
// set to pick from) and shows the check: on the right of a row with an icon,
// in the icon's place on one without. `value` is what it's set to now, on the
// right ("Serif"); `keys` its shortcut in caps; `sub` a second line. A row
// picked runs `onSelect` and closes the menu, unless `keepOpen`. `submenu`
// is the rows of the menu it opens instead (`submenuLabel` names it).
export const MenuItem = forwardRef(function MenuItem({
  icon, label, sub, value, keys, checked, radio = false, danger = false, disabled = false,
  submenu = null, submenuLabel, submenuClassName, keepOpen = false, onSelect, className = '', children,
  onPointerEnter, onKeyDown, onMouseDown, style, ...rest
}, ref) {
  const ctx = useContext(MenuCtx);
  const id = useId();
  const own = useRef(null);
  const setRef = useCallback((el) => {
    own.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  }, [ref]);
  const nested = submenu != null && submenu !== false;
  const subOpen = nested && ctx?.openSub === id;
  const [subByKey, setSubByKey] = useState(false);
  const role = checked == null ? 'menuitem' : (radio ? 'menuitemradio' : 'menuitemcheckbox');
  const cls = ['tl-mi'];
  if (sub) cls.push('is-tall');
  if (danger) cls.push('is-danger');
  if (className) cls.push(className);
  const lead = icon ? <Icon as={icon} size={16} />
    : checked ? <Icon as={Check} size={16} className="tl-chk" />
      : <span className="tl-mind" />;
  return (
    <>
      <button ref={setRef} type="button" role={role} tabIndex={-1} className={cls.join(' ')}
              aria-checked={checked == null ? undefined : !!checked}
              aria-haspopup={nested ? 'menu' : undefined}
              aria-expanded={nested ? subOpen : undefined}
              aria-keyshortcuts={keys ? ariaKeys(keys) : undefined}
              disabled={disabled}
              style={style}
              onMouseDown={(e) => {
                onMouseDown?.(e);
                if (ctx?.keepFocus) e.preventDefault();
              }}
              onPointerEnter={(e) => {
                onPointerEnter?.(e);
                if (e.pointerType !== 'mouse' || disabled || ctx?.step) return;
                // Resting on a row opens its submenu, or closes the one open
                // (not one that steps in: that takes a press).
                if (nested) { setSubByKey(false); ctx?.showSub(id, SUB_OPEN_MS); }
                else if (ctx?.openSub != null) ctx.showSub(null, SUB_CLOSE_MS);
              }}
              onKeyDown={(e) => {
                onKeyDown?.(e);
                if (e.defaultPrevented || !nested || e.key !== 'ArrowRight') return;
                e.preventDefault();
                e.stopPropagation();
                setSubByKey(true);
                ctx?.showSub(id);
              }}
              onClick={(e) => {
                if (nested) {
                  setSubByKey(e.detail === 0);
                  ctx?.showSub(subOpen && e.detail !== 0 ? null : id);
                  return;
                }
                onSelect?.(e);
                if (!keepOpen) ctx?.close('select');
              }}
              {...rest}>
        {lead}
        <span className={sub ? 'tl-mt is-two' : 'tl-mt'}>
          {sub ? <><span>{label}</span><small>{sub}</small></> : label}
        </span>
        {children}
        {value != null ? <span className="tl-mv">{value}</span> : null}
        {keys ? <Caps keys={keys} /> : null}
        {icon && checked ? <Icon as={Check} size={16} className="tl-chk" /> : null}
        {nested ? <Icon as={ChevronRight} size={12} className="tl-sub" /> : null}
      </button>
      {nested ? (
        <Menu open={subOpen} onClose={() => ctx?.showSub(null)} anchorRef={own} subId={id}
              label={submenuLabel || label} byKey={subByKey} className={submenuClassName}>
          {submenu}
        </Menu>
      ) : null}
    </>
  );
});

export function MenuHead({ children }) {
  const ctx = useContext(MenuCtx);
  // Stepped in, ‹ already says it.
  if (ctx?.stepped && typeof children === 'string' && children.toLowerCase() === ctx.label?.toLowerCase()) return null;
  return <div className="tl-mh" role="presentation">{children}</div>;
}

export function MenuSep() {
  return <div className="tl-msep" role="separator" />;
}

// A button that opens a menu: its open state, whether a key opened it (so
// the first row takes the focus), and ↓ on it opening it from the keyboard.
// `children` is the menu's rows, `face` what the button shows besides its
// icon or words (a colour's chip). `keepFocus` and `scrim`: see Menu.
export function MenuButton({ label, menuLabel, side = 'below', align = 'start', menuClassName, keepFocus = false, scrim = false, face = null, children, onKeyDown, onClick, onMouseDown, ...btn }) {
  const [open, setOpen] = useState(false);
  const [byKey, setByKey] = useState(false);
  const ref = useRef(null);
  return (
    <>
      <Btn ref={ref} label={label} aria-haspopup="menu" aria-expanded={open} {...btn}
           onMouseDown={(e) => { onMouseDown?.(e); if (keepFocus) e.preventDefault(); }}
           onClick={(e) => { onClick?.(e); setByKey(e.detail === 0); setOpen((o) => !o); }}
           onKeyDown={(e) => {
             onKeyDown?.(e);
             if (e.defaultPrevented || e.key !== 'ArrowDown' || open) return;
             e.preventDefault();
             e.stopPropagation();
             setByKey(true);
             setOpen(true);
           }}>
        {face}
      </Btn>
      <Menu open={open} onClose={() => setOpen(false)} anchorRef={ref} label={menuLabel || label}
            side={side} align={align} byKey={byKey} keepFocus={keepFocus} scrim={scrim} className={menuClassName}>
        {children}
      </Menu>
    </>
  );
}
