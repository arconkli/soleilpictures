// Soleil Clusters wordmark — cluster mark + "CLUSTERS" in Brandon Grotesque
// uppercase. The mark is a PNG with a light/dark variant; we swap based on the
// active data-theme attribute so the dashed-orbit stays legible on either bg.
//   size="display"  → ~56px font + ~64px mark (auth screen, branded pages)
//   size="block"    → 24px (sidebar brand area)
//
// For display size, font + mark + gap use clamp() so the whole composite
// shrinks proportionally below ~480px viewport width. Prevents the
// wordmark from clipping on phones (393px iPhone, 360px small Android).
//
// Font-load layout fix: Brandon Grotesque loads async from Adobe Typekit
// with the default font-display: swap. The initial layout pass uses the
// fallback chain (Impact, sans-serif) — Impact is materially narrower
// than Brandon — and when the webfont swaps in, Chrome and Safari do NOT
// re-flow inline-flex children. The span's layout width stays at the
// fallback's narrower value while the painted glyphs render at Brandon's
// true width, overflowing the span ~50px on the right and pushing the
// painted composite well past the card centerline.
//
// We can't reliably fix this by re-keying the React tree (cached font
// loads complete before mount, so the swap never fires a state change),
// and CSS-only tracking compensation breaks any time the fallback ↔
// webfont width differential changes. Instead we measure the painted
// glyph extent vs the bbox at mount + on every font load + on resize,
// and translate the wordmark by exactly the offset needed to put the
// painted centroid on the card center. Brittle in theory but exact in
// practice — no math, just measure-and-correct.
import { useEffect, useRef, useState } from 'react';

export function SoleilWordmark({ size = 'display', color = 'var(--ink-0)' }) {
  const isDisplay = size === 'display';
  // clamp(min, fluid, max): below ~430px we scale toward 36px, above 700px we cap at 56px.
  const fontSize = isDisplay ? 'clamp(32px, 9.4vw, 56px)' : 24;
  const tracking = isDisplay ? '0.18em' : '0.16em';
  const markSize = isDisplay ? 'clamp(36px, 10.8vw, 64px)' : 28;
  const gap = isDisplay ? 'clamp(8px, 2.4vw, 14px)' : 8;

  const wordmarkRef = useRef(null);
  const textRef = useRef(null);
  const [shiftPx, setShiftPx] = useState(0);

  useEffect(() => {
    if (!isDisplay) return;
    if (typeof document === 'undefined') return;
    let cancelled = false;
    function measure() {
      if (cancelled) return;
      const wm = wordmarkRef.current;
      const txt = textRef.current;
      if (!wm || !txt) return;
      // Find the actual painted glyph right edge via Range API — this
      // reflects the rendered font's real metrics even when the span's
      // bbox is stuck on fallback-font metrics.
      const range = document.createRange();
      range.selectNodeContents(txt);
      const rects = Array.from(range.getClientRects());
      if (!rects.length) return;
      const glyphR = Math.max(...rects.map(r => r.right));
      const wmRect = wm.getBoundingClientRect();
      // Bbox right is what flex centering thinks the composite ends at.
      // Glyph right is where the eye actually sees it end. Their delta is
      // exactly the rightward visual overflow we need to compensate for.
      const overflowRight = glyphR - wmRect.right;
      // Translate the wordmark left by half the overflow so the painted
      // composite (icon left → glyph right) is centered around the same
      // axis the parent flex centering chose for the bbox.
      const targetShift = -overflowRight / 2;
      // Use 0.1px deadband to avoid feedback loops from sub-pixel drift.
      setShiftPx(prev => Math.abs(prev - targetShift) < 0.1 ? prev : targetShift);
    }
    // Measure now, after the next frame, and again after fonts settle —
    // each catches a different timing case (cold load, warm cache, async
    // font swap).
    measure();
    const raf = requestAnimationFrame(measure);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (cancelled) return;
        // Two RAFs to let the font swap actually paint before measuring.
        requestAnimationFrame(() => requestAnimationFrame(measure));
      });
    }
    // Re-measure on resize so the clamp() font-size changes don't break
    // the alignment.
    window.addEventListener('resize', measure);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, [isDisplay, fontSize, tracking, markSize, gap]);

  return (
    <div
      ref={wordmarkRef}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap,
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize,
        textTransform: 'uppercase',
        letterSpacing: tracking,
        color,
        lineHeight: 1,
        maxWidth: '100%',
        transform: shiftPx ? `translateX(${shiftPx}px)` : undefined,
      }}
    >
      <ClustersMark size={markSize} />
      <span ref={textRef} style={{ whiteSpace: 'nowrap', minWidth: 0 }}>Clusters</span>
    </div>
  );
}

// Theme-aware cluster mark. Renders both PNG variants and lets CSS show the
// right one — keeps things synchronous when the theme bootstrap script flips
// data-theme before React mounts.
export function ClustersMark({ size = 28 }) {
  return (
    <span
      className="clusters-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img src="/clusters-logo-dark.webp" alt="" className="clusters-mark-img clusters-mark-dark" />
      <img src="/clusters-logo-light.webp" alt="" className="clusters-mark-img clusters-mark-light" />
    </span>
  );
}
