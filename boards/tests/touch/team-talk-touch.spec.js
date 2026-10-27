// /pricing/talk-to-us on touch (TalkToUsPage, talkToUs.css's pointer: coarse
// block): every field, need and button takes a finger at 40px or more, the
// boxes use 16px text so a phone doesn't zoom into them, and the page never
// scrolls sideways.

import { expect, test } from '@playwright/test';

test('Talk to us: finger-sized controls, no zoom-in boxes, no sideways scroll', async ({ page }) => {
  await page.goto('/pricing/talk-to-us');
  await expect(page.getByRole('heading', { level: 1, name: 'Talk to us' })).toBeVisible();

  const controls = page.locator('.tt-card input, .tt-card textarea, .tt-chip, .tt-btn, .tt-back');
  const n = await controls.count();
  expect(n).toBeGreaterThanOrEqual(11);
  for (let i = 0; i < n; i++) {
    const box = await controls.nth(i).boundingBox();
    expect(box.height, `control ${i}`).toBeGreaterThanOrEqual(40);
  }
  const sizes = await page.locator('.tt-in').evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
  for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
