import { expect, test } from '@playwright/test';

// The notifications bell on a phone (placement C): in the top bar right
// before Share, and the list as a full-screen sheet with a ×. Runs on the
// sidebar QA harness's Files page, which keeps App's phone top bar.

async function open(page) {
  await page.goto('/?sidebarqa=1&surface=files&drawer=0');
  await page.waitForSelector('[data-sidebarqa-ready]');
}
const rect = (loc) => loc.evaluate((el) => el.getBoundingClientRect().toJSON());

test('the bell sits before Share and opens a full-screen sheet that × closes', async ({ page }) => {
  await open(page);
  const bell = page.locator('.topbar .tb-right .nb-bell');
  await expect(bell).toBeVisible();
  await expect(bell.locator('.nb-count')).toHaveText('3');
  const next = await bell.evaluate((el) => el.nextElementSibling?.className || '');
  expect(next).toMatch(/tb-share/);
  // A finger-wide target.
  const b = await rect(bell);
  expect(b.width).toBeGreaterThanOrEqual(40);
  expect(b.height).toBeGreaterThanOrEqual(40);
  // Nothing in the top bar spills off the screen.
  const vw = page.viewportSize().width;
  const share = await rect(page.locator('.topbar .tb-share'));
  expect(share.right).toBeLessThanOrEqual(vw + 0.5);

  await bell.tap();
  const sheet = page.locator('.ntf-shell.is-sheet');
  await expect(sheet).toBeVisible();
  const s = await rect(sheet);
  const vh = page.viewportSize().height;
  expect(s.left).toBe(0);
  expect(s.top).toBe(0);
  expect(Math.round(s.width)).toBe(vw);
  expect(Math.round(s.height)).toBe(vh);
  // Head: 56px, Mark all read and a 44px ×.
  expect(Math.round((await rect(sheet.locator('.ntf-head'))).height)).toBe(56);
  await expect(sheet.locator('.ntf-markall')).toBeVisible();
  const x = await rect(sheet.locator('.ntf-x'));
  expect(Math.round(x.width)).toBe(44);
  expect(Math.round(x.height)).toBe(44);
  // Rows at least 44px tall.
  for (const r of await sheet.locator('.ntf-row').all()) {
    expect((await rect(r)).height).toBeGreaterThanOrEqual(44);
  }
  await sheet.locator('.ntf-x').tap();
  await expect(page.locator('.ntf-shell')).toHaveCount(0);
});
