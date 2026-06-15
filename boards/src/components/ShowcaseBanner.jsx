// ShowcaseBanner — the welcome card shown over the canvas while a welcome_showcase
// arm-B user still has the seeded demo board present. It introduces the app and
// gives one obvious action: "Start fresh" → onClear (deleteCards, a single undoable
// step + Undo toast) wipes the demo so they can build their own. A quiet "×" hides
// it for users who want to explore the demo first. Presentational; no emoji.
//
// The parent suppresses the onboarding coachmark while this is up (App.jsx
// showCoachmark gate) so the two never stack.

import { useEffect, useState } from 'react';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

export function ShowcaseBanner({ onClear }) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try { logEventOnce('showcase_view', EV.ONBOARDING_SHOWCASE_VIEW); } catch (_) { /* analytics best-effort */ }
  }, []);

  if (dismissed) return null;

  return (
    <div className="cnv-showcase-banner" role="status">
      <button
        type="button"
        className="cnv-showcase-banner-x"
        aria-label="Explore the demo first"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
      <div className="cnv-showcase-banner-title">Welcome to Soleil Clusters</div>
      <p className="cnv-showcase-banner-text">
        An infinite canvas for collecting and arranging your ideas — images, notes,
        and links, all on one board. This is a quick demo of what you can build.
      </p>
      <button
        type="button"
        className="cnv-showcase-banner-btn"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onClear}
      >
        Start fresh
      </button>
      <span className="cnv-showcase-banner-sub">Clears the demo so you can start your own.</span>
    </div>
  );
}
