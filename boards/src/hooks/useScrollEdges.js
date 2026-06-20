// Toggles `fade-top` / `fade-bottom` classes on a scrollable element so CSS can
// fade an edge ONLY when there's hidden content in that direction. A static
// mask would fade short, non-scrolling lists too (which looks wrong) — this
// keeps the fade honest.
//
// Recomputes on: element scroll, viewport resize (ResizeObserver), and content
// changes (MutationObserver, childList+subtree) — the last so expanding the
// board tree or collapsing a section re-evaluates without a React re-render.
// All recomputes are rAF-batched; the work is a cheap 3-property layout read.
import { useEffect } from 'react';

export function useScrollEdges(ref) {
  useEffect(() => {
    const el = ref?.current;
    if (!el) return;

    let raf = 0;
    const apply = () => {
      raf = 0;
      const { scrollTop, scrollHeight, clientHeight } = el;
      const max = scrollHeight - clientHeight;
      // 1px tolerance absorbs sub-pixel rounding so the fade doesn't flicker
      // at the exact top/bottom.
      el.classList.toggle('fade-top', scrollTop > 1);
      el.classList.toggle('fade-bottom', scrollTop < max - 1);
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(apply);
    };

    apply();
    el.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);

    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(schedule);
      ro.observe(el);
    }
    // Observe childList/subtree (NOT attributes) so toggling our own fade
    // classes can't re-trigger the observer — no feedback loop.
    let mo = null;
    if (typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver(schedule);
      mo.observe(el, { childList: true, subtree: true });
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [ref]);
}
