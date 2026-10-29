// The search pages' picture of a real board in the new look: that board's own
// cards (cut out of its live /c/ page) with the logo's feel around them, the
// mark's dashed ring opened into orbits and its suns gliding along them
// (lib/sunArt.js). Which page gets which treatment, and where every card sits,
// is in lib/landingStage.js; this only draws it.
//
//   <SunStage mode="full" slug=… imgAlt=… />    the stage is the picture
//   <SunStage mode="behind" slug=…>{frame}</SunStage>
//                                               today's browser frame, kept
//                                               as it is, with the orbits
//                                               behind it and three cards
//                                               over its edges
//
// The art always sits behind the cards: the cards are the real board.
// Motion: once the stage scrolls into view the rings turn in, the suns glide
// along their orbits into place (SMIL, started here and only here) and the
// cards settle; on a mouse the cards drift a little with the pointer. Nothing
// moves under prefers-reduced-motion, and without script (a crawler, a failed
// chunk) everything simply sits in its final place: the hidden "before" state
// is only ever set by script, right before it animates.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ORBIT_ART, orbitArtSvg, orbitArtWidth } from '../../lib/sunArt.js';
import { FULL_LAYOUT, BEHIND_LAYOUT, stageCards } from '../../lib/landingStage.js';
import './sunStage.css';

const pct = (n) => `${n}%`;

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; }
}

// The cards' inline custom properties: desktop always, phone when it has one.
// Behind a frame the cards' layer is wider than the frame (sunStage.css), so
// across they are placed from its middle in cqw, which are the frame's.
function cardStyle(c, i, behind) {
  const across = (x) => (behind ? `calc(50% + ${(x - 50).toFixed(2)}cqw)` : pct(x));
  const [x, y, w, r] = c.desk;
  const s = { '--x': across(x), '--y': pct(y), '--w': `${w}cqw`, '--r': `${r}deg`, '--i': i };
  if (c.phone) {
    const [px, py, pw, pr] = c.phone;
    Object.assign(s, { '--px': across(px), '--py': pct(py), '--pw': `${pw}cqw`, '--pr': `${pr}deg` });
  }
  return s;
}

// One piece of art: desktop (`is-desk`) or phone (`is-phone`), the stylesheet
// shows one. Behind a frame it is centred on the frame and sized against it.
function Art({ kind, cls }) {
  const [w, h] = ORBIT_ART[kind].box;
  const style = kind.startsWith('behind') ? { width: `${orbitArtWidth(kind)}cqw` } : undefined;
  return (
    <svg className={`sun-art ${cls}`} viewBox={`0 0 ${w} ${h}`} style={style}
         aria-hidden="true" focusable="false"
         dangerouslySetInnerHTML={{ __html: orbitArtSvg(kind, { id: `oa${kind}` }) }} />
  );
}

export function SunStage({ mode, slug, imgAlt = '', children = null }) {
  const layout = mode === 'behind' ? BEHIND_LAYOUT : FULL_LAYOUT;
  const cards = stageCards(slug, layout);
  const rootRef = useRef(null);
  // 'still' = drawn in its final place (no script yet, or no motion wanted);
  // 'wait' = hidden, about to arrive; 'in' = arriving / arrived.
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

  // The suns' glides start with the rest of the motion. They hold still for
  // their delay while the stylesheet fades them in over the same time.
  useEffect(() => {
    if (phase !== 'in') return;
    for (const a of rootRef.current?.querySelectorAll('animateMotion') || []) {
      try { a.beginElement(); } catch { /* no SMIL: the sun is already in place */ }
    }
  }, [phase]);

  const art = mode === 'behind'
    ? <><Art kind="behind" cls="is-desk" /><Art kind="behindPhone" cls="is-phone" /></>
    : <><Art kind="full" cls="is-desk" /><Art kind="phone" cls="is-phone" /></>;
  const cardEls = cards.map((c, i) => (
    <div key={c.role} className={`sun-card${c.over ? ' is-over' : ''}${c.phone ? '' : ' is-desk'}`}
         style={cardStyle(c, i, mode === 'behind')} data-depth={c.depth}>
      {/* The first picture carries the board's name for image search; the
          rest are decoration. */}
      <img src={c.src} width={c.w} height={c.h} loading="lazy" decoding="async"
           alt={mode === 'full' && c.role === 'c1' ? imgAlt : ''} />
    </div>
  ));
  const cls = `sun-${mode} sun-${phase}`;

  if (mode === 'behind') {
    return (
      <div ref={rootRef} className={cls}>
        <div className="sun-deco" aria-hidden="true">{art}</div>
        {children}
        <div className="sun-cards" aria-hidden="true">{cardEls}</div>
      </div>
    );
  }
  return (
    <div ref={rootRef} className={cls}>
      {art}
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
