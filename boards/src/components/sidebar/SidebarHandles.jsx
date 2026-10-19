// The floating sidebar's handles: each card's right and bottom edges and its
// corner, and the gap between the two cards (lib/sidebarLayout.js has the
// rules; the owner picked "Each card" from a live prototype, 2026-10-19).
//
// A drag sizes its card as the pointer goes without a render: the sizes go
// straight onto .sbf-frame, and the sidebar's width onto .app, every frame.
// The layout is handed to App once, when the pointer lets go. A drag that
// changes the arrangement (a stacked card pulled wider than the stacked
// sidebar gets, or side by side pulled narrow) renders the other
// arrangement's handles here and carries on. Double-click puts back what a
// handle sizes; a focused edge moves with the arrow keys. A new arrangement
// slides the files' card to its new place.
//
// The handles sit in a fixed layer over the window and are placed from where
// the cards actually are (the CSS has the last word on a card's size: a
// narrow window, the clusters as tall as their list), after every render and
// whenever a card changes size.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EDGE, SIZES, arrangementOf, dragLayout, frameVars, handleList, handleSpecs, keyLayout, resetLayout, sidebarFootprint } from '../../lib/sidebarLayout.js';

const CURSOR = { v: 'ew-resize', h: 'ns-resize', grip: 'ns-resize', corner: 'nwse-resize' };
// A card's rounded corner, 12px, with a little of each edge (the corner sits
// at 18,18 in its 24px box).
const ARC = 'M18 0 L18 6 A12 12 0 0 1 6 18 L0 18';
const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};
const kindOf = (id) => handleList('stack').concat(handleList('side')).find((h) => h.id === id)?.kind || 'v';
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// A layout put straight onto the frame, and the sidebar's width onto .app.
// `fit`: { coarse, roomy, snug }, as lib/sidebarLayout.js takes them.
export function applyLayout(frame, layout, fit = {}) {
  if (!frame) return;
  for (const [k, v] of Object.entries(frameVars(layout, fit))) frame.style.setProperty(k, v);
  frame.classList.toggle('is-side', arrangementOf(layout, fit) === 'side');
  frame.closest('.app')?.style.setProperty('--sb-w', `${sidebarFootprint(layout, fit)}px`);
}

// A size set at once (an arrow key, a double-click, the button): .app eases
// its column for collapsing, and a column easing into a new width left the
// cards squeezed for a beat and a second key press measuring the old one.
export function sizeAtOnce(frame) {
  const app = frame?.closest('.app');
  if (!app) return;
  app.classList.add('sbf-at-once');
  requestAnimationFrame(() => requestAnimationFrame(() => app.classList.remove('sbf-at-once')));
}

// What a handle's aria-valuenow reports, and its range.
function valueOf(id, t, f) {
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  switch (id) {
    case 'treeRight': return [t.w, SIZES.treeMinW, SIZES.stackMaxW];
    case 'filesRight': return [f.w, SIZES.filesMinW, SIZES.stackMaxW];
    case 'split': return [t.w, SIZES.treeMinW, SIZES.treeMaxW];
    case 'right': return [f.w, SIZES.filesMinW, SIZES.filesMaxW];
    case 'divider':
    case 'treeBottom': return [t.h, SIZES.treeMinH, vh - 2 * EDGE];
    case 'bottom': return [f.h, SIZES.filesMinH, vh - 2 * EDGE];
    default: return null;
  }
}

export function SidebarHandles({ layout, coarse = false, roomy = true, snug = true, frameRef, treeRef, filesRef, navRef, onLayout }) {
  // The arrangement a drag switched to, until it lets go and App has it.
  const [dragArr, setDragArr] = useState(null);
  const arr = dragArr || arrangementOf(layout, { coarse, roomy, snug });
  const layerRef = useRef(null);
  const guideRef = useRef(null);
  const dragRef = useRef(null);
  // The files' card where the handles last saw it, for the slide to a new arrangement.
  const lastFilesRef = useRef(null);
  const [held, setHeld] = useState(null);
  const live = useRef({});
  live.current = { layout, coarse, roomy, snug, onLayout };
  const fit = () => ({ coarse: live.current.coarse, roomy: live.current.roomy, snug: live.current.snug });

  const domArr = () => (frameRef.current?.classList.contains('is-side') ? 'side' : 'stack');

  const place = useCallback(() => {
    const layer = layerRef.current, t = treeRef.current, f = filesRef.current;
    if (!layer || !t || !f) return;
    const tr = rectOf(t), fr = rectOf(f);
    lastFilesRef.current = fr;
    const specs = new Map(handleSpecs(domArr(), { t: tr, f: fr }, { coarse: live.current.coarse }).map((s) => [s.id, s]));
    for (const el of layer.querySelectorAll('[data-handle]')) {
      const s = specs.get(el.dataset.handle);
      const show = !!s && s.w > 0 && s.h > 0;
      el.style.display = show ? '' : 'none';
      if (!show) continue;
      el.style.left = `${s.x}px`;
      el.style.top = `${s.y}px`;
      el.style.width = `${s.w}px`;
      el.style.height = `${s.h}px`;
      const v = valueOf(s.id, tr, fr);
      if (v && s.focus) {
        el.setAttribute('aria-valuenow', String(Math.round(v[0])));
        el.setAttribute('aria-valuemin', String(v[1]));
        el.setAttribute('aria-valuemax', String(Math.round(v[2])));
      }
    }
  }, [frameRef, treeRef, filesRef]);   // eslint-disable-line react-hooks/exhaustive-deps

  // The files' card slides from where it was to where the new arrangement put
  // it. The handles step aside while it moves, unless one is being dragged.
  const slide = useCallback((from, { quiet = false } = {}) => {
    const f = filesRef.current;
    if (!f || !from || reducedMotion() || typeof f.animate !== 'function') return;
    const to = f.getBoundingClientRect();
    const dx = from.x - to.left, dy = from.y - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    if (!quiet) layerRef.current?.classList.add('is-moving');
    const anim = f.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    const done = () => { layerRef.current?.classList.remove('is-moving'); place(); };
    anim.finished.then(done, done);
  }, [filesRef, place]);

  // The button switched the arrangement (a drag's own switch slides itself).
  // Before the placing below, which would forget where the card was.
  const shownArr = useRef(arr);
  useLayoutEffect(() => {
    if (shownArr.current === arr) return;
    shownArr.current = arr;
    if (!dragRef.current) slide(lastFilesRef.current);
  }, [arr, slide]);
  useLayoutEffect(() => { place(); });
  useEffect(() => {
    const t = treeRef.current, f = filesRef.current;
    window.addEventListener('resize', place);
    let ro = null;
    if (t && f && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => place());
      ro.observe(t);
      ro.observe(f);
    }
    return () => { ro?.disconnect(); window.removeEventListener('resize', place); };
  }, [place, treeRef, filesRef]);

  const showGuide = (y) => {
    const g = guideRef.current;
    if (!g) return;
    if (y == null || !treeRef.current || !filesRef.current) { g.classList.remove('is-on'); return; }
    const t = rectOf(treeRef.current), f = rectOf(filesRef.current);
    const x0 = Math.min(t.x, f.x) - 12, x1 = Math.max(t.x + t.w, f.x + f.w) + 12;
    g.style.left = `${x0}px`;
    g.style.width = `${x1 - x0}px`;
    g.style.top = `${Math.round(y)}px`;
    g.classList.add('is-on');
  };

  // Where things are as a drag starts (or carries on in a new arrangement).
  const measure = (x, lay) => {
    const frame = frameRef.current, t = treeRef.current, f = filesRef.current, nav = navRef?.current;
    if (!frame?.parentElement || !t || !f) return null;
    const box = frame.parentElement.getBoundingClientRect();
    const tr = rectOf(t), fr = rectOf(f);
    const at = domArr();
    // The clusters' card as tall as what's in it: everything but its list,
    // plus all of the list (stacked, no more than its share of the window).
    let hug = tr.h;
    if (nav) {
      const rest = tr.h - nav.clientHeight;
      hug = rest + (at === 'stack' ? Math.min(nav.scrollHeight, Math.round(SIZES.stackNavShare * window.innerHeight)) : nav.scrollHeight);
    }
    return { layout: lay, arr: at, t: tr, f: fr, top: box.top, full: box.bottom - EDGE, hug, x, vw: window.innerWidth, coarse: live.current.coarse };
  };

  const onMove = useRef(null);
  const onUp = useRef(null);
  onMove.current = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const r = dragLayout(d.start, d.id, e.clientX - d.x0, e.clientY - d.y0);
    d.layout = r.layout;
    if (r.flip) {
      // The other arrangement, carrying on from here with the edge that's now
      // under the pointer; the card slides over from where it shows (a slide
      // still running ends first, so the new start is measured at rest).
      const f = filesRef.current;
      const from = f && rectOf(f);
      f?.getAnimations?.().forEach((a) => a.cancel());
      applyLayout(frameRef.current, r.layout, fit());
      d.id = r.flip;
      d.start = measure(e.clientX, r.layout) || d.start;
      d.x0 = e.clientX;
      d.y0 = e.clientY;
      document.body.style.setProperty('--sbf-drag-cursor', CURSOR[kindOf(r.flip)]);
      slide(from, { quiet: true });
      setHeld(r.flip);
      setDragArr(r.layout.arr);
    } else {
      applyLayout(frameRef.current, r.layout, fit());
    }
    showGuide(r.align);
    place();
  };
  onUp.current = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    window.removeEventListener('pointermove', moveListener);
    window.removeEventListener('pointerup', upListener);
    window.removeEventListener('pointercancel', upListener);
    document.body.classList.remove('sbf-sizing');
    document.body.style.removeProperty('--sbf-drag-cursor');
    showGuide(null);
    setHeld(null);
    setDragArr(null);
    live.current.onLayout?.(d.layout, { commit: true });
  };
  // Stable, so they can be taken off the window again.
  const [moveListener] = useState(() => (e) => onMove.current?.(e));
  const [upListener] = useState(() => (e) => onUp.current?.(e));
  // Gone mid-drag (the sidebar collapsed under it): what it sized is kept, so
  // the cards and App agree when it opens again.
  useEffect(() => () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    window.removeEventListener('pointermove', moveListener);
    window.removeEventListener('pointerup', upListener);
    window.removeEventListener('pointercancel', upListener);
    document.body.classList.remove('sbf-sizing');
    document.body.style.removeProperty('--sbf-drag-cursor');
    live.current.onLayout?.(d.layout, { commit: true });
  }, [moveListener, upListener]);

  const onPointerDown = (e, id, kind) => {
    if (e.button !== 0 || dragRef.current) return;
    const start = measure(e.clientX, layout);
    if (!start) return;
    e.preventDefault();
    dragRef.current = { id, start, x0: e.clientX, y0: e.clientY, layout };
    setHeld(id);
    document.body.classList.add('sbf-sizing');
    document.body.style.setProperty('--sbf-drag-cursor', CURSOR[kind]);
    window.addEventListener('pointermove', moveListener);
    window.addEventListener('pointerup', upListener);
    window.addEventListener('pointercancel', upListener);
  };
  const onKeyDown = (e, id, kind) => {
    const start = measure(0, layout);
    const next = start && keyLayout(start, id, kind, e.key, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    sizeAtOnce(frameRef.current);
    onLayout?.(next, { commit: true });
  };

  return (
    <div className="sbf-handles" ref={layerRef}>
      {handleList(arr).map((h) => (
        <div key={h.id} data-handle={h.id}
             className={`sbf-handle is-${h.kind}${held === h.id ? ' is-held' : ''}`}
             role={h.focus ? 'separator' : undefined}
             aria-orientation={h.focus ? (h.kind === 'v' ? 'vertical' : 'horizontal') : undefined}
             aria-label={h.focus ? h.label : undefined}
             aria-hidden={h.focus ? undefined : 'true'}
             tabIndex={h.focus ? 0 : -1}
             title={`${h.label} · double-click to put it back`}
             onPointerDown={(e) => onPointerDown(e, h.id, h.kind)}
             onDoubleClick={() => { sizeAtOnce(frameRef.current); onLayout?.(resetLayout(layout, arr, h.id), { commit: true }); }}
             onKeyDown={h.focus ? (e) => onKeyDown(e, h.id, h.kind) : undefined}>
          {h.kind === 'corner' && (
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d={ARC} /></svg>
          )}
        </div>
      ))}
      <div className="sbf-guide" ref={guideRef} aria-hidden="true" />
    </div>
  );
}
