// ShowcaseBanner — the "this is a demo" chip shown over the canvas while a
// welcome_showcase arm-B user still has the seeded showcase cards present. Its
// button is the "try it yourself" CTA: one click hands off to the parent's
// onClear (→ deleteCards, a single undoable step + Undo toast) so the user can
// clear the demo and start their own. Presentational only; no emoji in the copy.
//
// Mirrors OnboardingCoachmark's role=status pill. The parent suppresses the
// coachmark while this is up (App.jsx showCoachmark gate) so the two never stack.

import { useEffect } from 'react';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

export function ShowcaseBanner({ onClear }) {
  useEffect(() => {
    try { logEventOnce('showcase_view', EV.ONBOARDING_SHOWCASE_VIEW); } catch (_) { /* analytics best-effort */ }
  }, []);

  return (
    <div className="cnv-showcase-banner" role="status">
      <span className="cnv-showcase-banner-text">
        This is a demo of what you can build with Soleil Clusters.
      </span>
      <button
        type="button"
        className="cnv-showcase-banner-btn"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onClear}
      >
        Clear &amp; try it yourself
      </button>
    </div>
  );
}
