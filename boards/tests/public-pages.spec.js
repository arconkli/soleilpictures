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

test('a /docs/page#heading link lands on that heading, not the top of the page', async ({ page }) => {
  await routeAnalytics(page, []);
  const { path, id } = deepHeading();
  await page.goto(`${path}#${id}`);

  const scroller = page.locator('.docs-scroll');
  await expect(page.locator(`#${id}`)).toBeVisible();
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  // At the top of the reading pane, give or take the scroll margin.
  await expect.poll(() => page.evaluate((hid) => {
    const s = document.querySelector('.docs-scroll').getBoundingClientRect().top;
    return Math.abs(document.getElementById(hid).getBoundingClientRect().top - s);
  }, id)).toBeLessThan(120);
});

test('without a fragment a docs page still opens at the top', async ({ page }) => {
  await routeAnalytics(page, []);
  const { path } = deepHeading();
  await page.goto(path);
  await expect(page.locator('.docs-article h1')).toBeVisible();
  expect(await page.locator('.docs-scroll').evaluate((el) => el.scrollTop)).toBe(0);
});

test.describe('docs on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('typing in search shows the results, which live in the collapsed nav', async ({ page }) => {
    await routeAnalytics(page, []);
    await page.goto('/docs');
    await expect(page.locator('.docs-nav')).toBeHidden();

    await page.locator('.docs-search').fill('webhooks');
    await expect(page.locator('.docs-nav')).toBeVisible();
    await expect(page.locator('.docs-nav a').first()).toBeVisible();

    await page.locator('.docs-search').fill('zzzzqqqq');
    await expect(page.locator('.docs-nav-empty')).toBeVisible();
  });

  test('long inline code wraps instead of panning the reading pane sideways', async ({ page }) => {
    await routeAnalytics(page, []);
    // Every page with inline code in prose, so this cannot pass by picking a
    // page whose spans happen to be short.
    const paths = Object.entries(DOCS_CONTENT)
      .filter(([, blocks]) => blocks.some((b) => (b.type === 'para' || b.type === 'list')
        && JSON.stringify(b).includes('"code"')))
      .map(([p]) => p);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of ['/docs/api/webhooks', '/docs/mcp'].filter((x) => paths.includes(x))) {
      await page.goto(p);
      await expect(page.locator('.docs-article h1')).toBeVisible();
      const overflow = await page.locator('.docs-scroll')
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow, `${p} pans sideways`).toBeLessThanOrEqual(0);
    }
  });
});

test('an idle /scout does not run a frame loop forever', async ({ page }) => {
  await routeAnalytics(page, []);
  await page.route('**/rest/v1/rpc/list_public_boards**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.addInitScript(() => {
    window.__rafCalls = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { window.__rafCalls += 1; return raf(cb); };
  });
  await page.goto('/scout');
  await expect(page.locator('.scout-scene.is-runway')).toBeVisible();
  // Let fonts, the first measure and any entrance settle.
  await page.waitForTimeout(1500);

  const before = await page.evaluate(() => window.__rafCalls);
  await page.waitForTimeout(1000);
  const idle = (await page.evaluate(() => window.__rafCalls)) - before;
  expect(idle, 'rAF callbacks requested in one idle second').toBeLessThan(10);

  // …and scrolling still drives the thread: the bubbles on screen change.
  const visibleKeys = () => page.evaluate(() => [...document.querySelectorAll('.scout-msg[data-live]')]
    .map((n) => n.dataset.msg).join(','));
  const atTop = await visibleKeys();
  await page.evaluate(() => {
    const sc = document.querySelector('.scout-scroll');
    sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * 0.5;
  });
  await expect.poll(visibleKeys).not.toBe(atTop);
});

test('a template item page puts its CTA at the right edge of the topbar', async ({ page }) => {
  await routeAnalytics(page, []);
  await page.goto('/templates/shot-list-template');
  const cta = page.locator('.public-topbar a.public-cta');
  await expect(cta).toBeVisible();
  const bar = await page.locator('.public-topbar').boundingBox();
  const box = await cta.boundingBox();
  // Within the topbar's own right padding of its right edge, not beside the logo.
  expect(bar.x + bar.width - (box.x + box.width)).toBeLessThan(40);
});

test('/pricing with a cached session marker that does not restore shows pricing, not the sign-in wall', async ({ page }) => {
  await routeAnalytics(page, []);
  // main.jsx routes on the PRESENCE of an sb-*-auth-token key; this one names
  // no session supabase-js can restore, which is what a revoked refresh token
  // leaves behind until the client clears it.
  await page.addInitScript(() => {
    try { localStorage.setItem('sb-local-auth-token', '1'); } catch (_) {}
  });
  await page.goto('/pricing');
  await expect(page.locator('.pp-shell')).toBeVisible();
  await expect(page.locator('.auth-screen input[type="email"]')).toHaveCount(0);
});
