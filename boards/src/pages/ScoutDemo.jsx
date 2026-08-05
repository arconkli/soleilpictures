// The /scout hero: a self-contained, replayable demo of the whole product.
//
// Left, a phone thread. Right, a canvas. Press send and watch photos fly out of
// the message and settle into a titled grid. That IS the product, so showing it
// beats describing it — and it works with no signup, no video file, and no
// network.
//
// Deliberately NOT a video: it autoplays inline on mobile without eating 4MB,
// it stays crisp at any width, and a visitor can replay the interesting second
// as many times as they like. Everything is CSS transforms on ~14 nodes, so it
// stays cheap even on a mid-range phone.
//
// Accessibility: the whole thing is decorative — the same content exists as
// crawlable prose in the page's `steps` and `sections`. It's aria-hidden, the
// control is a real <button>, and prefers-reduced-motion skips straight to the
// end state instead of animating.

import { useCallback, useEffect, useRef, useState } from 'react';
import './scoutDemo.css';

// Fake photos. Solid gradients rather than real images: no asset weight, no
// licensing, no layout shift, and the point being made is about ARRANGEMENT.
const PHOTOS = [
  { id: 'p1', from: 'var(--sc-a)', to: 'var(--sc-b)', w: 2, h: 2 },
  { id: 'p2', from: 'var(--sc-b)', to: 'var(--sc-c)', w: 1, h: 1 },
  { id: 'p3', from: 'var(--sc-c)', to: 'var(--sc-a)', w: 1, h: 1 },
  { id: 'p4', from: 'var(--sc-d)', to: 'var(--sc-b)', w: 1, h: 2 },
  { id: 'p5', from: 'var(--sc-a)', to: 'var(--sc-d)', w: 2, h: 1 },
];

const PHASES = { IDLE: 0, SENT: 1, LANDING: 2, TITLED: 3, REPLIED: 4 };

export default function ScoutDemo() {
  const [phase, setPhase] = useState(PHASES.IDLE);
  const timers = useRef([]);
  const reduced = useRef(false);

  useEffect(() => {
    try {
      reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) { /* default to animating */ }
    return () => { timers.current.forEach(clearTimeout); };
  }, []);

  const run = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (reduced.current) { setPhase(PHASES.REPLIED); return; }
    setPhase(PHASES.IDLE);
    const at = (ms, p) => timers.current.push(setTimeout(() => setPhase(p), ms));
    at(60, PHASES.SENT);
    at(700, PHASES.LANDING);
    at(1600, PHASES.TITLED);
    at(2300, PHASES.REPLIED);
  }, []);

  // Play once, when it comes into view. Firing before the visitor has looked at
  // it wastes the one moment that sells the product — but waiting too long is
  // worse, because on a 900px laptop the hero pushes this to y≈855 and a strict
  // threshold means it never plays at all. A low threshold plus a negative
  // bottom margin means it starts as the demo crosses into the viewport, so
  // it's mid-animation exactly as the visitor arrives at it.
  const rootRef = useRef(null);
  const played = useRef(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { run(); return undefined; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !played.current) { played.current = true; run(); io.disconnect(); }
      }
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [run]);

  const started = phase >= PHASES.SENT;
  const landed = phase >= PHASES.LANDING;

  return (
    <figure className="scout-demo" ref={rootRef} id="live-example">
      <div className="scout-demo-stage" aria-hidden="true">
        {/* ── Phone ── */}
        <div className="scout-phone">
          <div className="scout-phone-bar">
            <span className="scout-phone-dot" />
            <span className="scout-phone-name">Soleil Scout</span>
          </div>
          <div className="scout-thread">
            <div className={`scout-bubble scout-bubble-out${started ? ' is-sent' : ''}`}>
              <div className="scout-bubble-photos">
                {PHOTOS.map((p) => (
                  <span
                    key={p.id}
                    className={`scout-chip${landed ? ' is-gone' : ''}`}
                    style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
                  />
                ))}
              </div>
              <span className="scout-bubble-text">Location scout for Scene 4 diner</span>
            </div>

            <div className={`scout-bubble scout-bubble-in${phase >= PHASES.REPLIED ? ' is-shown' : ''}`}>
              <b>Got it — 5 photos → Scene 4 — Diner</b>
              <span className="scout-link">soleil.co/s/aB9x</span>
            </div>
          </div>
        </div>

        {/* ── Canvas ── */}
        <div className="scout-canvas">
          <div className="scout-canvas-bar">
            <span className="scout-canvas-dots"><i /><i /><i /></span>
            <span className="scout-canvas-url">clusters.soleilpictures.com</span>
          </div>
          <div className="scout-canvas-body">
            <div className={`scout-section-label${phase >= PHASES.TITLED ? ' is-shown' : ''}`}>
              Scene 4 — Diner
            </div>
            <div className="scout-grid">
              {PHOTOS.map((p, i) => (
                <span
                  key={p.id}
                  className={`scout-card${landed ? ' is-landed' : ''}`}
                  style={{
                    background: `linear-gradient(135deg, ${p.from}, ${p.to})`,
                    gridColumn: `span ${p.w}`,
                    gridRow: `span ${p.h}`,
                    transitionDelay: landed ? `${i * 90}ms` : '0ms',
                  }}
                />
              ))}
              <span className={`scout-note${phase >= PHASES.TITLED ? ' is-landed' : ''}`}>
                Check the power drops
              </span>
            </div>
          </div>
        </div>
      </div>

      <figcaption className="scout-demo-cap">
        <span>Five photos and a sentence, from a parking lot.</span>
        <button type="button" className="scout-replay" onClick={run}>
          Replay
        </button>
      </figcaption>
    </figure>
  );
}
