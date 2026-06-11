// Public /share viewer on touch viewports — the marketing share links get
// most of their clicks from social, i.e. phones. Asserts the topbar fits,
// the signup CTA stays tappable, and the engagement prompt renders as a
// bottom sheet. Same route-intercepted fixtures as the desktop suite.

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

test('engagement prompt renders as a bottom sheet on phones', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome' || testInfo.project.name === 'tablet',
    'phone-width only (≤640px)');
  await page.goto(`/share/${TOKEN}?shareqa=1&promptms=200`);
  const prompt = page.locator('.share-prompt');
  await expect(prompt).toBeVisible();

  const pb = await prompt.boundingBox();
  const vp = page.viewportSize();
  expect(pb.width).toBeGreaterThan(vp.width * 0.8);       // spans the width
  expect(pb.y + pb.height).toBeGreaterThan(vp.height * 0.6); // anchored low

  // Dismiss works by tap.
  await prompt.locator('.share-prompt-x').tap();
  await expect(prompt).toBeHidden();
});
