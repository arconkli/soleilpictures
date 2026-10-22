import { createContext, forwardRef, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, IconWeightContext } from '../Icon.jsx';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover.js';
import { ariaKeys } from '../../lib/ariaKeys.js';
import { Check, ChevronRight } from '../../lib/icons.js';
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
//   <MenuButton label="Insert" icon={Plus} caret>
//     <MenuHead>Media</MenuHead>
//     <MenuItem icon={Image} label="Image" onSelect={…} />
//   </MenuButton>
const MenuCtx = createContext(null);
const ROW = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
const rowsOf = (menu) => [...menu.querySelectorAll(ROW)].filter((r) => !r.disabled && r.closest('[role="menu"]') === menu);

export function Menu({ open, onClose, anchorRef, label, side = 'below', align = 'start', byKey = false, className = '', children }) {
  const popHold = useRef(null);
  const close = useCallback((why) => {
    const menu = popHold.current?.current;
    const hadFocus = !!menu && menu.contains(document.activeElement);
    onClose?.(why);
    if (!hadFocus || why === 'outside') return;
    const back = () => anchorRef.current?.focus({ preventScroll: true });
    if (why === 'escape') { back(); return; }
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!a || a === document.body) back();
    });
  }, [onClose, anchorRef]);
  const { popRef, style } = useAnchoredPopover({ open, onClose: close, anchorRef, side, align, fitHeight: true });
  popHold.current = popRef;

  useLayoutEffect(() => {
    if (!open) return undefined;
    // A frame on: a press focuses what it pressed (the button) once the
    // press's handlers, this menu's opening among them, have run.
    const raf = requestAnimationFrame(() => {
      const menu = popRef.current;
      if (!menu) return;
      const first = byKey ? rowsOf(menu)[0] : null;
      (first || menu).focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e) => {
    if (e.defaultPrevented || isComposingKey(e)) return;
    const menu = e.currentTarget;
    if (e.key === 'Tab') {
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

  if (!open) return null;
  return createPortal(
    <IconWeightContext.Provider value="regular">
      <MenuCtx.Provider value={close}>
        <div ref={popRef} role="menu" aria-label={label} tabIndex={-1}
             className={className ? `tl-menu ${className}` : 'tl-menu'} style={style}
             onKeyDown={onKeyDown}>
          {children}
        </div>
      </MenuCtx.Provider>
    </IconWeightContext.Provider>,
    document.body,
  );
}

// A row. `checked` makes it a menuitemcheckbox (or, with `radio`, one of a
// set to pick from) and shows the check: on the right of a row with an icon,
// in the icon's place on one without. `value` is what it's set to now, on the
// right ("Serif"); `keys` its shortcut in caps; `sub` a second line. A row
// picked runs `onSelect` and closes the menu, unless `keepOpen`.
export const MenuItem = forwardRef(function MenuItem({
  icon, label, sub, value, keys, checked, radio = false, danger = false, disabled = false,
  submenu = false, keepOpen = false, onSelect, className = '', children, ...rest
}, ref) {
  const close = useContext(MenuCtx);
  const role = checked == null ? 'menuitem' : (radio ? 'menuitemradio' : 'menuitemcheckbox');
  const cls = ['tl-mi'];
  if (sub) cls.push('is-tall');
  if (danger) cls.push('is-danger');
  if (className) cls.push(className);
  const lead = icon ? <Icon as={icon} size={16} />
    : checked ? <Icon as={Check} size={16} className="tl-chk" />
      : <span className="tl-mind" />;
  return (
    <button ref={ref} type="button" role={role} tabIndex={-1} className={cls.join(' ')}
            aria-checked={checked == null ? undefined : !!checked}
            aria-haspopup={submenu ? 'menu' : undefined}
            aria-keyshortcuts={keys ? ariaKeys(keys) : undefined}
            disabled={disabled}
            onClick={(e) => {
              onSelect?.(e);
              if (!keepOpen && !submenu) close?.('select');
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
      {submenu ? <Icon as={ChevronRight} size={12} className="tl-sub" /> : null}
    </button>
  );
});

export function MenuHead({ children }) {
  return <div className="tl-mh" role="presentation">{children}</div>;
}

export function MenuSep() {
  return <div className="tl-msep" role="separator" />;
}

// A button that opens a menu: its open state, whether a key opened it (so
// the first row takes the focus), and ↓ on it opening it from the keyboard.
// `children` is the menu's rows.
export function MenuButton({ label, menuLabel, side = 'below', align = 'start', menuClassName, children, onKeyDown, onClick, ...btn }) {
  const [open, setOpen] = useState(false);
  const [byKey, setByKey] = useState(false);
  const ref = useRef(null);
  return (
    <>
      <Btn ref={ref} label={label} aria-haspopup="menu" aria-expanded={open} {...btn}
           onClick={(e) => { onClick?.(e); setByKey(e.detail === 0); setOpen((o) => !o); }}
           onKeyDown={(e) => {
             onKeyDown?.(e);
             if (e.defaultPrevented || e.key !== 'ArrowDown' || open) return;
             e.preventDefault();
             e.stopPropagation();
             setByKey(true);
             setOpen(true);
           }} />
      <Menu open={open} onClose={() => setOpen(false)} anchorRef={ref} label={menuLabel || label}
            side={side} align={align} byKey={byKey} className={menuClassName}>
        {children}
      </Menu>
    </>
  );
}
