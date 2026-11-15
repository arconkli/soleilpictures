// teamPricingCopyWords.test.mjs — the app-only words say exactly what
// teamPricingCopy.js says about Team on /pricing.
//
//   node --import ./scripts/linguiNode.mjs --test src/lib/teamPricingCopyWords.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as shared from './teamPricingCopy.js';
import * as words from './teamPricingCopyWords.js';
import { EDITOR_LIMIT } from './editorLimit.js';

const plain = (v) => JSON.parse(JSON.stringify(v));

test('the Team card reads the same', () => {
  for (const n of [EDITOR_LIMIT, 3, 25]) assert.deepEqual(words.teamCardCopy(n), shared.teamCardCopy(n), String(n));
});

test('the Team benefits read the same', () => {
  for (const n of [EDITOR_LIMIT, 3, 25]) assert.deepEqual(words.teamBenefits(n), shared.teamBenefits(n), String(n));
});

test('the Team column and the comparison read the same', () => {
  assert.deepEqual(plain(words.TEAM_COLUMN), plain(shared.TEAM_COLUMN));
  assert.deepEqual(Object.keys(words.TEAM_COLUMN), Object.keys(shared.TEAM_COLUMN));
  for (const n of [EDITOR_LIMIT, 3, 25]) assert.deepEqual(plain(words.teamComparison(n)), plain(shared.teamComparison(n)), String(n));
});
