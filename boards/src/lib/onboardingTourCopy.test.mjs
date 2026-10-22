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

// The first-run setup (workspace_setup arm B) asked what the work is before the
// canvas, so the tour must not ask it again.
test('a tour started after the setup opens on the content step with its answer', async () => {
  const { startTourState, readTourState } = await import('./onboardingTour.js');
  const s = startTourState('project_first', { skipIntent: true, intent: 'storyboard' });
  assert.equal(s.step, 'add_content');
  assert.equal(currentStep(s).copy.title, 'Now drop your frames in');
  assert.equal(startTourState('project_first', { skipIntent: true, intent: null }).intent, undefined);
  // Phones have no ask to skip; nothing changes for them or without a start.
  assert.deepEqual(startTourState('mobile_lite', { skipIntent: true, intent: 'moodboard' }), initialTourState('mobile_lite'));
  assert.deepEqual(startTourState('project_first', null), initialTourState('project_first'));
  // A fresh read starts there; a recorded tour keeps its own place.
  assert.equal(readTourState({ seeded: true }, 'project_first', { skipIntent: true, intent: 'moodboard' }).step, 'add_content');
  const done = readTourState({ tour: { step: 'add_content', done: true, variant: 'project_first' } }, 'project_first', { skipIntent: true });
  assert.equal(done.done, true);
  // Content still finishes it, the same as after a picked intent.
  assert.equal(advanceTour(s, { type: 'content_added' }).done, true);
});
