// The app's words for the first-run tour (onboardingTourWords.js) say exactly
// what onboardingTour.js says, step by step, in all three tours.
//
//   node --import ./scripts/linguiNode.mjs --test src/lib/onboardingTourWords.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOUR_STEPS, MOBILE_TOUR_STEPS, PROJECT_TOUR_STEPS, PROJECT_INTENTS, TOUR_WELCOME,
  initialTourState, advanceTour, currentStep,
} from './onboardingTour.js';
import { tourStepWords, tourChoiceLabel, tourWelcomeWords } from './onboardingTourWords.js';

const all = [...TOUR_STEPS, ...MOBILE_TOUR_STEPS, ...PROJECT_TOUR_STEPS];

test('step ids are unique across the three tours, so the words can key on them', () => {
  const ids = all.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every step reads the same English, copy, button and action label', () => {
  for (const step of all) {
    const w = tourStepWords(step);
    assert.equal(w.title, step.copy.title, `${step.id} title`);
    assert.equal(w.body, step.copy.body, `${step.id} body`);
    assert.equal(w.touch, step.copy.touch, `${step.id} touch`);
    assert.equal(w.cta, step.cta, `${step.id} cta`);
    assert.equal(w.touchLabel, step.touchAction?.label, `${step.id} touchLabel`);
  }
});

test('the project tour’s content step reads the title its intent picked', () => {
  for (const intent of ['references', 'storyboard', 'moodboard', 'exploring']) {
    const step = currentStep(advanceTour(initialTourState('project_first'), { type: 'intent_picked', intent }));
    const w = tourStepWords(step);
    assert.equal(w.title, step.copy.title, intent);
    assert.equal(w.body, step.copy.body, intent);
    assert.equal(w.touch, step.copy.touch, intent);
  }
});

test('every intent button reads the same label', () => {
  for (const c of PROJECT_INTENTS) assert.equal(tourChoiceLabel(c), c.label, c.key);
});

test('the welcome block reads the same English, kind by kind', () => {
  const w = tourWelcomeWords(TOUR_WELCOME);
  assert.equal(w.title, TOUR_WELCOME.title);
  assert.equal(w.body, TOUR_WELCOME.body);
  assert.deepEqual(w.kinds, TOUR_WELCOME.kinds);
});
