// "All files ⌄": what a list of files shows and how it's sorted, in one menu
// (it replaced a row of chips and a ⇅ button). The sidebar's Files card and
// the full Files page in the sidebar's look (direction A) both open it, so
// the two say the same words: Show, then Sort, then what the surface adds
// (the card's Group by; the page's tile Size, passed as `extra`). Portaled
// and fixed, so no overflow (the divider can make the card short) cuts it off:
// to <body>, or on a page committed to the dark (.public-dark, a shared link)
// into that page, so it wears the page's tokens rather than a light theme's.

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon.jsx';
import { ChevronDown } from '../../lib/icons.js';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';

// Where the menu opens: under its button when it fits, else over it; fitting
// neither, it slides up the window until it all shows (over its button, as
// menus do), and scrolls only in a window shorter than itself. Its right edge
// is the button's, or with align 'left' its left edge is, kept in the window.
export function placeMenu(btn, menu, align = 'right') {
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  const vh = window.innerHeight;
  const want = menu ? menu.scrollHeight : 0;
  const x = align === 'left'
    ? { left: Math.max(8, Math.min(r.left, window.innerWidth - (menu?.offsetWidth || 0) - 8)) }
    : { right: Math.max(8, window.innerWidth - r.right) };
  const below = vh - r.bottom - 12;
  const above = r.top - 12;
  if (want <= below) return { ...x, top: r.bottom + 4, maxHeight: below };
  if (want <= above) return { ...x, bottom: vh - r.top + 4, maxHeight: above };
  const room = vh - 16;
  return { ...x, top: Math.max(8, vh - 8 - Math.min(want, room)), maxHeight: room };
}

export function FilesShowMenu({
  label, on = false, title, sections, extra = null,
  ariaLabel = 'Show, sort and group', align = 'right', hidden = false,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);
  // Opened from the keyboard (a click with no pointer), the item in force shows
  // it has focus; opened with a pointer, focus goes there quietly.
  const byKey = useRef(false);
  // The menu itself is portaled out of the wrapper: a click in it isn't outside.
  useDismissOnOutside(wrapRef, open, () => setOpen(false), { ignore: '.sbf-menu' });
  // Folded or hidden by its surface: no menu left open over nothing.
  useEffect(() => { if (hidden) setOpen(false); }, [hidden]);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const place = (e) => {
      const t = e?.target;
      if (t instanceof Node && popRef.current?.contains(t)) return;   // scrolling the menu itself
      setPos(placeMenu(btnRef.current, popRef.current, align));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align]);
  // Once it's placed (hidden until then, and hidden can't take focus), focus
  // goes into the menu, on the item in force, so ↑/↓, Tab and Esc work there.
  const placed = !!pos;
  useEffect(() => {
    if (!open || !placed) return;
    const pop = popRef.current;
    (pop?.querySelector('[aria-checked="true"]') || pop?.querySelector('[role^="menuitem"]'))
      ?.focus({ preventScroll: true, focusVisible: byKey.current });
  }, [open, placed]);
  // A choice closes the menu and hands focus back to its button, as Esc does.
  const close = () => { setOpen(false); btnRef.current?.focus({ preventScroll: true }); };
  const onMenuKeyDown = (e) => {
    if (e.key === 'Tab') { e.preventDefault(); close(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const items = [...(popRef.current?.querySelectorAll('[role^="menuitem"]') || [])];
    const i = items.indexOf(document.activeElement);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
      : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[j]?.focus();
  };
  return (
    <div className="sbf-filter" ref={wrapRef}
         onKeyDown={(e) => {
           if (e.key !== 'Escape' || !open) return;
           e.preventDefault();
           e.stopPropagation();
           setOpen(false);
           btnRef.current?.focus();
         }}>
      <button type="button" ref={btnRef}
              className={`sbf-filter-btn${on ? ' is-on' : ''}${open ? ' is-open' : ''}`}
              aria-haspopup="menu" aria-expanded={open} title={title}
              onClick={(e) => { byKey.current = e.detail === 0; setOpen((o) => !o); }}>
        {label}<span className="sbf-filter-caret" aria-hidden="true"><Icon as={ChevronDown} size={10} weight="regular" /></span>
      </button>
      {open && createPortal(
        <div className="sbf-menu" role="menu" aria-label={ariaLabel} ref={popRef}
             style={pos || { top: 0, right: 0, visibility: 'hidden' }}
             onKeyDown={onMenuKeyDown}>
          {sections.map((s, k) => (
            <Fragment key={s.id}>
              {k > 0 && <div className="sbf-menu-sep" role="separator" />}
              <div className="sbf-menu-label">{s.label}</div>
              {s.items.map((it) => (
                <button type="button" key={it.key} role="menuitemradio" aria-checked={!!it.checked}
                        className={`sbf-menu-item${it.checked ? ' is-on' : ''}`}
                        onClick={() => { it.onPick(); if (!it.keepOpen) close(); }}>
                  {it.label}
                  {(it.count || 0) > 0 && <span className="sbf-menu-count">{it.count}</span>}
                </button>
              ))}
            </Fragment>
          ))}
          {extra}
        </div>,
        btnRef.current?.closest('.public-dark') || document.body,
      )}
    </div>
  );
}
