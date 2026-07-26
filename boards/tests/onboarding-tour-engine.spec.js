// Pure-logic tests for the first-run guided-tour step engine.
// Mirrors the repo's "engine test" pattern (e.g. align/arrows) but the tour
// engine is dependency-free, so we import it directly in Node.
import { expect, test } from '@playwright/test';
import {
  TOUR_STEPS,
  MOBILE_TOUR_STEPS,
  stepsFor,
  initialTourState,
  currentStep,
  tourStepIndex,
  advanceTour,
  mergeTourIntoOnboarding,
  readTourState,
} from '../src/lib/onboardingTour.js';

test.describe('onboarding tour engine', () => {
  test('starts on the create step, not done', () => {
    const s = initialTourState();
    expect(currentStep(s).id).toBe('create');
    expect(s.done).toBe(false);
  });

  test('cluster_created advances to rename and records the cluster id', () => {
    const s = advanceTour(initialTourState(), { type: 'cluster_created', boardId: 'b1' });
    expect(s.step).toBe('rename');
    expect(s.clusterId).toBe('b1');
  });

  test('rename advances only for the tour cluster, not another board', () => {
    const created = advanceTour(initialTourState(), { type: 'cluster_created', boardId: 'b1' });
    const ignored = advanceTour(created, { type: 'cluster_renamed', boardId: 'other' });
    expect(ignored.step).toBe('rename');
    const ok = advanceTour(created, { type: 'cluster_renamed', boardId: 'b1' });
    expect(ok.step).toBe('open');
  });

  test('opening the cluster before renaming skips the rename step (graceful skip-ahead)', () => {
    let s = advanceTour(initialTourState(), { type: 'cluster_created', boardId: 'b1' });
    s = advanceTour(s, { type: 'cluster_opened', boardId: 'b1' });
    expect(s.step).toBe('nav');
  });

  test('nav step advances on acknowledge or navigating back to root', () => {
    const base = ['cluster_created', 'cluster_renamed', 'cluster_opened'].reduce(
      (st, type) => advanceTour(st, { type, boardId: 'b1' }),
      initialTourState(),
    );
    expect(base.step).toBe('nav');
    expect(advanceTour(base, { type: 'nav_ack' }).step).toBe('content');
    expect(advanceTour(base, { type: 'nav_back' }).step).toBe('content');
  });

  test('full happy path finishes after switching the cluster to List view', () => {
    let s = initialTourState();
    for (const e of [
      { type: 'cluster_created', boardId: 'b1' },
      { type: 'cluster_renamed', boardId: 'b1' },
      { type: 'cluster_opened', boardId: 'b1' },
      { type: 'nav_ack' },
    ]) s = advanceTour(s, e);
    expect(s.step).toBe('content');
    expect(s.done).toBe(false);

    s = advanceTour(s, { type: 'content_added', boardId: 'b1', kind: 'image' });
    expect(s.step).toBe('list');
    expect(s.done).toBe(false);

    s = advanceTour(s, { type: 'view_switched', view: 'list', boardId: 'b1' });
    expect(s.done).toBe(true);
    expect(currentStep(s)).toBeNull();
  });

  test('content step accepts ANY content add (image/doc/file/note) and lands on list', () => {
    // The lock prevents adding content before this step, so the content step
    // accepts any content card — "add anything" — without a brittle board match.
    const base = ['cluster_created', 'cluster_renamed', 'cluster_opened'].reduce(
      (st, type) => advanceTour(st, { type, boardId: 'b1' }),
      initialTourState(),
    );
    const atContent = advanceTour(base, { type: 'nav_ack' });
    expect(atContent.step).toBe('content');
    for (const kind of ['image', 'doc', 'file', 'note']) {
      const next = advanceTour(atContent, { type: 'content_added', boardId: 'anything', kind });
      expect(next.step).toBe('list');
      expect(next.done).toBe(false);
    }
  });

  test('list step completes on the real switch or the Got-it ack — never on a canvas switch', () => {
    let s = ['cluster_created', 'cluster_renamed', 'cluster_opened'].reduce(
      (st, type) => advanceTour(st, { type, boardId: 'b1' }),
      initialTourState(),
    );
    s = advanceTour(s, { type: 'nav_ack' });
    s = advanceTour(s, { type: 'content_added', boardId: 'b1', kind: 'note' });
    expect(s.step).toBe('list');

    // Switching back to canvas view must NOT complete the tour.
    expect(advanceTour(s, { type: 'view_switched', view: 'canvas', boardId: 'b1' }).done).toBe(false);
    // A stray extra content add during the list step doesn't move it either.
    expect(advanceTour(s, { type: 'content_added', boardId: 'b1', kind: 'image' }).step).toBe('list');
    // Real switch completes…
    expect(advanceTour(s, { type: 'view_switched', view: 'list', boardId: 'b1' }).done).toBe(true);
    // …and so does the acknowledge fallback (unanchored Got it).
    expect(advanceTour(s, { type: 'list_ack' }).done).toBe(true);
  });

  test('events are ignored once the tour is done', () => {
    let s = initialTourState();
    for (const e of [
      { type: 'cluster_created', boardId: 'b1' },
      { type: 'cluster_renamed', boardId: 'b1' },
      { type: 'cluster_opened', boardId: 'b1' },
      { type: 'nav_ack' },
      { type: 'content_added', boardId: 'b1', kind: 'image' },
      { type: 'view_switched', view: 'list', boardId: 'b1' },
    ]) s = advanceTour(s, e);
    expect(s.done).toBe(true);
    expect(advanceTour(s, { type: 'cluster_created', boardId: 'b2' })).toEqual(s);
  });

  test('mergeTourIntoOnboarding preserves seeded/done/tutorialBoardId and does not mutate input', () => {
    const onb = { seeded: true, done: false, tutorialBoardId: 't1' };
    const merged = mergeTourIntoOnboarding(onb, { step: 'open', done: false, clusterId: 'b1' });
    expect(merged.seeded).toBe(true);
    expect(merged.done).toBe(false);
    expect(merged.tutorialBoardId).toBe('t1');
    expect(merged.tour).toEqual({ step: 'open', done: false, clusterId: 'b1' });
    expect(onb.tour).toBeUndefined();
  });

  test('readTourState returns initial state when onboarding has no tour yet', () => {
    expect(readTourState({ seeded: true }).step).toBe('create');
    expect(readTourState({ seeded: true }).done).toBe(false);
    expect(readTourState(null).step).toBe('create');
  });

  test('readTourState round-trips a persisted tour and ignores an unknown step', () => {
    const persisted = { tour: { step: 'open', done: false, clusterId: 'b1' } };
    expect(readTourState(persisted)).toEqual({ step: 'open', done: false, clusterId: 'b1', variant: 'full' });
    // a step id from a future/older tour version falls back to the start
    expect(readTourState({ tour: { step: 'bogus', done: false } }).step).toBe('create');
  });

  test('tourStepIndex orders the six steps create -> list', () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(['create', 'rename', 'open', 'nav', 'content', 'list']);
    expect(tourStepIndex('list')).toBe(5);
    expect(tourStepIndex('nope')).toBe(-1);
  });

  test('the content step centers its pill (so the revealed rail tooltips stay clear)', () => {
    const content = TOUR_STEPS.find((s) => s.id === 'content');
    expect(content.centerPill).toBe(true);
  });

  test('the content step carries the touch "Add photos" action (camera-roll-first mobile)', () => {
    const content = TOUR_STEPS.find((s) => s.id === 'content');
    expect(content.touchAction).toEqual({ label: 'Add photos', type: 'pick_photos' });
  });

  test('the list step has the unanchored Got-it fallback so nobody can strand', () => {
    const list = TOUR_STEPS.find((s) => s.id === 'list');
    expect(list.anchor).toBe('view-toggle');
    expect(list.cta).toBe('Got it');
    expect(list.ctaWhenUnanchored).toBe(true);
    expect(list.ackEvent).toEqual({ type: 'list_ack' });
  });

  test('every step declares an anchor and copy', () => {
    for (const st of TOUR_STEPS) {
      expect(typeof st.id).toBe('string');
      expect(typeof st.anchor).toBe('string');
      expect(typeof st.copy?.title).toBe('string');
      expect(typeof st.copy?.body).toBe('string');
      expect(typeof st.accepts).toBe('function');
    }
  });
});

test.describe('onboarding tour engine — mobile_lite variant', () => {
  test('mobile list is two unlocked steps anchored to the bottom-nav puck', () => {
    expect(MOBILE_TOUR_STEPS.map((s) => s.id)).toEqual(['add_photos', 'group']);
    for (const st of MOBILE_TOUR_STEPS) {
      // No Milanote lock on phones: the puck/add-sheet/empty-tiles ARE the paths.
      expect(st.lock).toBe(false);
      expect(st.variant).toBe('mobile');
      expect(st.anchor).toBe('mb-create');
      expect(typeof st.copy?.title).toBe('string');
      expect(typeof st.copy?.touch).toBe('string');
      expect(typeof st.accepts).toBe('function');
    }
    const [addPhotos, group] = MOBILE_TOUR_STEPS;
    expect(addPhotos.touchAction).toEqual({ label: 'Add photos', type: 'pick_photos' });
    expect(group.cta).toBe('Done');
    expect(group.ackEvent).toEqual({ type: 'mobile_done' });
  });

  test('stepsFor resolves the list by variant (full is the default)', () => {
    expect(stepsFor('mobile_lite')).toBe(MOBILE_TOUR_STEPS);
    expect(stepsFor('full')).toBe(TOUR_STEPS);
    expect(stepsFor(undefined)).toBe(TOUR_STEPS);
  });

  test('mobile_lite starts on add_photos and carries its variant', () => {
    const s = initialTourState('mobile_lite');
    expect(s.variant).toBe('mobile_lite');
    expect(s.done).toBe(false);
    expect(currentStep(s).id).toBe('add_photos');
  });

  test('add_photos advances ONLY on an image add — a note does not move it', () => {
    const s0 = initialTourState('mobile_lite');
    expect(advanceTour(s0, { type: 'content_added', boardId: 'b1', kind: 'note' }).step).toBe('add_photos');
    expect(advanceTour(s0, { type: 'content_added', boardId: 'b1', kind: 'doc' }).step).toBe('add_photos');
    const s1 = advanceTour(s0, { type: 'content_added', boardId: 'b1', kind: 'image' });
    expect(s1.step).toBe('group');
    expect(s1.done).toBe(false);
  });

  test('group completes on cluster_created or the Done ack', () => {
    const atGroup = advanceTour(initialTourState('mobile_lite'), {
      type: 'content_added', boardId: 'b1', kind: 'image',
    });
    expect(advanceTour(atGroup, { type: 'cluster_created', boardId: 'c1' }).done).toBe(true);
    expect(advanceTour(atGroup, { type: 'mobile_done' }).done).toBe(true);
    // stray image adds during the group step do not complete it
    expect(advanceTour(atGroup, { type: 'content_added', boardId: 'b1', kind: 'image' }).done).toBe(false);
  });

  test('add_photos is a HARD gate: cluster_created cannot skip the photos beat', () => {
    // The whole point of mobile_lite is photos-first. Creating an empty cluster
    // (via the empty-tile / rail Cluster tool / quick-add) must NOT complete the
    // tour from the photos step — that would finish the flow with zero photos,
    // the exact empty-cluster failure this variant exists to fix. Mobile is
    // strictly sequential (no furthest-match skip-ahead).
    const s = advanceTour(initialTourState('mobile_lite'), { type: 'cluster_created', boardId: 'c1' });
    expect(s.step).toBe('add_photos');
    expect(s.done).toBe(false);
    // an image is still the only thing that advances it
    expect(advanceTour(s, { type: 'content_added', boardId: 'b1', kind: 'image' }).step).toBe('group');
  });

  test('the full tour KEEPS furthest-match skip-ahead (mobile-only change)', () => {
    // Regression guard: the strict-sequential rule must be scoped to mobile_lite.
    // On the full tour, opening a cluster before renaming still skips the rename
    // step (users who race ahead aren't stranded).
    let s = advanceTour(initialTourState('full'), { type: 'cluster_created', boardId: 'b1' });
    s = advanceTour(s, { type: 'cluster_opened', boardId: 'b1' });
    expect(s.step).toBe('nav');
  });

  test('done mobile tour ignores further events and surfaces no step', () => {
    let s = initialTourState('mobile_lite');
    s = advanceTour(s, { type: 'content_added', boardId: 'b1', kind: 'image' });
    s = advanceTour(s, { type: 'mobile_done' });
    expect(s.done).toBe(true);
    expect(currentStep(s)).toBeNull();
    expect(advanceTour(s, { type: 'content_added', boardId: 'b1', kind: 'image' })).toEqual(s);
  });

  test('readTourState restarts fresh when the persisted variant differs from the session', () => {
    // Phone user later opens on desktop: their mobile_lite record must NOT gate
    // the full tour — it starts fresh (the desktop-handoff moment).
    const mobileDone = { tour: { variant: 'mobile_lite', step: 'group', clusterId: null, done: true } };
    const onDesktop = readTourState(mobileDone, 'full');
    expect(onDesktop).toEqual({ step: 'create', clusterId: null, done: false, variant: 'full' });

    // And the mirror: a stuck full-tour record read on a phone restarts as mobile_lite.
    const fullStuck = { tour: { step: 'create', clusterId: null, done: false } };
    const onPhone = readTourState(fullStuck, 'mobile_lite');
    expect(onPhone).toEqual({ step: 'add_photos', clusterId: null, done: false, variant: 'mobile_lite' });
  });

  test('readTourState resumes same-variant progress, legacy rows defaulting to full', () => {
    const legacy = { tour: { step: 'open', clusterId: 'b1', done: false } }; // pre-variant shape
    expect(readTourState(legacy, 'full')).toEqual({ step: 'open', clusterId: 'b1', done: false, variant: 'full' });
    const mobile = { tour: { variant: 'mobile_lite', step: 'group', clusterId: null, done: false } };
    expect(readTourState(mobile, 'mobile_lite')).toEqual({ step: 'group', clusterId: null, done: false, variant: 'mobile_lite' });
    // unknown step within the SAME variant still falls back to that variant's start
    expect(readTourState({ tour: { variant: 'mobile_lite', step: 'bogus', done: false } }, 'mobile_lite').step).toBe('add_photos');
  });
});

// The project_first variant replaces the retired 6-step mechanics tour on
// desktop: capture WHAT the user is working on (the retention payload the
// mechanics tour never collected), then go straight to content. Data basis:
// most desktop users died on the old opening steps and completing all 6 steps
// didn't predict retention; the content-first mobile_lite variant is what
// moved activation. Two steps, nothing locked, everything skippable.
test.describe('project_first tour variant', () => {
  test('has exactly two steps: pick_intent then add_content, both unlocked', () => {
    const steps = stepsFor('project_first');
    expect(steps.map((s) => s.id)).toEqual(['pick_intent', 'add_content']);
    for (const s of steps) expect(s.lock).toBe(false);
  });

  test('pick_intent offers four choices ending in a no-project escape hatch', () => {
    const [intentStep] = stepsFor('project_first');
    const keys = intentStep.choices.map((c) => c.key);
    expect(keys).toEqual(['moodboard', 'storyboard', 'references', 'exploring']);
    // every project choice names the board it will seed; exploring seeds nothing
    for (const c of intentStep.choices) {
      if (c.key === 'exploring') expect(c.boardName).toBeNull();
      else expect(typeof c.boardName).toBe('string');
    }
  });

  test('starts on pick_intent, not done', () => {
    const s = initialTourState('project_first');
    expect(currentStep(s).id).toBe('pick_intent');
    expect(s.done).toBe(false);
  });

  test('picking an intent advances to add_content and records the intent', () => {
    const s = advanceTour(initialTourState('project_first'), { type: 'intent_picked', intent: 'moodboard' });
    expect(s.step).toBe('add_content');
    expect(s.intent).toBe('moodboard');
    expect(s.done).toBe(false);
  });

  test('a self-directed cluster advances past the ask without inventing an intent', () => {
    const s = advanceTour(initialTourState('project_first'), { type: 'cluster_created', boardId: 'b1' });
    expect(s.step).toBe('add_content');
    expect(s.intent).toBeUndefined();
  });

  test('dropping content while the ask is up completes the whole tour (skip-ahead)', () => {
    const s = advanceTour(initialTourState('project_first'), { type: 'content_added', kind: 'image' });
    expect(s.done).toBe(true);
  });

  test('content after an intent completes the tour and keeps the intent', () => {
    let s = advanceTour(initialTourState('project_first'), { type: 'intent_picked', intent: 'storyboard' });
    s = advanceTour(s, { type: 'content_added', kind: 'note' });
    expect(s.done).toBe(true);
    expect(s.intent).toBe('storyboard');
  });

  test('a persisted full-tour record restarts fresh as project_first (variant mismatch)', () => {
    const fullStuck = { tour: { step: 'rename', clusterId: 'b1', done: false } }; // legacy full row
    const s = readTourState(fullStuck, 'project_first');
    expect(s).toEqual({ step: 'pick_intent', clusterId: null, done: false, variant: 'project_first' });
  });
});
