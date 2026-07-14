import { useCallback, useEffect, useRef, useState } from 'react';
import { advanceTour, currentStep, readTourState } from '../lib/onboardingTour.js';

// Controller for the first-run guided tour. Keeps the engine pure and injects
// side effects (persistence + analytics) so it stays testable:
//   - `persist(tourState)` is called whenever progress changes (App merges it
//     into profiles.settings.onboarding; the harness no-ops).
//   - `emit({ action, step, ... })` reports view / advance / skip for the funnel.
//   - `enabled` gates whether a step is surfaced at all (e.g. only arm B on the
//     root board for a fresh signup), without losing persisted progress.
export function useOnboardingTour({ onboarding, persist, emit, enabled = true, variant = 'full' } = {}) {
  const [state, setState] = useState(() => readTourState(onboarding, variant));
  const stateRef = useRef(state);
  stateRef.current = state;
  const viewedRef = useRef(new Set());

  // Resume-on-reload: onboarding settings load async (after first render), so
  // adopt the persisted progress once it first arrives — but only once, so we
  // never clobber in-session advances with a stale refetch. `touchedRef` covers
  // the other side of that race: if the user advances (or skips) BEFORE the
  // first persisted snapshot arrives, a stale `{seeded:true}` (no tour yet)
  // refetch must not reset the session back to step 1 and lose clusterId.
  const hydratedRef = useRef(false);
  const touchedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (onboarding && (onboarding.tour || onboarding.seeded === true || onboarding.done === true)) {
      hydratedRef.current = true;
      if (touchedRef.current) return; // in-session progress wins over the snapshot
      // Pass the session variant so a persisted record for the OTHER variant
      // (e.g. a finished mobile_lite tour, read on desktop) doesn't clobber the
      // freshly-started session tour — readTourState restarts it instead.
      const synced = readTourState(onboarding, variant);
      stateRef.current = synced;
      setState(synced);
    }
  }, [onboarding, variant]);

  const fire = useCallback((event) => {
    const prev = stateRef.current;
    const next = advanceTour(prev, event);
    if (next === prev) return;
    touchedRef.current = true;
    stateRef.current = next;
    setState(next);
    persist?.(next);
    emit?.({ action: 'advance', step: next.step, done: next.done, via: event?.type });
  }, [persist, emit]);

  const skip = useCallback(() => {
    const prev = stateRef.current;
    if (prev.done) return;
    touchedRef.current = true;
    const next = { ...prev, done: true };
    stateRef.current = next;
    setState(next);
    persist?.(next);
    emit?.({ action: 'skip', step: prev.step });
  }, [persist, emit]);

  // Fire a one-time view per step id (deduped) when the overlay shows it.
  const markView = useCallback((stepId) => {
    if (!stepId || viewedRef.current.has(stepId)) return;
    viewedRef.current.add(stepId);
    emit?.({ action: 'view', step: stepId });
  }, [emit]);

  return { state, step: enabled ? currentStep(state) : null, fire, skip, markView };
}
