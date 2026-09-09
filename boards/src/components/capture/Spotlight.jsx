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
    // The off-screen start value, reused as "not in the picture right now". A
    // fade-out would be capturable in its own right; this is instant and needs
    // no CSS.
    const park = () => { posRef.current = { x: -9999, y: -9999 }; schedule(); };

    // Is this pointer event part of the SHOT?
    //
    // This layer is the one capture surface that deliberately does not portal
    // to <body> — it renders inside #root so restrictTo(#root) films it, because
    // the drawn cursor is content. But it listened to every window pointer
    // event with no filter, so pressing a control on the capture panel painted
    // a gold ripple into the video: the tool leaving a mark that says a person
    // was operating the recorder. A class check on the HUD would not be enough
    // — restricting to #root also excludes every modal and the command palette,
    // so a press in one of those is equally not in the picture. Membership of
    // the filmed subtree is the actual question, so ask it directly.
    const inShot = (e) => {
      const root = document.getElementById('root');
      return !!(root && e.target instanceof Node && root.contains(e.target));
    };

    const onMove = (e) => {
      if (!inShot(e)) return park();
      posRef.current = { x: e.clientX, y: e.clientY };
      schedule();
    };

    // A finger that lifts is a pointer that no longer exists. On touch,
    // pointermove only fires while contact is down, so without this the dot
    // stayed exactly where the last tap landed — for the rest of the shoot,
    // burned into every OS screenshot and every frame of an OS recording. The
    // mouse exclusion is required: a mouse fires pointerup after every click,
    // and parking there would blink the cursor away on a desk.
    const onUp = (e) => { if (e.pointerType !== 'mouse') park(); };

    const onDown = (e) => {
      if (!inShot(e)) return;
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
    const opts = { capture: true, passive: true };
    window.addEventListener('pointermove', onMove, opts);
    window.addEventListener('pointerdown', onDown, opts);
    window.addEventListener('pointerup', onUp, opts);
    window.addEventListener('pointercancel', onUp, opts);
    return () => {
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointerup', onUp, { capture: true });
      window.removeEventListener('pointercancel', onUp, { capture: true });
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
