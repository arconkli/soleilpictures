// onboardingTourCopy.test.mjs — the content step names the material a person
// said they were bringing, instead of "your stuff".
//
//   node --test src/lib/onboardingTourCopy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialTourState, advanceTour, currentStep } from './onboardingTour.js';

function afterPick(intent) {
  return advanceTour(initialTourState('project_first'), { type: 'intent_picked', intent });
}

test('the content step reads the picked intent into its copy', () => {
  assert.equal(currentStep(afterPick('references')).copy.title, 'Now drop your references in');
  assert.equal(currentStep(afterPick('storyboard')).copy.title, 'Now drop your frames in');
  assert.equal(currentStep(afterPick('moodboard')).copy.title, 'Now drop your images in');
  assert.equal(currentStep(afterPick('exploring')).copy.title, 'Now drop your images in');
});

test('the body always asks for material from elsewhere, on every intent', () => {
  for (const intent of ['references', 'storyboard', 'moodboard', 'exploring']) {
    const c = currentStep(afterPick(intent)).copy;
    assert.match(c.body, /paste|drag/i, intent);
    assert.match(c.body, /folder/i, intent);
    assert.ok(typeof c.touch === 'string' && c.touch.length > 0, intent);
  }
});

test('steps without copyFor are returned unchanged', () => {
  const s = currentStep(initialTourState('project_first'));
  assert.equal(s.id, 'pick_intent');
  assert.equal(s.copy.title, 'What are you working on?');
});
