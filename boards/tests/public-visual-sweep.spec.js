// Layout and colour regressions from the visual sweep of the public pages: the
// front door's sign-in scene, /templates, the docs code blocks, /best and
// /pricing. Content-agnostic like public-pages.spec.js — selectors and computed
// styles, never prose, so copy can be rewritten without touching this file.

import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';

// .public-dark pins --bg-0 to this; the light theme's is #f5f5f7.
const DARK_BG = 'rgb(10, 10, 12)';

test.describe('the signed-out front door on a light theme', () => {
  test.use({ colorScheme: 'light' });

  test('stays in the dark brand world: dark scene, dark ink on the gold button', async ({ page }) => {
    await routeAnalytics(page, []);
    await page.goto('/');
    await expect(page.locator('.sb-frost .auth-btn')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
    await expect(page.locator('.sb-scene')).toHaveCSS('background-color', DARK_BG);
    // White on gold was about 1.8:1; the scene's own --bg-0 ink is the dark one.
    await expect(page.locator('.sb-frost .auth-btn').first()).toHaveCSS('color', DARK_BG);
    // The light-ground mark (dark orbit) would vanish into the dark scene.
    await expect(page.locator('.sb-box .clusters-mark-dark')).toBeVisible();
    await expect(page.locator('.sb-box .clusters-mark-light')).toBeHidden();
  });

  test('never paints a light splash between the dark boot splash and the scene', async ({ page }) => {
    await routeAnalytics(page, []);
    // Record the background of every loading splash React mounts, before any
    // of it can be missed between two polls.
    await page.addInitScript(() => {
      window.__splashBgs = [];
      new MutationObserver(() => {
        document.querySelectorAll('.auth-screen').forEach((el) => {
          if (el.__seen) return;
          el.__seen = true;
          window.__splashBgs.push(getComputedStyle(el).backgroundColor);
        });
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto('/');
    await expect(page.locator('.sb-frost .auth-btn')).toBeVisible();
    const bgs = await page.evaluate(() => window.__splashBgs);
    for (const bg of bgs) expect(bg).toBe(DARK_BG);
  });
});
