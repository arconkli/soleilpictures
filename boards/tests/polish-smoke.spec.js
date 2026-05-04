import { expect, test } from '@playwright/test';

test('auth screen shows the Soleil wordmark with glowing mark', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.auth-screen')).toBeVisible();
  await expect(page.locator('.auth-glow')).toBeVisible();
  // Wordmark renders S + mark + LEIL — assert the literal text spans
  await expect(page.locator('.auth-card')).toContainText(/S\s*LEIL|SLEIL/);
  await expect(page.locator('.auth-eyebrow')).toContainText('SOLEIL PICTURES');
  await expect(page.getByPlaceholder('you@soleilpictures.com')).toBeVisible();
});

test('auth input gains a soleil glow ring on focus', async ({ page }) => {
  await page.goto('/');
  const input = page.getByPlaceholder('you@soleilpictures.com');
  await input.focus();
  const shadow = await input.evaluate(el => getComputedStyle(el).boxShadow);
  expect(shadow).toContain('rgba(212, 160, 74');
});
