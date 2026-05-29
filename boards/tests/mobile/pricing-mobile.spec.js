import { expect, test } from '@playwright/test';

// Phone-width layout guard for the pricing surfaces. Runs on the mobile
// projects (Pixel 5 / mobile-safari). The < 400px overrides in styles.css let
// the Creator card's plan toggle wrap and trim the modal chrome so nothing
// clips or forces horizontal scroll.

test.beforeEach(async ({ page }) => {
  await page.route('**/functions/v1/verify-checkout-session', (route) =>
    route.fulfill({ json: { activated: false, reason: 'not_paid_yet' } }));
});

test('the pricing page does not overflow horizontally on a phone', async ({ page }) => {
  await page.goto('/pricing?local=1&tier=demo');
  await expect(page.locator('.pricing-card-creator')).toBeVisible();

  // No horizontal scrollbar: the document is no wider than the viewport.
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // The plan toggle stays within the card.
  const cardBox = await page.locator('.pricing-card-creator').boundingBox();
  const toggleBox = await page.locator('.pricing-card-toggle').boundingBox();
  expect(toggleBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
  expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
});
