// inviteEmailCards.test.mjs — the invite email's starting-card count is a
// constant in a Deno bundle that cannot import billingCopy.js, so this test
// reads templates.ts as text and keeps the two equal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REFERRED_START_CARDS } from './billingCopy.js';

const src = readFileSync(
  new URL('../../../supabase/functions/_shared/email/templates.ts', import.meta.url),
  'utf8',
);

test('templates.ts REFERRED_START_CARDS equals billingCopy.REFERRED_START_CARDS', () => {
  const m = src.match(/^const REFERRED_START_CARDS = (\d+);/m);
  assert.ok(m, 'const REFERRED_START_CARDS not found in templates.ts');
  assert.equal(Number(m[1]), REFERRED_START_CARDS);
});

test('pendingInvite subtitle carries no typed card number', () => {
  const m = src.match(/const subtitle = `[^`]*free cards[^`]*`;/);
  assert.ok(m, 'pendingInvite subtitle not found');
  assert.match(m[0], /\$\{REFERRED_START_CARDS\} free cards/);
  assert.doesNotMatch(m[0], /\b\d+\s+free cards/);
});
