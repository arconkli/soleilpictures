// First-run guided tour — pure step engine (no React / browser globals so it
// can be unit-tested directly and reasoned about in isolation).
//
// The tour walks a fresh arm-B signup through the core mental model:
//   make a cluster -> name it -> open it -> learn the nav -> add an image
// Creating the cluster already stamps activation (first_card_at), so step 1 is
// the activation moment; the rest teaches nesting + navigation and pushes
// toward a populated board.
//
// Each step declares an `anchor` (a data-tour attribute on a real control), the
// coachmark `copy`, a `placement` hint for the pill, and an `accepts(event,ctx)`
// predicate that decides whether a tour event satisfies that step. The engine
// processes ordered events and advances to the furthest satisfied step, so a
// user who races ahead (e.g. opens the cluster before naming it) skips the
// steps they've already completed instead of getting stuck.

export const TOUR_VERSION = 1;

export const TOUR_STEPS = [
  {
    // Points at the left-rail Cluster tool — the primary surface users will live
    // in. The center empty-state tiles also fire cluster_created, so either path
    // advances the step.
    id: 'create',
    anchor: 'cluster-tool',
    placement: 'right',
    copy: {
      title: 'Make your first cluster',
      body: 'Grab the Cluster tool, then click the canvas to drop a cluster — a home for images, notes & scripts.',
      touch: 'Tap the Cluster tool, then tap the canvas to drop your first cluster.',
    },
    accepts: (e) => e?.type === 'cluster_created',
  },
  {
    id: 'rename',
    anchor: 'cluster-card',
    placement: 'bottom',
    copy: {
      title: 'Name it',
      body: 'Give your cluster a name so it’s easy to find later.',
      touch: 'Type a name for your cluster.',
    },
    accepts: (e, ctx) => e?.type === 'cluster_renamed' && e.boardId === ctx.clusterId,
  },
  {
    id: 'open',
    anchor: 'cluster-card',
    placement: 'bottom',
    copy: {
      title: 'Step inside',
      body: 'Double-click your cluster to open it.',
      touch: 'Tap your cluster to open it.',
    },
    accepts: (e, ctx) => e?.type === 'cluster_opened' && e.boardId === ctx.clusterId,
  },
  {
    id: 'nav',
    anchor: 'nav',
    placement: 'bottom',
    // The only step with no natural "do it" action, so it carries an explicit
    // acknowledge button (Milanote's "OK"). It also auto-advances if the user
    // navigates back to the root on their own (nav_back).
    cta: 'Got it',
    ackEvent: { type: 'nav_ack' },
    copy: {
      title: 'Find your way back',
      body: 'This trail is how you get around — click Studio anytime to pop back out.',
      touch: 'This trail is how you navigate — tap Studio to go back.',
    },
    accepts: (e) => e?.type === 'nav_ack' || e?.type === 'nav_back',
  },
  {
    id: 'content',
    anchor: 'image-tool',
    placement: 'right',
    copy: {
      title: 'Add your first image',
      body: 'Drag an image in, paste, or click Image to start your moodboard.',
      touch: 'Tap Image to add your first reference.',
    },
    accepts: (e, ctx) => e?.type === 'content_added' && e.boardId === ctx.clusterId,
  },
];

export function tourStepIndex(id) {
  return TOUR_STEPS.findIndex((s) => s.id === id);
}

export function initialTourState() {
  return { step: TOUR_STEPS[0].id, clusterId: null, done: false };
}

export function currentStep(state) {
  if (!state || state.done) return null;
  return TOUR_STEPS[tourStepIndex(state.step)] || null;
}

// Advance the tour in response to one event. Pure: returns a new state object
// (or the same reference when nothing changed). Records the created cluster id
// so later steps only react to that specific cluster.
export function advanceTour(state, event) {
  if (!state || state.done) return state;
  const i = tourStepIndex(state.step);
  if (i < 0) return state;

  let clusterId = state.clusterId;
  if (event?.type === 'cluster_created' && i === 0) clusterId = event.boardId;
  const ctx = { clusterId };

  // Furthest step at/after the current one that this event satisfies.
  let matched = -1;
  for (let k = TOUR_STEPS.length - 1; k >= i; k--) {
    if (TOUR_STEPS[k].accepts(event, ctx)) { matched = k; break; }
  }

  if (matched < 0) {
    return clusterId !== state.clusterId ? { ...state, clusterId } : state;
  }

  const nextIdx = matched + 1;
  if (nextIdx >= TOUR_STEPS.length) {
    return { ...state, step: TOUR_STEPS[TOUR_STEPS.length - 1].id, clusterId, done: true };
  }
  return { ...state, step: TOUR_STEPS[nextIdx].id, clusterId, done: false };
}

// Merge tour progress into the existing profiles.settings.onboarding object
// WITHOUT clobbering seeded/done/tutorialBoardId (merge_profile_settings
// replaces the whole `onboarding` key, so callers must hand it the full object).
export function mergeTourIntoOnboarding(onboarding, tour) {
  return { ...(onboarding || {}), tour };
}

// Read persisted tour progress back out of onboarding settings, tolerating a
// missing/unknown step (older or newer tour shapes fall back to the start).
export function readTourState(onboarding) {
  const t = onboarding && onboarding.tour;
  if (!t || typeof t !== 'object') return initialTourState();
  const known = tourStepIndex(t.step) >= 0;
  return {
    step: known ? t.step : TOUR_STEPS[0].id,
    clusterId: t.clusterId ?? null,
    done: !!t.done,
  };
}
