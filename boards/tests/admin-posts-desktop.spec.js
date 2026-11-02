// The desktop admin's Posts tab (pages/admin/AdminPostsTab.jsx) in the dev-only
// fixture harness: /admin?adminpreview=1&tab=posts. No auth, no network; the
// posts come from makePhonePostsApi() in src/local/adminPhoneFixtures.js.

import { test, expect } from '@playwright/test';

const T = { timeout: 20000 };
let errors;

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('/admin?adminpreview=1&tab=posts');
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('Posts shows how the last ones did and today\'s cards, with their slides loaded', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible(T);
  await expect(page.getByRole('heading', { name: 'How the last ones did' })).toBeVisible(T);

  const hooks = { 14: 'Five shots that make a scene feel expensive', 15: 'Sample hook for post 15' };
  for (const n of [14, 15]) {
    const card = page.getByTestId(`ap-post-${n}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText(hooks[n]);
    const imgs = card.locator('.ap-strip img');
    await expect(imgs).toHaveCount(n === 14 ? 6 : 4, T);
    await expect.poll(() => imgs.evaluateAll((els) => els.every((e) => e.complete && e.naturalWidth > 0))).toBe(true);
  }
});

test('Posted marks a post done and reports it', async ({ page }) => {
  const card = page.getByTestId('ap-post-14');
  await expect(card).toBeVisible(T);
  await card.getByRole('button', { name: 'Posted', exact: true }).click();
  await expect(card.locator('.is-posted')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__phonePosted)).toContain(14);
});

test('Earlier expands a day to show its posts', async ({ page }) => {
  const day = page.getByRole('button', { name: /4 posts/ });
  await expect(day).toBeVisible(T);
  await expect(page.getByTestId('ap-post-10')).toHaveCount(0);
  await day.click();
  for (const n of [10, 11, 12, 13]) await expect(page.getByTestId(`ap-post-${n}`)).toBeVisible();
});
