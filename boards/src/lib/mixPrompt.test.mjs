// mixPrompt.test.mjs — node --test src/lib/mixPrompt.test.mjs
//
// Two things are worth pinning here. The first is the band: an ask that fires
// on the first photo interrupts someone still arriving, and one that stops
// firing above some tidy count excludes the bulk-import user this exists for.
// The second is the null handling — `Number(null)` is a finite 0, so a null
// `text` reads as "nobody has written anything here" and prompts a user who has
// written plenty. That is the exact shape of the bug upsellSlot's resolveNow
// documents, on a render path where a throw takes the canvas down.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldPromptMix, MIX_PROMPT_MIN_IMAGES } from './mixPrompt.js';

const ask = (o) => shouldPromptMix({ canEdit: true, text: 0, ...o });

test('asks once there are enough pictures to be about something', () => {
  assert.equal(ask({ images: 0 }), false, 'an empty board has nothing to caption');
  assert.equal(ask({ images: MIX_PROMPT_MIN_IMAGES - 1 }), false, 'still arriving — the depth dock owns this');
  assert.equal(ask({ images: MIX_PROMPT_MIN_IMAGES }), true);
  assert.equal(ask({ images: 40 }), true, 'the day-one bulk import is the whole point — no upper bound');
});

test('any writing at all retires the ask', () => {
  assert.equal(ask({ images: 20, text: 1 }), false, 'one note is the behaviour we wanted; stop asking');
  assert.equal(ask({ images: 20, text: 9 }), false);
  // `text` counts docs and scripts too, not just notes: someone who opened a
  // doc has already done this, and prompting them is a false positive.
  assert.equal(ask({ images: 20, text: 1 }), false);
});

test('a custom minimum moves the band with it', () => {
  assert.equal(ask({ images: 3, min: 10 }), false);
  assert.equal(ask({ images: 10, min: 10 }), true);
});

test('permission and surface gates win over the counts', () => {
  assert.equal(shouldPromptMix({ images: 9, text: 0, canEdit: false }), false, 'read-only viewers get no add affordance');
  assert.equal(ask({ images: 9, isPublic: true }), false, 'never on a public share view');
  assert.equal(ask({ images: 9, dismissed: true }), false, 'waving it away has to stick');
});

test('canEdit is opt-in, not assumed', () => {
  // If this default ever flips to true a public board starts offering an
  // add-a-note button. Same assertion depthDock carries, same reason.
  assert.equal(shouldPromptMix({ images: 9, text: 0 }), false);
});

test('null counts never read as zero', () => {
  // Number(null) === 0 and 0 is finite, so a null `text` would sail through a
  // naive finite-only guard and prompt someone who has written plenty.
  assert.equal(ask({ images: 9, text: null }), false, 'unknown writing is not absent writing');
  assert.equal(ask({ images: null }), false);
  assert.equal(ask({ images: undefined }), false);
  assert.equal(ask({ images: 9, text: undefined }), false);
});

test('junk never throws and never shows', () => {
  assert.equal(ask({ images: NaN }), false);
  assert.equal(ask({ images: 'lots' }), false);
  assert.equal(ask({ images: 9, text: 'none' }), false);
  assert.equal(ask({ images: 9, min: NaN }), false);
  assert.equal(shouldPromptMix(null), false, 'a null options bag must not take the canvas down');
  assert.equal(shouldPromptMix(undefined), false);
});
