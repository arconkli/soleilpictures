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

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

// The trail keeps at least TRAIL_MIN before the left island's words go, and
// TRAIL_FLOOR before Back and Forward go too: what is left says where you are,
// and the clusters beside it are the way around.
const TRAIL_MIN = 88;
const TRAIL_FLOOR = 64;

// How wide these are in their row, each with the gap after it.
const widthInRow = (els) => els.reduce((w, el) => (
  w + el.getBoundingClientRect().width + (parseFloat(getComputedStyle(el.parentElement).columnGap) || 0)
), 0);

export function FloatingChrome({ left = null, right = null, menuItems = [] }) {
  // The right island publishes its width, so the left one (the trail) stops
  // short of it however narrow the surface gets — a tablet held sideways with
  // the files beside the clusters left the two islands overlapping. Where even
  // then the trail would get less than TRAIL_MIN (a finger's 40px buttons
  // beside the files), the left island's words go, New cluster keeping its +;
  // under TRAIL_FLOOR, Back and Forward (.tb-hist) go as well. Each comes back
  // once it fits. .chrome-room is the width the island may take.
  const layerRef = useRef(null);
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const roomRef = useRef(null);
  const [tight, setTight] = useState(0);   // 0, 1 (words gone), 2 (and Back, Forward)
  useLayoutEffect(() => {
    const layer = layerRef.current;
    const island = rightRef.current;
    const lefty = leftRef.current;
    const room = roomRef.current;
    if (!layer || !island || !lefty || !room || typeof ResizeObserver !== 'function') return undefined;
    let level = 0;
    let words = 0;
    let hist = 0;
    const check = () => {
      layer.style.setProperty('--chrome-right-w', `${Math.ceil(island.getBoundingClientRect().width)}px`);
      // Shown, they are measured; gone, they count as what they took.
      if (level < 1) words = widthInRow([...lefty.querySelectorAll('.tb-btn-label')]);
      if (level < 2) hist = widthInRow([...lefty.querySelectorAll('.tb-hist')]);
      // Everything in the left island but the trail, which gives way first,
      // as it would be with all of it shown.
      const crumbs = lefty.querySelector('.crumbs');
      const own = lefty.scrollWidth - (crumbs ? crumbs.getBoundingClientRect().width : 0)
        + (level >= 1 ? words : 0) + (level >= 2 ? hist : 0);
      const fits = room.clientWidth;
      const next = own + TRAIL_MIN <= fits ? 0 : own - words + TRAIL_FLOOR <= fits ? 1 : 2;
      if (next !== level) { level = next; setTight(next); }
    };
    // Once before the first paint, then on the frame after anything resizes,
    // not inside the observer's own pass: what check sets (the right island's
    // width, the classes) resizes what it watches, which inside the pass is a
    // "ResizeObserver loop" error.
    check();
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    });
    ro.observe(island);
    ro.observe(lefty);
    ro.observe(room);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); };
  }, []);
  return (
    <div className={`chrome-layer${tight ? ' is-tight' : ''}${tight > 1 ? ' is-tighter' : ''}`} ref={layerRef}>
      <div className="chrome-room" ref={roomRef} aria-hidden="true" />
      <nav className="chrome-island chrome-left" aria-label="Where you are" ref={leftRef}>{left}</nav>
      <div className="chrome-island chrome-right" role="toolbar" aria-label="This cluster" ref={rightRef}>
        {right}
        {menuItems.length > 0 && <MoreMenu items={menuItems} />}
      </div>
    </div>
  );
}
