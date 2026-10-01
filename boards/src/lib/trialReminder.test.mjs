// The trial-ending reminder (billing-reconcile-cron + _shared/email/trialEnding.ts,
// migration 0345) makes promises in three places — the email, the plans page and
// the cron's own window — and nothing else would notice them drifting apart.
// Source-level on purpose: the sender is a Deno edge function, and npm test is
// the only gate this repo runs (see activateCore.mjs for the same choice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../..');
const read = (p) => readFileSync(join(repo, p), 'utf8');

const cron = read('supabase/functions/billing-reconcile-cron/index.ts');
const email = read('supabase/functions/_shared/email/trialEnding.ts');
const plans = read('boards/content/docs/account/plans.md');
const migration = read('supabase/migrations/0345_trial_reminder_stamp.sql');

const DAY = 24 * 60 * 60 * 1000;

test('the plans page says "about three days", and the cron sends about three days ahead', () => {
  const m = cron.match(/const REMIND_AHEAD_MS = ([\d.]+) \* 24 \* 60 \* 60 \* 1000;/);
  assert.ok(m, 'REMIND_AHEAD_MS found');
  const ahead = Number(m[1]) * DAY;
  // The job runs once a day, so a reminder lands between (ahead - 1 day) and
  // `ahead` before the charge. "About three days" has to cover both ends.
  assert.ok(ahead - DAY >= 2 * DAY && ahead <= 4 * DAY, `window ${m[1]} days`);
  assert.match(plans, /About three days before the first charge/);
  assert.match(plans, /about three days before the first charge you get an email/);
});

test('the email never types a price: the amount comes from Stripe', () => {
  assert.doesNotMatch(email, /\$\s?\d/, 'a hand-typed amount drifts from what is charged');
  assert.match(cron, /price\?\.unit_amount/);
});

test('the email and the docs make the same promise about cancelling', () => {
  assert.match(email, /everything you've made stays exactly where it is/);
  assert.match(plans, /nothing you made is deleted/i);
});

test('only trials that will actually charge are reminded, once', () => {
  assert.match(cron, /\.eq\("status", "trialing"\)/);
  assert.match(cron, /\.eq\("cancel_at_period_end", false\)/);
  assert.match(cron, /\.is\("trial_reminder_sent_at", null\)/);
  // The claim is the column the migration adds, and a failed send releases it.
  assert.match(migration, /add column if not exists trial_reminder_sent_at timestamptz/);
  assert.match(cron, /update\(\{ trial_reminder_sent_at: null \}\)/);
});
