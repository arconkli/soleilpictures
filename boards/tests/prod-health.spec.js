// Production-deploy health checks. Targets the live deploy directly.
// Skips itself if BOARDS_PROD_URL isn't set, so CI can pin a different URL.

import { expect, test } from '@playwright/test';

// clusters.soleilpictures.com is the live domain (rebranded from "Boards"
// in May 2026 — the old boards. subdomain no longer resolves).
const PROD_URL = process.env.BOARDS_PROD_URL || 'https://clusters.soleilpictures.com';

test.describe('Production deploy', () => {
  test('returns 200 + valid HTML at the root', async ({ request }) => {
    const res = await request.get(PROD_URL);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/<html/i);
    // Vite-built bundle filename pattern.
    expect(body).toMatch(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
    expect(body).toMatch(/\/assets\/index-[A-Za-z0-9_-]+\.css/);
  });

  test('referenced JS + CSS bundles return 200', async ({ request }) => {
    const html = (await (await request.get(PROD_URL)).text());
    const jsHash  = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1];
    const cssHash = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.css)/)?.[1];
    expect(jsHash).toBeTruthy();
    expect(cssHash).toBeTruthy();
    const jsRes  = await request.get(`${PROD_URL}/assets/${jsHash}`);
    const cssRes = await request.get(`${PROD_URL}/assets/${cssHash}`);
    expect(jsRes.status()).toBe(200);
    expect(cssRes.status()).toBe(200);
  });

  test('auth screen renders without console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(PROD_URL);
    await page.waitForLoadState('networkidle');
    // Either we're on auth (most likely fresh) OR signed-in. Both should be OK.
    const authVisible = await page.locator('.auth-eyebrow').isVisible().catch(() => false);
    const appVisible  = await page.locator('.sidebar, .app').first().isVisible().catch(() => false);
    expect(authVisible || appVisible).toBe(true);
    // Filter network noise + extension chatter that's not relevant.
    const real = errors.filter(t => !/(net::|favicon|cors|chrome-extension)/i.test(t));
    expect(real).toEqual([]);
  });
});
