// The desktop top bar, as two islands floating over the surface.
//
// With the files sidebar, Board · Files no longer lives in the bar, and most
// of what was left was empty width. So the bar goes and its controls float:
// where you are (back, forward, the trail) at the top left, what you do here
// (undo, search, theme, who's here, Share) at the top right, and everything
// used now and then behind ⋯. The canvas runs to the top edge between them.
//
// Presentational: App fills both islands with the same buttons and handlers
// the bar had (`left`, `right`), and hands over the ⋯ items. The layer has no
// height of its own, so it floats over whatever surface follows it in .main,
// below any banner above it; App sets .is-floating-chrome on .app, which moves
// the canvas's top-edge controls down by --chrome-band and gives every other
// surface that much room at its top (floatingChrome.css).
//
// Held: App renders it only with the files sidebar and never on a phone, which
// keeps its bar.

import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { MoreHorizontal } from '../../lib/icons.js';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import './floatingChrome.css';

// items: [{ id, label, icon?, run, hint? } | { sep: true }]
function MoreMenu({ items }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const viaKeys = useRef(false);
  useDismissOnOutside(wrapRef, open, () => setOpen(false));

  useEffect(() => {
    if (!open) return undefined;
    // Opened from the keyboard, focus goes into the menu; by mouse it stays put.
    if (viaKeys.current) listRef.current?.querySelector('[role="menuitem"]')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btnRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const onListKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [...listRef.current.querySelectorAll('[role="menuitem"]')];
    const i = all.indexOf(document.activeElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  };

  return (
    <div className="chrome-more" ref={wrapRef}>
      <button type="button" ref={btnRef} className="tb-icon chrome-more-btn"
              aria-label="More" title="More" aria-haspopup="menu" aria-expanded={open}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') viaKeys.current = true; }}
              onClick={() => { setOpen((o) => !o); }}
              onMouseDown={() => { viaKeys.current = false; }}>
        <Icon as={MoreHorizontal} size={18} />
      </button>
      {open && (
        <div className="chrome-menu" role="menu" aria-label="More" ref={listRef} onKeyDown={onListKey}>
          {items.map((it, i) => (it.sep
            ? <div key={`sep-${i}`} className="chrome-menu-sep" role="separator" />
            : (
              <button type="button" key={it.id} role="menuitem" className="chrome-menu-item"
                      onClick={() => { setOpen(false); it.run?.(); }}>
                {it.icon ? <Icon as={it.icon} size={15} /> : <span className="chrome-menu-noicon" aria-hidden="true" />}
                <span className="chrome-menu-label">{it.label}</span>
                {it.hint && <span className="chrome-menu-hint">{it.hint}</span>}
              </button>
            )))}
        </div>
      )}
    </div>
  );
}

export function FloatingChrome({ left = null, right = null, menuItems = [] }) {
  return (
    <div className="chrome-layer">
      <nav className="chrome-island chrome-left" aria-label="Where you are">{left}</nav>
      <div className="chrome-island chrome-right" role="toolbar" aria-label="This cluster">
        {right}
        {menuItems.length > 0 && <MoreMenu items={menuItems} />}
      </div>
    </div>
  );
}
