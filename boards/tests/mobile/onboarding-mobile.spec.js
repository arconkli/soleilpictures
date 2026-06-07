import { expect, test } from '@playwright/test';

// The first-run onboarding board must be USABLE on a phone. The bulk of new
// users arrive on mobile, so the seeded starter cards have to lay out in a
// readable column (not auto-fit to a tiny ~35% zoom, which is what the old wide
// desktop spread did on a ~390px canvas) and the copy has to be touch-aware
// (no bare "right-click", which means nothing without a mouse).

test.beforeEach(async ({ page }) => {
  await page.goto('/?local=1&onboard=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
});

test('starter cards render at a readable zoom and stay within the viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'mobile onboarding layout');

  await expect(page.locator('[data-card-id]').first()).toBeVisible();

  // Fit-to-content must not zoom out to an unreadable level. Before the fix the
  // content spanned ~670px and forced ~35% on a 390px phone; the column layout
  // keeps it readable (~77%).
  await expect
    .poll(async () => page.evaluate(() => {
      const el = document.querySelector('.cnv-zoom-val');
      return el ? parseInt(el.textContent, 10) : 0;
    }), { timeout: 4000 })
    .toBeGreaterThanOrEqual(55);

  // No seeded card sits off-screen (the user shouldn't have to pan to find them).
  const offscreen = await page.evaluate(() => {
    const vw = window.innerWidth;
    return [...document.querySelectorAll('[data-card-id]')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > vw + 2 || r.left < -2;
    }).length;
  });
  expect(offscreen).toBe(0);
});

test('onboarding copy is touch-aware on a touch device', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'touch copy');
  const coarse = await page.evaluate(() =>
    window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  test.skip(!coarse, 'requires a coarse-pointer (touch) device');

  // The welcome note tells touch users to long-press / tap — never "right-click".
  const welcome = (await page.locator('[data-card-id="onb-welcome"]').innerText()).toLowerCase();
  expect(welcome).toContain('long-press');
  expect(welcome).not.toContain('right-click');

  // The coachmark nudge is touch-aware too (when present).
  const coach = page.locator('.onboarding-coachmark-body');
  if (await coach.count()) {
    expect((await coach.innerText()).toLowerCase()).not.toContain('right-click');
  }
});
