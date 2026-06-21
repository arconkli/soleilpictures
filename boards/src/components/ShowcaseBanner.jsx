// ShowcaseBanner — the welcome card shown over the canvas while a welcome_showcase
// arm-B user still has the seeded demo board present. It introduces the app and
// gives one obvious action: "Start fresh" → onClear (deleteCards, a single undoable
// step + Undo toast) wipes the demo so they can build their own. A quiet "×" hides
// it for users who want to explore the demo first. Presentational; no emoji.
//
// The parent suppresses the onboarding coachmark while this is up (App.jsx
// showCoachmark gate) so the two never stack.

import { useEffect, useRef, useState } from 'react';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { journey } from '../lib/journey.js';

export function ShowcaseBanner({ onClear, boardId }) {
  const [dismissed, setDismissed] = useState(false);
  const startedAtRef = useRef(Date.now());
  const resolvedRef = useRef(false);   // true once the user clears the demo

  useEffect(() => {
    try { logEventOnce('showcase_view', EV.ONBOARDING_SHOWCASE_VIEW); } catch (_) { /* analytics best-effort */ }
    // Post-signup journey: the arm-B showcase had no abandonment signal. If the
    // user hides the tab without ever clearing the demo, beacon a final
    // onboarding_showcase_abandon so the trace shows where they bounced.
    const onHide = () => {
      if (document.visibilityState !== 'hidden' || resolvedRef.current) return;
      resolvedRef.current = true;   // fire once
      try { journey(EV.ONBOARDING_SHOWCASE_ABANDON, { board_id: boardId, ms: Date.now() - startedAtRef.current }, { now: true }); } catch (_) {}
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [boardId]);

  const handleClear = async () => {
    resolvedRef.current = true;   // cleared → not an abandon
    try { await onClear?.(); } catch (_) {}
  };

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
        onClick={handleClear}
      >
        Start fresh
      </button>
      <span className="cnv-showcase-banner-sub">Clears the demo so you can start your own.</span>
    </div>
  );
}
