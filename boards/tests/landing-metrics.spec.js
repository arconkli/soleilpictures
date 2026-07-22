// Landing-page engagement instrumentation (lp_* family) — asserts the uniform
// events actually land at the PostgREST layer on a real SEO landing page and
// that the '/' sign-in reveal keeps its legacy names in byte-parity with the
// shared tracker (the signup-funnel RPCs read landing_scroll/landing_dwell).
// No Supabase: the RPC + thumbnails + analytics are all fulfilled locally.

import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function routeSeoPage(page) {
  await page.route('**/rest/v1/rpc/list_public_boards**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/public-thumb/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
  await page.route('**/landing/*.webp', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
}

const byName = (rows, name) => rows.filter((r) => r.event === name);

test('SEO landing page fires the full lp_* engagement package', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeSeoPage(page);
  await page.goto('/tools/mood-board-maker');
  await expect(page.locator('.seo-h1')).toBeVisible();

  // Read to the bottom: scroll the overflow container (NOT the window) and
  // wait for the (smooth) scroll to actually settle at the end.
  await page.evaluate(() => {
    const el = document.querySelector('.seo-scroll');
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForFunction(() => {
    const el = document.querySelector('.seo-scroll');
    return el.scrollTop >= el.scrollHeight - el.clientHeight - 2;
  });

  // Open the first FAQ item.
  await page.locator('.seo-faq-item summary').first().click();

  // Leave the tab — the dwell beacon flushes the whole queue. Poll for the
  // REAL dwell row (max_depth 1); dev StrictMode emits a throwaway ~0ms dwell
  // first, which must not satisfy the wait.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(
    () => byName(rows, 'lp_dwell').some((r) => r.props.max_depth === 1),
    { timeout: 8000 },
  ).toBe(true);

  // View events: the uniform lp_view AND the legacy seo_landing_view both fire.
  const view = byName(rows, 'lp_view')[0];
  expect(view.props.page).toBe('/tools/mood-board-maker');
  expect(view.props.page_kind).toBe('tool');
  expect(byName(rows, 'seo_landing_view').length).toBeGreaterThan(0);

  // Full-depth read → every scroll threshold fired exactly once.
  const depths = byName(rows, 'lp_scroll').map((r) => r.props.depth).sort((a, b) => a - b);
  expect(depths).toEqual([0.1, 0.25, 0.5, 0.75, 0.9, 1]);

  // Sections were seen (hero at minimum), the FAQ open landed, dwell has depth.
  const sections = byName(rows, 'lp_section').map((r) => r.props.section);
  expect(sections).toContain('hero');
  expect(byName(rows, 'lp_faq')[0].props.idx).toBe(0);
  // The real dwell row (dev StrictMode adds a throwaway ~0ms one too).
  const dwell = byName(rows, 'lp_dwell').find((r) => r.props.max_depth === 1);
  expect(dwell.props.max_depth).toBe(1);
  expect(dwell.props.ms).toBeGreaterThanOrEqual(0);

  // Every row carries the uniform base.
  for (const r of rows.filter((x) => String(x.event).startsWith('lp_'))) {
    expect(r.props.page).toBe('/tools/mood-board-maker');
    expect(r.props.page_kind).toBe('tool');
  }
});

test('SEO landing CTA click beacons lp_cta_click with position + signup intent', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeSeoPage(page);
  await page.goto('/tools/mood-board-maker');
  await expect(page.locator('.seo-h1')).toBeVisible();

  await page.locator('.seo-hero-cta .seo-cta-primary').click();

  await expect.poll(() => byName(rows, 'lp_cta_click').length, { timeout: 8000 }).toBeGreaterThan(0);
  const cta = byName(rows, 'lp_cta_click')[0];
  expect(cta.props.pos).toBe('hero');
  expect(cta.props.intent).toBe('signup');
  expect(cta.props.page).toBe('/tools/mood-board-maker');
});

test('anonymous visitors get a PII-safe lp_trace (dead clicks recorded, values never)', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeSeoPage(page);
  await page.goto('/tools/mood-board-maker');
  await expect(page.locator('.seo-h1')).toBeVisible();

  // A click on inert copy = dead click; the email-less page has no inputs, so
  // the h1 is a safe dead target.
  await page.locator('.seo-h1').click();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

  await expect.poll(() => byName(rows, 'lp_trace').length, { timeout: 8000 }).toBeGreaterThan(0);
  const recs = byName(rows, 'lp_trace').flatMap((r) => r.props.ev);
  expect(recs.some((r) => r.k === 'dead' || r.k === 'click')).toBe(true);
  // PII-safety: records are {t,k,tgt?,...} structural only — no value/text keys.
  for (const r of recs) {
    expect(r).not.toHaveProperty('value');
    expect(r).not.toHaveProperty('text');
  }
});

test("'/' keeps landing_scroll/landing_dwell in byte-parity with the lp_* tracker", async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await page.goto('/');
  await expect(page.locator('.sb-scroll')).toBeAttached();

  // Wait for the reveal's JS to size the runway, then drive its internal
  // scroller to the end and wait for the (possibly smooth) scroll to settle —
  // the rAF loop reads scrollTop every frame and reports progress.
  await page.waitForFunction(() => {
    const el = document.querySelector('.sb-scroll');
    return el && el.scrollHeight > el.clientHeight * 2;
  });
  await page.evaluate(() => {
    const el = document.querySelector('.sb-scroll');
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForFunction(() => {
    const el = document.querySelector('.sb-scroll');
    return el.scrollTop >= (el.scrollHeight - el.clientHeight) * 0.99;
  });
  await page.waitForTimeout(200);   // a few frames so the loop reports progress

  // Poll for the REAL dwell (deep max_depth) — the StrictMode throwaway's
  // ~0ms/0-depth row must not satisfy the wait.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(
    () => byName(rows, 'landing_dwell').some((r) => r.props.max_depth >= 0.9),
    { timeout: 8000 },
  ).toBe(true);

  // lp_view is stamped as the home page.
  expect(byName(rows, 'lp_view')[0].props.page).toBe('/');

  // Scroll parity: identical depth sets from the single shared code path.
  const legacyDepths = byName(rows, 'landing_scroll').map((r) => r.props.depth).sort((a, b) => a - b);
  const lpDepths = byName(rows, 'lp_scroll').map((r) => r.props.depth).sort((a, b) => a - b);
  expect(legacyDepths.length).toBeGreaterThan(0);
  expect(lpDepths).toEqual(legacyDepths);

  // Dwell parity: legacy shape is exactly {ms, max_depth} (+ the auto-merged
  // source/device props) and matches the lp_dwell numbers. Compare the REAL
  // rows (dev StrictMode adds throwaway ~0ms ones too).
  const legacyDwell = byName(rows, 'landing_dwell').find((r) => r.props.max_depth >= 0.9);
  const lpDwell = byName(rows, 'lp_dwell').find((r) => r.props.max_depth >= 0.9);
  expect(legacyDwell.props.max_depth).toBe(lpDwell.props.max_depth);
  expect(typeof legacyDwell.props.ms).toBe('number');
  expect(legacyDwell.props.page).toBeUndefined();   // legacy rows never grow new keys
});
