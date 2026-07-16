// The mobile add sheet must open across the WHOLE mobile shell — phones AND
// touch tablets / landscape phones (isPhone false but mobileShell true, so the
// bottom-nav "+" puck still renders). If the sheet is gated on isPhone alone,
// tapping "+" on a non-empty board on a tablet/landscape phone does nothing —
// dead-ending the mobile tour's "Tap + then Cluster" group step.
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'mobile shell only (phone + touch tablet)');
});

test('non-empty board: the "+" puck opens the add sheet across the mobile shell', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Add a card' }).tap();
  await expect(page.locator('.mobile-add-grid')).toBeVisible();
});
