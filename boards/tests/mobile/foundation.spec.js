import { expect, test } from '@playwright/test';

// Smoke for the P1 foundation. Runs on mobile-chrome, mobile-safari, tablet.
// Verifies the app boots without console errors at touch viewports and that
// the breakpoint hook reports the expected size class.

test('local QA boots on touch viewport without console errors', async ({ page }) => {
  const errors = [];
  // Stub Supabase / partykit URLs are unreachable in tests; ignore the
  // network error noise from both Chromium and WebKit. Applies to both
  // pageerror and console error events.
  const isStubNetNoise = (text = '') =>
    text.includes('ERR_NAME_NOT_RESOLVED') ||
    text.includes('Failed to load resource') ||
    text.includes('specified hostname could not be found') ||
    text.includes('access control checks') ||
    text.includes('example.supabase.co');
  page.on('pageerror', err => {
    if (isStubNetNoise(err.message)) return;
    errors.push(err.message);
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (isStubNetNoise(msg.text())) return;
    errors.push(msg.text());
  });
  await page.goto('/?local=1');
  await page.waitForLoadState('domcontentloaded');
  // Existing shell renders even on phone width — the P1 work only added
  // CSS scoped to @media + new scaffolds that aren't mounted yet, so the
  // current studio shell should still appear. P2 introduces the
  // bottom-nav/drawer swap.
  await expect(page.locator('#root')).toBeVisible();
  await page.waitForTimeout(400);
  expect(errors).toEqual([]);
});

test('safe-area CSS variables resolve', async ({ page }) => {
  await page.goto('/?local=1');
  const values = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      safeTop:    cs.getPropertyValue('--safe-top').trim(),
      safeBottom: cs.getPropertyValue('--safe-bottom').trim(),
      bpPhoneMax: cs.getPropertyValue('--bp-phone-max').trim(),
    };
  });
  // In browser (no Capacitor), env() resolves to 0px via the fallback we set.
  expect(values.safeTop).toBe('0px');
  expect(values.safeBottom).toBe('0px');
  expect(values.bpPhoneMax).toBe('640px');
});

test('body font-size bumps to 15px on phone + touch-tablet widths', async ({ page }) => {
  await page.goto('/?local=1');
  const fontSize = await page.evaluate(() => getComputedStyle(document.body).fontSize);
  // Phone OR a touch tablet ≤1024px (iPad portrait) gets the larger, more
  // readable base size — driven by the same mobile-shell media query as the
  // rest of the shell (styles.css). Plain desktop keeps the denser 13px.
  const mobileShell = await page.evaluate(() => matchMedia(
    '(max-width: 640px), (min-width: 641px) and (max-width: 1024px) and (hover: none) and (pointer: coarse)'
  ).matches);
  expect(fontSize).toBe(mobileShell ? '15px' : '13px');
});
