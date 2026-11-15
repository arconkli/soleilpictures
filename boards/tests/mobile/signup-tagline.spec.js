import { expect, test } from '@playwright/test';

// The sign-up page's one-line tagline on a phone: it fits in two lines at most
// and crowds neither the wordmark nor the email field. Phone projects only.
const LINE = 'One workspace for all your creative work.';

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'phone tagline');
  await page.route((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (route) => route.abort());
});

test('the tagline fits and clears the wordmark and the email field', async ({ page }) => {
  await page.goto('/');
  const email = page.locator('input[type="email"]');
  await expect(email).toBeVisible({ timeout: 20000 });
  const tag = page.locator('.sb-tagline');
  await expect(tag).toBeVisible();
  await expect(tag).toHaveText(LINE);
  const t = await tag.boundingBox();
  const w = await page.locator('.sb-box .clusters-mark').first().boundingBox();
  const e = await email.boundingBox();
  expect(t.height).toBeLessThanOrEqual(42);
  expect(t.y).toBeGreaterThanOrEqual(w.y + w.height);
  expect(t.y + t.height).toBeLessThanOrEqual(e.y);
});

test('a screen about a plan hides the tagline', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('soleil.boards.pending.creator', JSON.stringify({ plan: 'monthly', from: 'public_pricing', at: Date.now() }));
    } catch { /* ignore */ }
  });
  await page.goto('/');
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.sb-tagline')).toHaveCount(0);
});

test('an invite link never paints the tagline', async ({ page }) => {
  await page.goto('/?invite=abc123');
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.sb-tagline')).toHaveCount(0);
});
