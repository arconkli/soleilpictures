// The desktop top bar, as two islands floating over the surface.
//
// With the files sidebar, Board · Files no longer lives in the bar, and most
// of what was left was empty width. So the bar goes and its controls float:
// where you are (back, forward, the trail) at the top left, what you do here
// (undo, search, split view, theme, who's here, Share) at the top right, and everything
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
//
// The islands wear the toolbar look's glass (styles/toolbarLook.css), their
// icons are drawn regular, and ⋯ is the look's menu (ChromeMoreA.jsx, a chunk
// of its own).

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon, IconWeightContext } from '../Icon.jsx';
import { MoreHorizontal } from '../../lib/icons.js';
import { useToolbarRoving } from '../../hooks/useToolbarRoving.js';
import { lazyWithReload } from '../../lib/lazyWithReload.js';
import './floatingChrome.css';

const ChromeMoreA = lazyWithReload(() => import('./ChromeMoreA.jsx').then((m) => ({ default: m.ChromeMoreA })));

// The trail keeps at least TRAIL_MIN before the left island's words go, and
// TRAIL_FLOOR before Back and Forward go too: what is left says where you are,
// and the clusters beside it are the way around.
const TRAIL_MIN = 88;
const TRAIL_FLOOR = 64;

// How wide these are in their row, each with the gap after it.
const widthInRow = (els) => els.reduce((w, el) => (
  w + el.getBoundingClientRect().width + (parseFloat(getComputedStyle(el.parentElement).columnGap) || 0)
), 0);

// ⋯'s place while its menu loads (it's warmed on mount): the same
// button, not yet a menu, so the island's width doesn't change under it. One
// that goes with the keyboard on it says so in `focus`, and the menu that
// takes its place takes the keyboard (the page would get it otherwise).
function MoreStandIn({ focus }) {
  const ref = useRef(null);
  useLayoutEffect(() => () => { focus.current = !!ref.current && ref.current === document.activeElement; }, [focus]);
  return (
    <span className="chrome-more">
      <button ref={ref} type="button" className="tb-icon chrome-more-btn" aria-label="More" aria-disabled="true">
        <Icon as={MoreHorizontal} size={18} />
      </button>
    </span>
  );
}

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
  const rightKeys = useToolbarRoving(rightRef);
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
  useEffect(() => { ChromeMoreA.warm?.(); }, []);
  const moreFocus = useRef(false);
  const more = menuItems.length > 0 && (
    <Suspense fallback={<MoreStandIn focus={moreFocus} />}><ChromeMoreA items={menuItems} focus={moreFocus} /></Suspense>
  );
  const layer = (
    <div className={`chrome-layer${tight ? ' is-tight' : ''}${tight > 1 ? ' is-tighter' : ''}`} ref={layerRef}>
      <div className="chrome-room" ref={roomRef} aria-hidden="true" />
      <nav className="chrome-island chrome-left" aria-label="Where you are" ref={leftRef}>{left}</nav>
      <div className="chrome-island chrome-right" role="toolbar" aria-label="This cluster" ref={rightRef}
           onKeyDown={rightKeys}>
        {right}
        {more}
      </div>
    </div>
  );
  return <IconWeightContext.Provider value="regular">{layer}</IconWeightContext.Provider>;
}
