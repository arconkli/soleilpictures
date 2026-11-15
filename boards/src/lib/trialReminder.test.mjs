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

import { EMAIL_LOCALES } from '../../../supabase/functions/_shared/email/i18n.mjs';
import { renderTrialEnding, formatChargeAt, formatPriceLabel } from '../../../supabase/functions/_shared/email/trialEnding.ts';
import en from '../../../supabase/functions/_shared/email/strings/en.mjs';

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

// The words moved out of the code into strings/en.mjs (and the cron's date and
// price formatting into trialEnding.ts), so the pins read them there.
const enWords = Object.entries(en).filter(([k]) => k.startsWith('trial_ending.'));
const code = (s) => s.replace(/\/\/[^\n]*/g, '');   // comments are not wiring

test('the email never types a price: the amount comes from Stripe', () => {
  for (const [k, v] of enWords) assert.doesNotMatch(String(v), /\$\s?\d/, `${k}: a hand-typed amount drifts from what is charged`);
  // (" at $1" is the regex capture that writes "at" before the time, not an amount)
  assert.doesNotMatch(code(email), /(?<!at )\$\s?\d/, 'a hand-typed amount drifts from what is charged');
  assert.match(cron, /price\?\.unit_amount/);
  assert.match(cron, /formatPriceLabel\(cents, price\?\.currency, interval, locale\)/);
});

test('the email and the docs make the same promise about cancelling', () => {
  assert.match(en['trial_ending.subtitle'], /everything you've made stays exactly where it is/);
  assert.match(plans, /nothing you made is deleted/i);
});

test('the email names the moment with its zone, never a bare date', () => {
  // Nothing stores the reader's time zone, and a bare UTC date names the wrong
  // day for an evening charge in the Americas — the reader cancels "on" the day
  // they were given and has already been charged.
  assert.match(email, /timeZone: "UTC"/);
  assert.match(email, /s\.t\("trial_ending\.charge_at", \{ date: when \}\)/, 'the zone is written out by the string');
  assert.match(en['trial_ending.charge_at'], /UTC$/, 'in every language the date ends up with its zone');
  assert.match(email, /hour: "numeric", minute: "2-digit"/, 'and the time, not only the date');
  assert.match(email, /timeStyle: "short"/, 'in every other language too');
  assert.match(cron, /formatChargeAt\(new Date\(row\.current_period_end as string\), locale\)/);
  assert.doesNotMatch(en['trial_ending.subject'], /\{/, 'the subject carries no date to misread');
  assert.match(en['trial_ending.headline'], /in about three days/);
  assert.match(en['trial_ending.fallback_at'], /in about three days/);
});

test('a failed user lookup releases the claim instead of dropping the reminder', () => {
  // getUserById resolves with an error; read as "no email", it would keep the
  // claim and that trial would never be reminded.
  assert.match(cron, /if \(u\.error\) throw new Error\(`user lookup failed/);
});

test('only trials that will actually charge are reminded, once', () => {
  assert.match(cron, /\.eq\("status", "trialing"\)/);
  assert.match(cron, /\.eq\("cancel_at_period_end", false\)/);
  assert.match(cron, /\.is\("trial_reminder_sent_at", null\)/);
  // The claim is the column the migration adds, and a failed send releases it.
  assert.match(migration, /add column if not exists trial_reminder_sent_at timestamptz/);
  assert.match(cron, /update\(\{ trial_reminder_sent_at: null \}\)/);
});

test('a translated charge date survives the length cap in every language', () => {
  for (const loc of EMAIL_LOCALES) {
    for (let month = 0; month < 12; month++) {
      const d = new Date(Date.UTC(2026, month, 15, 13, 30));
      const at = formatChargeAt(d, loc);
      const { text } = renderTrialEnding({ chargeAt: at, amountLabel: formatPriceLabel(1200, 'usd', 'month', loc) }, loc);
      assert.ok(text.includes(at), `${loc} ${month + 1}: "${at}" was cut`);
    }
  }
});
