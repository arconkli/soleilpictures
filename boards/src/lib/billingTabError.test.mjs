// billingTabError.test.mjs — a failed plan fetch says so in Settings → Plan &
// billing, with a way to retry, instead of a plan the account is not on
// (ACCOUNT-14). BillingTab imports React, so read its source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('BillingTab renders an error with Retry when there is no tier to show', () => {
  const src = read('../components/settings/BillingTab.jsx');
  assert.match(src, /loading, error, refetch \} =\s*\n\s*useMyTier\(/);
  const i = src.indexOf('if (!tier && error)');
  assert.ok(i > 0, 'no error branch for a failed first get_my_tier');
  // Before BillingSummary is rendered, or the waitlist/blank plan still shows.
  assert.ok(i < src.indexOf('<BillingSummary'), 'the error branch must come before the summary');
  const branch = src.slice(i, i + 700);
  assert.match(branch, /Couldn’t load your plan/);
  assert.match(branch, /onClick=\{\(\) => refetch\?\.\(\)\}/);
});
