import { useEffect, useRef } from 'react';
import { OnboardingTour } from '../components/OnboardingTour.jsx';
import { useOnboardingTour } from '../hooks/useOnboardingTour.js';

// Dev-only harness for ?tourqa=1. Renders the real <OnboardingTour> driven by
// the real engine over a set of fake data-tour anchors, isolated from Supabase,
// and exposes window.__soleilTourTest = { fire, skip, getState, getEmitted } so
// Playwright (tests/onboarding-tour.spec.js) can drive step advancement and
// assert anchoring. Gated to DEV builds in main.jsx.
const ANCHORS = [
  { anchor: 'empty-cluster-tile', label: 'Cluster tile', style: { top: '48%', left: '46%' } },
  { anchor: 'cluster-card', label: 'Cluster card', style: { top: '28%', left: '62%' } },
  { anchor: 'nav', label: 'Studio ›', style: { top: '10px', left: '40%' } },
  { anchor: 'image-tool', label: 'Image', style: { top: '50%', left: '10px' } },
];

export function TourQaHarness() {
  const emittedRef = useRef([]);
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

  // Keep live refs so the window bridge never closes over stale state.
  const ref = useRef(tour);
  ref.current = tour;

  useEffect(() => {
    window.__soleilTourTest = {
      fire: (e) => ref.current.fire(e),
      skip: () => ref.current.skip(),
      getState: () => ref.current.state,
      getEmitted: () => emittedRef.current.slice(),
    };
    const root = document.getElementById('root');
    if (root) root.setAttribute('data-tourqa-ready', '1');
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <div id="tourqa-ready" style={{ position: 'fixed', top: 4, left: 4, fontSize: 10, color: '#888' }}>
        tourqa ready
      </div>
      {ANCHORS.map((a) => (
        <button
          key={a.anchor}
          data-tour={a.anchor}
          style={{ position: 'fixed', ...a.style, padding: '6px 10px' }}
        >
          {a.label}
        </button>
      ))}
      <OnboardingTour
        step={tour.step}
        onEvent={(e) => tour.fire(e)}
        onSkip={() => tour.skip()}
        onView={(id) => tour.markView(id)}
      />
    </div>
  );
}
