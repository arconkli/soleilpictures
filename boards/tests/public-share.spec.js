// Public /share viewer — marketing-surface behaviors: branding + CTAs from
// first paint, share attribution seeding, full event instrumentation,
// sub-board navigation polish, the engagement prompt, and the branded
// invalid-link dead end. Everything runs against route-intercepted fixtures
// (tests/helpers/share-fixture.js) — no PartyKit, no Supabase.

import { expect, test } from '@playwright/test';
import { TOKEN, ROOT_ID, SUB_ID, routeShareBundle, routeAnalytics } from './helpers/share-fixture.js';

// Open the sub-board tile. Board cards open on a click that lands in their
// cover area (.bc-cover) — clicks on the name row only select the card.
async function openSubBoard(page) {
  await page.locator('.bc-cover').first().click();
  await page.locator('.public-crumbs').waitFor({ timeout: 5000 });
}

test('topbar brand + CTAs render and share attribution is seeded', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeShareBundle(page);
  await page.goto(`/share/${TOKEN}`);

  await expect(page.locator('.public-brand-name')).toHaveText('Clusters');
  await expect(page.locator('.public-topbar .public-cta')).toHaveText('Try Clusters free');
  await expect(page.locator('.public-topbar .public-signin-quiet')).toHaveText('Sign in');
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');
  await expect(page).toHaveTitle('Marketing Root — Soleil Clusters');

  // Session first-touch source seeded for the /share → / signup funnel.
  const src = await page.evaluate(() => JSON.parse(sessionStorage.getItem('soleil_first_source') || '{}'));
  expect(src.share_token).toBe(TOKEN);
  expect(src.utm_source).toBe('share_link');
  expect(src.utm_medium).toBe('share_page');
});

test('topbar CTA logs share_cta_click and lands on / with share utm params', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeShareBundle(page);
  await page.goto(`/share/${TOKEN}`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');

  await page.locator('.public-topbar .public-cta').click();
  await page.waitForURL(new RegExp(`/\\?utm_source=share_link&utm_medium=topbar&utm_campaign=${TOKEN}`));

  // The CTA beacons the whole queue, so the earlier share_view lands too.
  await expect.poll(() => rows.map((r) => r.event), { timeout: 10_000 }).toContain('share_cta_click');
  const cta = rows.find((r) => r.event === 'share_cta_click');
  expect(cta.props.surface).toBe('topbar');
  expect(cta.props.share_token).toBe(TOKEN);

  const view = rows.find((r) => r.event === 'share_view');
  expect(view.props.valid).toBe(true);
  expect(view.props.board_id).toBe(ROOT_ID);
  expect(view.props.include_subboards).toBe(true);
  expect(view.props.utm_source).toBe('share_link'); // merged from the seeded first source
});

test('sub-board navigation: progress shimmer, breadcrumbs, title, deep-link URL, event', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeShareBundle(page, { subDelayMs: 700 });
  // prefetch=0: the idle prefetch would otherwise warm the sub-board cache
  // and race away the shimmer + cached:false this test asserts.
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');

  await page.locator('.bc-cover').first().click();
  const progress = page.locator('.public-nav-progress');
  await expect(progress).toBeVisible(); // shimmer while the delayed bundle is in flight

  await expect(page.locator('.public-crumb.here')).toHaveText('Inside Board');
  await expect(page.locator('.public-crumbs .public-crumb').first()).toHaveText('Marketing Root');
  await expect(page).toHaveURL(new RegExp(`/share/${TOKEN}\\?b=${SUB_ID}`));
  await expect(page).toHaveTitle('Inside Board — Soleil Clusters');
  await expect(progress).toHaveCount(0); // shimmer gone once the bundle lands

  await expect.poll(() => rows.map((r) => r.event), { timeout: 10_000 }).toContain('share_subboard_open');
  const ev = rows.find((r) => r.event === 'share_subboard_open');
  expect(ev.props.board_id).toBe(SUB_ID);
  expect(ev.props.from_board_id).toBe(ROOT_ID);
  expect(ev.props.cached).toBe(false);
});

test('engagement prompt: dwell trigger (QA override) and 14-day dismissal memory', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeShareBundle(page);
  await page.goto(`/share/${TOKEN}?shareqa=1&promptms=300`);

  const prompt = page.locator('.share-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Like this board? Make your own.');
  await expect(prompt.locator('.share-prompt-cta')).toHaveText('Try Clusters free');
  await expect.poll(() => rows.map((r) => r.event), { timeout: 10_000 }).toContain('share_prompt_view');
  expect(rows.find((r) => r.event === 'share_prompt_view').props.trigger).toBe('dwell');

  await prompt.locator('.share-prompt-x').click();
  await expect(prompt).toBeHidden();
  const dismissedAt = await page.evaluate(() => localStorage.getItem('soleil.share.prompt.dismissedAt'));
  expect(Date.parse(dismissedAt)).toBeGreaterThan(0);

  // Reload — recent dismissal suppresses the prompt entirely.
  await page.goto(`/share/${TOKEN}?shareqa=1&promptms=300`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');
  await page.waitForTimeout(900);
  await expect(page.locator('.share-prompt')).toHaveCount(0);
});

test('engagement prompt: sub-board navigation trigger', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeShareBundle(page);
  await page.goto(`/share/${TOKEN}`);
  await expect(page.locator('.public-board-name')).toHaveText('Marketing Root');
  await expect(page.locator('.share-prompt')).toHaveCount(0);

  await openSubBoard(page);
  await expect(page.locator('.share-prompt')).toBeVisible();
  await expect.poll(() => rows.map((r) => r.event), { timeout: 10_000 }).toContain('share_prompt_view');
  expect(rows.find((r) => r.event === 'share_prompt_view').props.trigger).toBe('subboard');
});

test('invalid/expired link renders a branded dead end with CTA', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await routeShareBundle(page, { fail404: true });
  await page.goto(`/share/${TOKEN}`);

  await expect(page.locator('.public-empty-title')).toHaveText('This link is no longer live');
  await expect(page.locator('.public-topbar .public-cta')).toBeVisible(); // branded chrome, not a bare panel
  const bodyCta = page.locator('.public-empty-actions .public-cta');
  await expect(bodyCta).toHaveText('Try Clusters free');

  await bodyCta.click();
  await page.waitForURL(/utm_medium=invalid_page/);
  await expect.poll(() => rows.map((r) => r.event), { timeout: 10_000 }).toContain('share_view');
  const view = rows.find((r) => r.event === 'share_view');
  expect(view.props.valid).toBe(false);
  const cta = rows.find((r) => r.event === 'share_cta_click');
  expect(cta.props.surface).toBe('invalid_page');
});
