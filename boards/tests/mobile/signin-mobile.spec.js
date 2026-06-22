import { expect, test } from '@playwright/test';

// Mobile sign-in friction. Signed-out phone visitors convert ~⅓ less than
// desktop at the email gate. Two targeted fixes:
//  1. The "explore a live board" payoff is shown from the first frame on touch
//     (it was gated behind ~90% scroll depth — the bouncing cohort never saw it).
//  2. The email field gets mobile keyboard hints so the local-part isn't
//     auto-capitalized/autocorrected into an invalid address.
//
// Renders the real SignIn (no ?local), so skip the desktop project.

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'mobile sign-in friction');
  await page.goto('/');
  // Signed-out users land on the SignIn screen (AuthGate, eager before the
  // lazy app shell). The email field is the anchor.
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 20000 });
});

test('the explore-a-board CTA is visible and tappable without scrolling on touch', async ({ page }) => {
  const explore = page.locator('.sb-explore');
  await expect(explore).toBeVisible();
  const { opacity, pointerEvents } = await explore.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { opacity: cs.opacity, pointerEvents: cs.pointerEvents };
  });
  expect(parseFloat(opacity)).toBeGreaterThan(0.5);
  expect(pointerEvents).not.toBe('none');
});

test('the email field carries mobile keyboard hints', async ({ page }) => {
  const email = page.locator('input[type="email"]');
  await expect(email).toHaveAttribute('inputmode', 'email');
  await expect(email).toHaveAttribute('autocapitalize', 'off');
  await expect(email).toHaveAttribute('autocorrect', 'off');
  await expect(email).toHaveAttribute('enterkeyhint', 'go');
});
