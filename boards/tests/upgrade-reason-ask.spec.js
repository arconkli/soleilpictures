// "What's holding you back?" — rendered for real.
//
// The ask opens only when a free-plan owner closes an offer, which the local
// shell never shows, so ?upgradereasonqa=1 (dev-only, localMode.js) fires that
// one event and nothing else. Everything after it is the shipped component:
// the chips, the follow-up, the visible context line, the once-only markers.
// The wiring that decides WHO is asked is pinned by src/lib/upgradeReasonAsk.test.mjs,
// which CI runs; this proves the surface itself can be seen and answered.

import { test, expect } from '@playwright/test';

const URL = '/?local=1&reset=1&tier=demo&onboarded=1&upgradereasonqa=1';
const LABELS = [
  'The free plan is enough for me',
  'The price',
  'Putting a card in for a trial',
  "Not sure what I'd get",
  'Just trying it out for now',
  'Something else',
];

test('it asks, shows what it sends, and takes one tap', async ({ page }) => {
  await page.goto(URL);
  const ask = page.locator('.ur-ask');
  await expect(ask).toBeVisible({ timeout: 15_000 });
  await expect(ask.locator('.fv-banner-title')).toHaveText("What's holding you back?");
  await expect(ask.locator('.rr-chip')).toHaveText(LABELS);
  // Nothing rides along unseen.
  await expect(ask.locator('.ask-context')).toContainText('34 cards');
  await expect(ask.locator('.ask-context')).toContainText('Free');

  await ask.getByRole('button', { name: 'The price' }).click();
  await expect(ask.locator('.fv-banner-title')).toHaveText('Thanks — that helps.');
  await expect(ask.locator('.fv-banner-body')).toHaveText('What would feel fair?');
  await expect(ask.locator('textarea.rr-note')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('soleil.upgradereason.v1'))).toBe('answered');

  await ask.getByRole('button', { name: 'Skip' }).click();
  await expect(page.locator('.ur-ask')).toHaveCount(0);
});

test('"Not now" ends it, and another closed offer does not bring it back', async ({ page }) => {
  await page.goto(URL);
  const ask = page.locator('.ur-ask');
  await expect(ask).toBeVisible({ timeout: 15_000 });
  await ask.getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('.ur-ask')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('soleil.upgradereason.v1'))).toBe('dismissed');

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('soleil:offer-dismissed', {
    detail: { offer: 'near-cap', surface: 'pricing_modal', method: 'x', trial: true, dwell_ms: 3000, cards: 40, cap: 50, tier: 'demo' },
  })));
  await page.waitForTimeout(1200);
  await expect(page.locator('.ur-ask')).toHaveCount(0);
});

test('a flicked-shut offer, or a paid account, is not asked — and a real one still is', async ({ page }) => {
  // Mounted, listening, never fired: every dismissal here is the test's own.
  await page.goto('/?local=1&reset=1&tier=demo&onboarded=1&upgradereasonqa=listen');
  await page.waitForTimeout(800);
  const fire = (d) => page.evaluate((detail) => window.dispatchEvent(new CustomEvent('soleil:offer-dismissed', { detail })), d);
  for (const detail of [
    { offer: 'cap-hit', method: 'x', dwell_ms: 300, tier: 'demo' },   // under the one-second floor
    { offer: 'cap-hit', method: 'x', dwell_ms: 5000, tier: 'paid' },  // not someone the offer was for
  ]) {
    await fire(detail);
    await page.waitForTimeout(1200);
    await expect(page.locator('.ur-ask')).toHaveCount(0);
  }
  // The listener is alive: a genuine dismissal opens it, so the two refusals
  // above were the gates working and not a dead component.
  await fire({ offer: 'cap-hit', method: 'maybe_later', dwell_ms: 5000, tier: 'demo', cards: 12, cap: 50 });
  await expect(page.locator('.ur-ask')).toBeVisible({ timeout: 5_000 });
});
