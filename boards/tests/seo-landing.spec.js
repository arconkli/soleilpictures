// /vs/* landing pages (SeoLandingPage.jsx over lib/seoLanding.js) plus the
// public pages that emitted no lp_* before 2026-09-18 (/docs/**, /changelog).
// Content-agnostic: every assertion derives from the registry, so the copy can
// change without touching this file. No Supabase — analytics and media are
// fulfilled locally.

import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';
import { SEO_LANDING_PAGES } from '../src/lib/seoLanding.js';

const VS = SEO_LANDING_PAGES.filter((p) => p.path.startsWith('/vs/'));

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAABAAAAAQCAYAAAAf8/9hAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function routeMedia(page) {
  await page.route('**/rest/v1/rpc/list_public_boards**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/public-thumb/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
  await page.route('**/landing/*.webp', (route) =>
    route.fulfill({ status: 200, contentType: 'image/webp', body: PNG_1PX }));
}

const lpViews = (rows, page) => rows.filter((r) => r.event === 'lp_view' && r.props?.page === page);

for (const spec of VS) {
  test(`${spec.path}: renders the spec and reports itself`, async ({ page }) => {
    const rows = [];
    await routeAnalytics(page, rows);
    await routeMedia(page);
    const res = await page.goto(spec.path);
    expect(res.status()).toBe(200);
    await expect(page.locator('.seo-h1')).toHaveText(spec.h1);
    await expect(page.locator('.seo-compare tbody tr')).toHaveCount(spec.compare.rows.length);
    // Sibling listicle callout is an object {path,label} rendered by both
    // renderers — a bare string ships an empty link (seoLanding.test.mjs).
    if (spec.siblingListicle) {
      await expect(page.locator(`a[href="${spec.siblingListicle.path}"]`).first()).toBeVisible();
    }
    await expect.poll(() => lpViews(rows, spec.path).length).toBeGreaterThan(0);
    expect(lpViews(rows, spec.path)[0].props.page_kind).toBe(spec.kind);
  });
}

test('/docs pages and /changelog emit lp_view with their own page id', async ({ page }) => {
  // The docs corpus is the surface AI crawlers fetch hardest; until 2026-09-18
  // not one human visit to it was measured.
  const rows = [];
  await routeAnalytics(page, rows);
  await page.goto('/docs/getting-started');
  await expect.poll(() => lpViews(rows, '/docs/getting-started').length).toBeGreaterThan(0);
  expect(lpViews(rows, '/docs/getting-started')[0].props.page_kind).toBe('docs');

  await page.goto('/changelog');
  await expect.poll(() => lpViews(rows, '/changelog').length).toBeGreaterThan(0);
  expect(lpViews(rows, '/changelog')[0].props.page_kind).toBe('changelog');
});

test('a 404 reports itself under the constant /404 id', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await page.goto('/vs/this-page-does-not-exist');
  await expect(page.locator('.public-empty-title')).toHaveText('Page not found');
  await expect.poll(() => lpViews(rows, '/404').length).toBeGreaterThan(0);
  expect(lpViews(rows, '/404')[0].props.page_kind).toBe('not_found');
});

test('first-touch is sealed where the visitor lands, and our own CTA does not rewrite last-touch', async ({ page }) => {
  // Before: /docs emitted nothing, so first-touch was sealed by the NEXT page —
  // the header CTA's `/?utm_source=docs…` — and an assistant arrival on a docs
  // page was recorded as channel 'docs', referrer 'internal', landing '/'.
  // Last-touch likewise refreshed on every internal load carrying utm_*.
  const rows = [];
  await routeAnalytics(page, rows);
  await page.goto('/docs/getting-started?utm_source=chatgpt.com', { referer: 'https://chatgpt.com/' });
  await expect.poll(() => lpViews(rows, '/docs/getting-started').length).toBeGreaterThan(0);
  await page.locator('a.docs-cta').click();
  await page.waitForURL(/\/\?utm_source=docs/);
  await expect.poll(() => lpViews(rows, '/').length).toBeGreaterThan(0);
  const home = lpViews(rows, '/')[0].props;
  expect(home.landing_path).toBe('/docs/getting-started');
  expect(home.utm_source).toBe('chatgpt.com');
  expect(home.referrer_host).toBe('chatgpt.com');
  expect(home.lt_utm_source).toBe('chatgpt.com');
  expect(home.lt_referrer_host).toBe('chatgpt.com');
});
