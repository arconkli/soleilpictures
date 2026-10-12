// The player's menus (speed, guides, timecode, versions, compare, the
// picture's right-click). Not native <select>s: those can't show a key hint
// or an aspect thumbnail, look like a form inside a picture room, and vanish
// in full screen. Portalled into the player itself so they work there.
//
// While open it's the top layer of the modal guard: the player's keys stand
// down (it checks it is on top), arrows move through the rows, and Esc closes
// only the menu.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as modalGuard from '../../lib/modalGuard.js';
import { Icon } from '../Icon.jsx';
import { Check } from '../../lib/icons.js';

const selectable = (it) => it && !it.divider && !it.header && !it.disabled;

//   anchor     a DOMRect-like { left, top, width, height } (viewport) to open from
//   container  the element to portal into (the player root, or the review)
//   items      [{ id, label, hint?, checked?, disabled?, divider?, header?, thumb?, sub?, run }]
export function FilmMenu({ anchor, container, items, onClose, label = 'Menu', placement = 'above', align = 'start', className = '' }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const [active, setActive] = useState(() => {
    const i = items.findIndex((it) => selectable(it) && it.checked);
    return i >= 0 ? i : items.findIndex(selectable);
  });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const host = container || (typeof document !== 'undefined' ? document.body : null);

  useEffect(() => modalGuard.registerModalOpen({ onEscape: () => { closeRef.current?.(); return true; } }), []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !host) return;
    const hr = host === document.body ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight } : host.getBoundingClientRect();
    const mr = el.getBoundingClientRect();
    const a = anchor || { left: hr.left + hr.width / 2, top: hr.top + hr.height / 2, width: 0, height: 0 };
    let left = align === 'end' ? a.left + a.width - mr.width : align === 'center' ? a.left + a.width / 2 - mr.width / 2 : a.left;
    left = Math.max(8, Math.min(hr.width - mr.width - 8, left - hr.left));
    const above = a.top - hr.top - mr.height - 8;
    const below = a.top + a.height - hr.top + 8;
    let top = placement === 'above' ? (above >= 8 ? above : below) : (below + mr.height <= hr.height - 8 ? below : above);
    top = Math.max(8, Math.min(hr.height - mr.height - 8, top));
    setPos({ left, top });
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the menu so its keys arrive here; give it back on close.
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus({ preventScroll: true });
    return () => { if (prev?.isConnected) { try { prev.focus({ preventScroll: true }); } catch (_) {} } };
  }, []);

  // A press anywhere else closes it (the press still lands where it was aimed).
  useEffect(() => {
    const onDown = (e) => { if (!ref.current?.contains(e.target)) closeRef.current?.(); };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const choose = (it) => {
    if (!selectable(it)) return;
    it.run?.();
    if (!it.keepOpen) onClose?.();
  };
  const move = (d) => {
    const n = items.length;
    let i = active;
    for (let k = 0; k < n; k++) {
      i = (i + d + n) % n;
      if (selectable(items[i])) { setActive(i); return; }
    }
  };
  const onKeyDown = (e) => {
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (k === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (k === 'Home') { e.preventDefault(); setActive(items.findIndex(selectable)); }
    else if (k === 'End') { e.preventDefault(); const i = [...items].reverse().findIndex(selectable); setActive(items.length - 1 - i); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); choose(items[active]); }
    else if (k === 'Tab') { e.preventDefault(); onClose?.(); }
    else if (k.length === 1 && /\S/.test(k) && !e.metaKey && !e.ctrlKey) {
      const n = items.length;
      for (let j = 1; j <= n; j++) {
        const it = items[(active + j) % n];
        if (selectable(it) && String(it.label).toLowerCase().startsWith(k.toLowerCase())) { setActive((active + j) % n); break; }
      }
    } else return;
    // Nothing behind the menu hears a key it used.
    e.stopPropagation();
  };

  if (!host) return null;
  const hasChecks = items.some((it) => it.checked !== undefined);
  return createPortal(
    <div ref={ref} className={`film-menu ${className}`} role="menu" aria-label={label} tabIndex={-1}
         style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
         onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        if (it.divider) return <div key={`d${i}`} className="film-menu-sep" role="separator" />;
        if (it.header) return <div key={`h${i}`} className="film-menu-head">{it.header}</div>;
        const role = it.checked === undefined ? 'menuitem' : it.radio === false ? 'menuitemcheckbox' : 'menuitemradio';
        return (
          <div key={it.id || i} role={role} aria-checked={it.checked === undefined ? undefined : !!it.checked}
               aria-disabled={it.disabled || undefined}
               className={`film-menu-item${i === active ? ' is-active' : ''}${it.disabled ? ' is-disabled' : ''}`}
               onPointerEnter={() => selectable(it) && setActive(i)}
               onClick={() => choose(it)}>
            {hasChecks && <span className="film-menu-check">{it.checked ? <Icon as={Check} size={14} weight="bold" /> : null}</span>}
            {it.thumb && <span className="film-menu-thumb">{it.thumb}</span>}
            <span className="film-menu-label">
              {it.label}
              {it.sub && <span className="film-menu-sub">{it.sub}</span>}
            </span>
            {it.hint && <span className="film-menu-hint">{it.hint}</span>}
          </div>
        );
      })}
    </div>,
    host,
  );
}
