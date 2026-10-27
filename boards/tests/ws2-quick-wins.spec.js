import { expect, test } from '@playwright/test';

// WS-2 quick wins — spot-checks for the user-visible behaviors.

test('canvas context menu closes on Escape (capture-phase listener)', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  const card = page.locator('.card').first();
  await expect(card).toBeVisible();
  await card.click({ button: 'right' });
  await expect(page.locator('.ctx-menu').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
  // And again on a fresh open — the old {once:true}-style bug broke the 2nd time.
  await card.click({ button: 'right' });
  await expect(page.locator('.ctx-menu').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
});
