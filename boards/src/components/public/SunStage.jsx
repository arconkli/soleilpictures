// The search pages' picture of a real board in the new look: the Clusters
// mark, big, holding that board's own cards (cut out of its live /c/ page).
// Which page gets which treatment, and where every card sits, is in
// lib/landingStage.js; this only draws it.
//
//   <SunStage mode="full" slug=… imgAlt=… />    the stage is the picture
//   <SunStage mode="behind" slug=…>{frame}</SunStage>
//                                               today's browser frame, kept
//                                               as it is, with the suns and
//                                               three cards behind and around it
//
// Motion is CSS: the suns rise, the ring's dashes arrive, the cards settle in
// once the stage scrolls into view, and on a mouse they drift a little with
// the pointer. Nothing moves under prefers-reduced-motion, and without script
// (a crawler, a failed chunk) everything simply sits in its final place: the
// hidden "before" state is only ever set by script, right before it animates.

import { useLayoutEffect, useRef, useState } from 'react';
import { sunMarkSvg, MARK_MID } from '../../lib/sunMark.js';
import { FULL_LAYOUT, BEHIND_LAYOUT, stageCards } from '../../lib/landingStage.js';
import './sunStage.css';

const MX = MARK_MID[0] / 2048, MY = MARK_MID[1] / 2048;
const pct = (n) => `${n}%`;

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; }
}

// The cards' inline custom properties: desktop always, phone when it has one.
function cardStyle(c, i) {
  const [x, y, w, r] = c.desk;
  const s = { '--x': pct(x), '--y': pct(y), '--w': `${w}cqw`, '--r': `${r}deg`, '--i': i };
  if (c.phone) {
    const [px, py, pw, pr] = c.phone;
    Object.assign(s, { '--px': pct(px), '--py': pct(py), '--pw': `${pw}cqw`, '--pr': `${pr}deg` });
  }
  return s;
}

// Where the mark goes. FULL: [left %, top %, width %] of the stage box.
// BEHIND: [left %, centre-y offset (cqw), width %] around the frame's middle.
function markPlace(mode, [l, t, w]) {
  const cx = l + MX * w;                        // the ring's middle, % of width
  return {
    ml: pct(l),
    mw: `${w}cqw`,
    mt: mode === 'full' ? pct(t) : `calc(50% + ${(t - MY * w).toFixed(2)}cqw)`,
    // The glow is centred on the ring's middle.
    gx: pct(cx.toFixed(2)),
    gy: mode === 'full' ? `calc(${t}% + ${(MY * w).toFixed(2)}cqw)` : `calc(50% + ${t}cqw)`,
    gw: `${(w * (mode === 'full' ? 1.9 : 1.3)).toFixed(1)}cqw`,
  };
}

// Every name spelled out, so the stylesheet token check can see them set.
function markStyle(mode, m) {
  const d = markPlace(mode, m.desk);
  const p = markPlace(mode, m.phone);
  return {
    '--ml': d.ml, '--mt': d.mt, '--mw': d.mw, '--gx': d.gx, '--gy': d.gy, '--gw': d.gw,
    '--pml': p.ml, '--pmt': p.mt, '--pmw': p.mw, '--pgx': p.gx, '--pgy': p.gy, '--pgw': p.gw,
  };
}

export function SunStage({ mode, slug, imgAlt = '', children = null }) {
  const layout = mode === 'behind' ? BEHIND_LAYOUT : FULL_LAYOUT;
  const cards = stageCards(slug, layout);
  const rootRef = useRef(null);
  // 'still' = drawn in its final place (no script yet, or no motion wanted);
  // 'wait' = hidden, about to rise; 'in' = rising / risen.
  const [phase, setPhase] = useState('still');

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || reducedMotion() || typeof IntersectionObserver === 'undefined') return undefined;
    setPhase('wait');
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setPhase('in'); io.disconnect(); }
    }, { rootMargin: '0px 0px -12% 0px' });
    io.observe(el);
    // Pointer drift, mice and trackpads only.
    let fine = false;
    try { fine = window.matchMedia('(pointer: fine)').matches; } catch { /* no drift */ }
    if (!fine) return () => io.disconnect();
    let raf = 0;
    const els = () => el.querySelectorAll('.sun-card');
    const onMove = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - r.left) / r.width - 0.5, dy = (e.clientY - r.top) / r.height - 0.5;
        for (const c of els()) {
          const d = Number(c.dataset.depth) || 1;
          c.style.setProperty('--dx', `${(dx * d * 14).toFixed(1)}px`);
          c.style.setProperty('--dy', `${(dy * d * 10).toFixed(1)}px`);
        }
      });
    };
    const onLeave = () => { for (const c of els()) { c.style.removeProperty('--dx'); c.style.removeProperty('--dy'); } };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  const mark = (
    <>
      <span className="sun-glow" aria-hidden="true" />
      <svg className="sun-mark" viewBox="0 0 2048 2048" aria-hidden="true" focusable="false"
           dangerouslySetInnerHTML={{ __html: sunMarkSvg({ id: `sun${mode}` }) }} />
    </>
  );
  const cardEls = cards.map((c, i) => (
    <div key={c.role} className={`sun-card${c.over ? ' is-over' : ''}${c.phone ? '' : ' is-desk'}`}
         style={cardStyle(c, i)} data-depth={c.depth}>
      {/* The first picture under the suns carries the board's name for image
          search; the rest are decoration. */}
      <img src={c.src} width={c.w} height={c.h} loading="lazy" decoding="async"
           alt={mode === 'full' && c.role === 'c1' ? imgAlt : ''} />
    </div>
  ));
  const cls = `sun-${mode} sun-${phase}`;

  if (mode === 'behind') {
    return (
      <div ref={rootRef} className={cls} style={markStyle('behind', layout.mark)}>
        <div className="sun-deco" aria-hidden="true">{mark}</div>
        {children}
        <div className="sun-cards" aria-hidden="true">{cardEls}</div>
      </div>
    );
  }
  return (
    <div ref={rootRef} className={cls} style={markStyle('full', layout.mark)}>
      {mark}
      {cardEls}
    </div>
  );
}

// The full stage as the page's picture of a real board: the stage links to the
// live board, and under it the board's address and the same caption the old
// browser frame carried. The pill is the one link a keyboard or screen reader
// meets; the stage is the same door for a pointer.
export function SunStageFigure({ slug, title, onOpen, figRef, id }) {
  const href = `/c/${slug}`;
  return (
    <figure className="seo-stage" id={id} ref={figRef}>
      <a className="seo-stage-link" href={href} onClick={onOpen} tabIndex={-1} aria-hidden="true">
        <SunStage mode="full" slug={slug} imgAlt={`${title} — a real board made with Clusters`} />
      </a>
      <figcaption className="seo-stage-cap">
        <a className="seo-stage-pill" href={href} onClick={onOpen}>
          <span className="seo-stage-url">clusters.soleilpictures.com/c/{slug}</span>
          <span className="seo-stage-open">Open it live →</span>
        </a>
        <span className="seo-stage-note">This is a real board published from Clusters — <b>open it live</b>, pan around, and copy its palettes.</span>
      </figcaption>
    </figure>
  );
}
