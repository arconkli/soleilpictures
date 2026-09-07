// Spotlight — make your own pointer legible in a recording.
//
// A screen recording does not capture the OS cursor on every platform, and even
// where it does, a 12px arrow is invisible once the video has been scaled down
// to a phone-sized feed. Every product demo worth watching draws its own
// pointer and flashes a ring on click, because otherwise the viewer sees things
// happening with no visible cause.
//
// Performance note, because this runs during every take: pointer position is
// written to a REF and flushed to `style.transform` inside one rAF. Putting it
// in React state would re-render this component — and anything sharing its
// parent — at pointer rate, which is exactly the sort of thing that turns up as
// a stutter in the finished video and nowhere else.
import { useEffect, useRef } from 'react';

// Ripples clean themselves up on animationend, but a dropped animation event
// (backgrounded tab, reduced motion) would leak nodes for the length of a
// shoot. Hard cap as a backstop.
const MAX_RIPPLES = 6;

export function Spotlight() {
  const dotRef = useRef(null);
  const rippleHostRef = useRef(null);
  const posRef = useRef({ x: -9999, y: -9999 });
  const rafRef = useRef(0);

  useEffect(() => {
    const flush = () => {
      rafRef.current = 0;
      const el = dotRef.current;
      if (!el) return;
      const { x, y } = posRef.current;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    };
    const schedule = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(flush);
    };

    const onMove = (e) => {
      posRef.current = { x: e.clientX, y: e.clientY };
      schedule();
    };

    const onDown = (e) => {
      const host = rippleHostRef.current;
      if (!host) return;
      while (host.childElementCount >= MAX_RIPPLES) host.removeChild(host.firstChild);
      const r = document.createElement('span');
      r.className = 'capture-spot-ripple';
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      r.addEventListener('animationend', () => r.remove(), { once: true });
      host.appendChild(r);
    };

    // Capture phase and passive: this must observe every pointer event without
    // being able to interfere with one. A capture-mode overlay that swallowed a
    // click would make the app unusable in exactly the moment it is being
    // filmed.
    window.addEventListener('pointermove', onMove, { capture: true, passive: true });
    window.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerdown', onDown, { capture: true });
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="capture-spot" aria-hidden="true">
      <div ref={rippleHostRef} className="capture-spot-ripples" />
      <div ref={dotRef} className="capture-spot-dot" />
    </div>
  );
}
