// Global Privacy Control in a real browser: with navigator.globalPrivacyControl
// true the Meta Pixel is never requested and window.fbq never exists; without
// it, both happen. src/lib/gpc.test.mjs pins the source; this proves the guard
// runs. Meta is never contacted: its script is answered locally.
import { test, expect } from '@playwright/test';

async function open(page, { gpc }) {
  const pixel = [];
  await page.route('https://connect.facebook.net/**', async (route) => {
    pixel.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  await page.route('https://www.facebook.com/tr*', (route) => route.fulfill({ status: 204, body: '' }));
  if (gpc) {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true });
    });
  }
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap .card').first()).toBeVisible({ timeout: 30_000 });
  return pixel;
}

test('with Global Privacy Control on, the pixel is never loaded', async ({ page }) => {
  const pixel = await open(page, { gpc: true });
  expect(await page.evaluate(() => typeof window.fbq)).toBe('undefined');
  expect(pixel).toEqual([]);
});

test('without it, the pixel loads, once the page has', async ({ page }) => {
  const pixel = await open(page, { gpc: false });
  expect(await page.evaluate(() => typeof window.fbq)).toBe('function');
  await expect.poll(() => pixel.some((u) => u.endsWith('/fbevents.js'))).toBe(true);
  // Signed out, it waits for the load event (src/lib/pixelSchedule.js), so it
  // never competes with the page's own downloads.
  const at = await page.evaluate(() => ({
    load: performance.getEntriesByType('navigation')[0].loadEventEnd,
    pixel: performance.getEntriesByType('resource').find((r) => r.name.endsWith('/fbevents.js'))?.startTime ?? null,
  }));
  expect(at.pixel).not.toBeNull();
  expect(at.pixel).toBeGreaterThanOrEqual(at.load);
});
