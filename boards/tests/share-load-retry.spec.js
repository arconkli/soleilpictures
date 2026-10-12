// A network or server blip on a share link is not "expired or revoked"
// (MEDIA-03). The viewer retries once by itself, then offers a Retry; only a
// 404 from the party still reads as a dead link (public-share.spec.js).

import { expect, test } from '@playwright/test';
import { TOKEN, ROOT_ID, makeBundles, routeAnalytics } from './helpers/share-fixture.js';

// Fails the first `failures` requests, or every request while `hits.down`.
// (Dev StrictMode runs the load effect twice, so counts are lower bounds.)
async function routeFlakyBundle(page, failures) {
  const bundles = makeBundles({});
  const hits = { n: 0, down: false };
  await page.route('**/parties/upload/share/share-bundle', async (route) => {
    hits.n += 1;
    if (hits.down || hits.n <= failures) return route.fulfill({ status: 503, body: 'upstream request timeout' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bundles[ROOT_ID]) });
  });
  return hits;
}

test('one failed load retries by itself and the board opens', async ({ page }) => {
  await routeAnalytics(page, []);
  const hits = await routeFlakyBundle(page, 2);   // both StrictMode runs fail once
  await page.goto(`/share/${TOKEN}`);
  await expect(page.locator('.public-crumb, .public-topbar').first()).toBeVisible();
  await expect.poll(() => hits.n, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
  await expect(page.locator('.public-empty-title')).toHaveCount(0);
});

test('a sustained outage says Couldn\'t load, and Retry opens the board', async ({ page }) => {
  await routeAnalytics(page, []);
  const hits = await routeFlakyBundle(page, 0);
  hits.down = true;
  await page.goto(`/share/${TOKEN}`);
  await expect(page.locator('.public-empty-title')).toHaveText('Couldn’t load this board', { timeout: 10_000 });
  await expect(page.getByText('This link is no longer live')).toHaveCount(0);
  hits.down = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('.public-empty-title')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('Welcome to the shared board')).toBeVisible();
});

test('a dropped connection is retryable too', async ({ page }) => {
  await routeAnalytics(page, []);
  await page.route('**/parties/upload/share/share-bundle', (route) => route.abort('internetdisconnected'));
  await page.goto(`/share/${TOKEN}`);
  await expect(page.locator('.public-empty-title')).toHaveText('Couldn’t load this board', { timeout: 10_000 });
});
