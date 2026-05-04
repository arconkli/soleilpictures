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

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop',  width: 1024, height: 720 },
  { name: 'narrow',  width: 768,  height: 720 },
];

for (const vp of viewports) {
  test(`local QA renders cleanly at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto('/?local=1');
    await expect(page.getByRole('main').getByText('Studio', { exact: true })).toBeVisible();
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.topbar')).toBeVisible();
    await expect(page.locator('.canvas-wrap')).toBeVisible();
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });
}

test('light theme toggles cleanly with no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Typekit and Google Fonts can't resolve in the offline test sandbox —
    // ignore those net::ERR_NAME_NOT_RESOLVED noise lines.
    if (text.includes('ERR_NAME_NOT_RESOLVED')) return;
    if (text.includes('Failed to load resource')) return;
    errors.push(text);
  });
  await page.goto('/?local=1');
  await page.getByTitle('Toggle theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});
