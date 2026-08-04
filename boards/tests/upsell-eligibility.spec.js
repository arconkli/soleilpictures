// Upsell targeting — asserts that the upgrade chip is shown to people who have
// invested in the product and hidden from people who just arrived, and that the
// suppression is recorded rather than silent.
//
// Context: the chip used to mount for every demo user from card #1. The pitch's
// median viewer had a handful of cards and had signed up the same day, dismissed
// in a few seconds, and read none of it. Suppressing those exposures is the
// point of lib/upsellEligibility.js; this spec proves the wiring, while the
// threshold arithmetic itself is covered by upsellEligibility.test.mjs.
//
// Same harness as upsell-metrics.spec.js: DEV build + ?local=1 fake user,
// &tier/&cards/&limit driving qaTierOverride (localMode.js). The fake user is
// created "now", so accountAgeDays is 0 in here and the `invested` rule (cap
// fraction) is the one under test — which is also the rule that qualifies
// nearly everyone in practice.

import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';

const byName = (rows, name) => rows.filter((r) => r.event === name);
const chipOf = (page) => page.locator('.upgrade-chip');

test.beforeEach(async ({ page }) => {
  await page.route('**/functions/v1/create-checkout-session', (route) =>
    route.fulfill({ json: { ok: true, url: '/pricing' } }));
  await page.addInitScript(() => {
    try { localStorage.setItem('sb-local-auth-token', '1'); } catch (_) {}
  });
});

test('a day-one user with no cards is not pitched, and the suppression is recorded', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await page.goto('/?local=1&reset=1&tier=demo&cards=0');

  await expect(chipOf(page)).toHaveCount(0);

  // The topbar must not reserve room for a chip that never renders.
  await expect.poll(() =>
    page.evaluate(() => getComputedStyle(document.documentElement)
      .getPropertyValue('--upgrade-chip-gutter').trim()),
  ).toBe('0px');

  // Silence has to be measurable: without this row, "nobody converted" and
  // "nobody was ever asked" look identical in the funnel.
  await expect.poll(() => byName(rows, 'up_suppressed').length, { timeout: 8000 }).toBeGreaterThan(0);
  const s = byName(rows, 'up_suppressed')[0];
  expect(s.props.surface).toBe('chip');
  expect(s.props.reason).toBe('no_cards');
  expect(s.props.elig_rev).toBeTruthy();
});

test('a barely-started user is not pitched either', async ({ page }) => {
  await page.goto('/?local=1&reset=1&tier=demo&cards=3');
  await expect(chipOf(page)).toHaveCount(0);
});

test('an invested user gets the chip, with no count and no price pressure yet', async ({ page }) => {
  await page.goto('/?local=1&reset=1&tier=demo&cards=45');

  const chip = chipOf(page);
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Get Creator');
  // Below the halfway mark the chip is a label, not a meter.
  await expect(chip.locator('.upgrade-chip-count')).toHaveCount(0);
  await expect(chip).not.toHaveClass(/upgrade-chip-near/);
});

test('past halfway the chip becomes a meter', async ({ page }) => {
  await page.goto('/?local=1&reset=1&tier=demo&cards=70');

  const chip = chipOf(page);
  await expect(chip).toBeVisible();
  await expect(chip.locator('.upgrade-chip-count')).toHaveText('70/100');
  await expect(chip).not.toHaveClass(/upgrade-chip-near/);
});

test('near the wall the chip goes urgent and counts down', async ({ page }) => {
  await page.goto('/?local=1&reset=1&tier=demo&cards=95');

  const chip = chipOf(page);
  await expect(chip).toBeVisible();
  await expect(chip).toHaveClass(/upgrade-chip-near/);
  await expect(chip).toContainText('5 cards left');
});

test('thresholds are relative to the live cap, not absolute card counts', async ({ page }) => {
  // 45 cards is "invested" against a cap of 100 but only 22% of a cap of 200.
  // This is what lets the cap move without silently re-timing the whole pitch.
  await page.goto('/?local=1&reset=1&tier=demo&cards=45&limit=200');
  await expect(chipOf(page)).toHaveCount(0);

  await page.goto('/?local=1&reset=1&tier=demo&cards=90&limit=200');
  await expect(chipOf(page)).toBeVisible();
});

test('the chip click carries the pressure state for the scorecard', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await page.goto('/?local=1&reset=1&tier=demo&cards=95');

  await chipOf(page).click();
  await expect(page.locator('.upgrade-modal')).toBeVisible();

  await expect.poll(() => byName(rows, 'up_chip_click').length, { timeout: 8000 }).toBeGreaterThan(0);
  const click = byName(rows, 'up_chip_click')[0];
  expect(click.props.pressure).toBe('urgent');
  expect(click.props.elig_reason).toBe('invested');
  expect(click.props.cap_pct).toBe(95);
});

test('a paid user is never pitched and never counted as suppressed', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await page.goto('/?local=1&reset=1&tier=paid&cards=95');

  await expect(chipOf(page)).toHaveCount(0);
  // 'not_demo' is an eligibility reason, but a paying customer is not a
  // suppressed prospect — counting them would inflate the denominator.
  await page.waitForTimeout(1200);
  expect(byName(rows, 'up_suppressed')).toHaveLength(0);
});
