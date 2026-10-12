// Behaviour and layout of the public (signed-out, crawlable) pages — the things
// that are not content: what paints while a page chunk loads, where a deep link
// lands, whether search shows anything on a phone, whether a page pans
// sideways, whether an idle page keeps the main thread busy.
//
// Content-agnostic like docsite.spec.js: pages and headings come from the
// registries, never from prose, so copy can be rewritten without touching this.

import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';
import { DOCS_CONTENT } from '../src/lib/docsiteContent.js';

// .public-dark pins --bg-0 to this; the light theme's is #f5f5f7.
const DARK_BG = 'rgb(10, 10, 12)';

// A docs page with an H2 far enough down that landing on it means a scroll.
function deepHeading() {
  for (const [path, blocks] of Object.entries(DOCS_CONTENT)) {
    const h2s = blocks.filter((b) => b.type === 'heading' && b.depth === 2);
    if (h2s.length >= 4) return { path, id: h2s[h2s.length - 1].id };
  }
  throw new Error('no docs page with four sections');
}

test.describe('light-OS visitors stay in the dark brand world', () => {
  test.use({ colorScheme: 'light' });

  test('the splash shown while a public page chunk loads is dark, not light grey', async ({ page }) => {
    await routeAnalytics(page, []);
    // Hold the page module so the <Suspense> fallback is what is on screen.
    let release;
    const held = new Promise((r) => { release = r; });
    await page.route('**/src/pages/DocsPage.jsx*', async (route) => { await held; await route.continue(); });

    await page.goto('/docs', { waitUntil: 'commit' });
    const splash = page.locator('.auth-screen');
    await expect(splash).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
    await expect(splash).toHaveCSS('background-color', DARK_BG);

    release();
    await expect(page.locator('.docs-article h1')).toBeVisible();
  });

  test('the branded 404 is dark', async ({ page }) => {
    await routeAnalytics(page, []);
    await page.goto('/tools/does-not-exist');
    await expect(page.locator('.public-empty-title')).toBeVisible();
    await expect(page.locator('.public-shell')).toHaveCSS('background-color', DARK_BG);
  });
});
