// creatorIntentWords.test.mjs — the sign-in form's price label reads as
// billingCopy's creatorIntentLabels does, in English, for both plans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creatorIntentLabels } from './billingCopy.js';
import { intentLabels } from './creatorIntentWords.js';

test('English equals billingCopy.creatorIntentLabels for both plans', () => {
  for (const plan of ['monthly', 'annual']) {
    const stored = creatorIntentLabels(plan);
    assert.deepEqual(intentLabels({ plan, ...stored }), stored, plan);
  }
});

test('nothing stored, or a label it does not know, comes back as stored', () => {
  assert.deepEqual(intentLabels(null), { planName: null, priceLabel: null });
  assert.deepEqual(intentLabels({ plan: 'monthly', planName: null, priceLabel: null }), { planName: null, priceLabel: null });
  assert.deepEqual(intentLabels({ planName: 'Creator', priceLabel: '$5 flat' }), { planName: 'Creator', priceLabel: '$5 flat' });
});
