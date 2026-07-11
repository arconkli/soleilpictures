import { useEffect, useRef, useState } from 'react';
import { OnboardingTour } from '../components/OnboardingTour.jsx';
import { useOnboardingTour } from '../hooks/useOnboardingTour.js';

// Dev-only harness for ?tourqa=1. Renders the real <OnboardingTour> driven by
// the real engine over fake data-tour anchors laid out like the real app (a
// left tool rail, a top breadcrumb, a mid-canvas cluster card), inside a
// .canvas-wrap so the canvas-region centering is exercised — isolated from
// Supabase. Exposes window.__soleilTourTest = { fire, skip, getState, getEmitted }
// so Playwright (tests/onboarding-tour.spec.js) can drive + assert. DEV only.
export function TourQaHarness() {
  const emittedRef = useRef([]);
  const actionsRef = useRef([]);   // touchAction taps (e.g. 'pick_photos')
  // Toggleable so tests can exercise the list step's unanchored Got-it
  // fallback (ctaWhenUnanchored) by hiding the fake view toggle.
  const [showViewToggle, setShowViewToggle] = useState(true);
  const sinks = useRef({
    persist: () => {},
    emit: (e) => { emittedRef.current.push(e); },
  }).current;

  const tour = useOnboardingTour({
    onboarding: {},
    persist: sinks.persist,
    emit: sinks.emit,
    enabled: true,
  });

  const ref = useRef(tour);
  ref.current = tour;

  useEffect(() => {
    window.__soleilTourTest = {
      fire: (e) => ref.current.fire(e),
      skip: () => ref.current.skip(),
      getState: () => ref.current.state,
      getEmitted: () => emittedRef.current.slice(),
      getActions: () => actionsRef.current.slice(),
      setViewToggleVisible: (v) => setShowViewToggle(!!v),
    };
    const root = document.getElementById('root');
    if (root) root.setAttribute('data-tourqa-ready', '1');
  }, []);

  return (
    <div className="canvas-wrap" style={{ position: 'fixed', inset: 0 }}>
      <div id="tourqa-ready" style={{ position: 'fixed', top: 4, left: 4, fontSize: 10, color: '#888' }}>
        tourqa ready
      </div>
      {/* breadcrumb (nav anchor) */}
      <div className="crumbs" data-tour="nav" style={{ position: 'fixed', top: 10, left: '42%' }}>Studio ›</div>
      {/* left tool rail (the container is the 'rail' anchor for the final step) */}
      <div className="cnv-tools" data-tour="rail" style={{ position: 'fixed', left: 14, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="cnv-tool" data-tour="cluster-tool" style={{ width: 30, height: 30 }}>C</div>
        <div className="cnv-tool" data-tour="image-tool" style={{ width: 30, height: 30 }}>I</div>
      </div>
      {/* a cluster card mid-canvas (rename/open anchor) */}
      <div className="bc" data-tour="cluster-card" style={{ position: 'fixed', top: '42%', left: '55%', width: 140, height: 100, border: '1px solid #888', borderRadius: 8 }}>Cluster</div>
      {/* topbar view toggle (the 'view-toggle' anchor for the final list step) */}
      {showViewToggle && (
        <div className="view-pill" style={{ position: 'fixed', top: 8, left: '58%' }}>
          <button type="button" className="view-pill-btn" data-tour="view-toggle"
                  onClick={() => ref.current.fire({ type: 'view_switched', view: 'list' })}>
            List
          </button>
        </div>
      )}
      <OnboardingTour
        step={tour.step}
        onEvent={(e) => tour.fire(e)}
        onSkip={() => tour.skip()}
        onView={(id) => tour.markView(id)}
        onAction={(type) => { actionsRef.current.push(type); }}
      />
    </div>
  );
}
