// Public /share viewer on touch viewports — the marketing share links get
// most of their clicks from social, i.e. phones. Asserts the topbar fits
// and the signup CTA stays tappable. A /share page shows no engagement
// prompt (tests/public-share.spec.js); its Join card is in
// tests/share-join.spec.js. Same route-intercepted fixtures as the desktop
// suite.

import { expect, test } from '@playwright/test';
import { TOKEN, routeShareBundle, routeAnalytics } from '../helpers/share-fixture.js';

test.beforeEach(async ({ page }) => {
  await routeAnalytics(page, []);
  await routeShareBundle(page);
});

test('share page boots on touch viewport: topbar fits, CTA tappable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'touch projects only');
  await page.goto(`/share/${TOKEN}`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');
  await expect(page.getByText('Welcome to the shared board')).toBeVisible();

  // No horizontal overflow from the topbar.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const cta = page.locator('.public-topbar .public-cta');
  await expect(cta).toBeVisible();
  const box = await cta.boundingBox();
  if (page.viewportSize().width <= 640) {
    expect(box.height).toBeGreaterThanOrEqual(40); // touch target
  }
});
