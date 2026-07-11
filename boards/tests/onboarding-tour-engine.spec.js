// Pure-logic tests for the first-run guided-tour step engine.
// Mirrors the repo's "engine test" pattern (e.g. align/arrows) but the tour
// engine is dependency-free, so we import it directly in Node.
import { expect, test } from '@playwright/test';
import {
  TOUR_STEPS,
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
    expect(readTourState(persisted)).toEqual({ step: 'open', done: false, clusterId: 'b1' });
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
