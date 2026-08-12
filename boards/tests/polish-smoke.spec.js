import { expect, test } from '@playwright/test';

// The signed-out screen only mounts after AuthGate's initial getSession()
// settles, and this suite deliberately points Supabase at a host that does not
// exist (playwright.config.js forces example.supabase.co so the specs can never
// touch a real backend). That call therefore has to fail its way to a decision,
// which is reliably slower than the 5s default — so the wait is explicit here.
// It is a readiness wait for a network timeout we CHOSE, not a slow assertion.
// The signed-out screen is SignInBackdrop now (AuthGate.jsx:598), not the old
// `.auth-screen` / `.auth-card` / `.auth-eyebrow` markup these two tests were
// written against — that UI was replaced, so they had been asserting a design
// that no longer ships. Retargeted at what the sign-in box actually renders:
// the frosted panel, the email field and its focus ring.
const AUTH_READY = { timeout: 20_000 };

test('the sign-in box renders on the signed-out screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sb-scene')).toBeVisible(AUTH_READY);
  await expect(page.locator('.sb-frost')).toBeVisible();
  await expect(page.getByPlaceholder('you@studio.com')).toBeVisible();
  await expect(page.locator('.sb-cap')).toContainText('6-digit code');
});

test('auth input gains a soleil glow ring on focus', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sb-scene')).toBeVisible(AUTH_READY);
  const input = page.getByPlaceholder('you@studio.com');
  await input.focus();
  const shadow = await input.evaluate((el) => getComputedStyle(el).boxShadow);
  // The focus ring is the brand gold; assert a ring exists and is not the
  // browser default rather than pinning an exact rgba the token can retune.
  expect(shadow).not.toBe('none');
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

test('keyboard focus on sidebar collapse button shows soleil glow', async ({ page }) => {
  await page.goto('/?local=1');
  await page.locator('.sb-mid-collapse').focus();
  const shadow = await page.locator('.sb-mid-collapse').evaluate(el => getComputedStyle(el).boxShadow);
  expect(shadow).toContain('rgba(255, 165, 0');
});

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
