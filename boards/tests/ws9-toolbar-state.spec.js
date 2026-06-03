import { expect, test } from '@playwright/test';

test('note format buttons reflect active state + size picker shows current size', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByTitle('Add note').click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });
  await page.keyboard.type('hello world');
  await page.keyboard.press('ControlOrMeta+a');

  const boldBtn = page.getByTitle('Bold (⌘B)');
  await expect(boldBtn).toBeVisible();
  await expect(boldBtn).not.toHaveClass(/is-active/);

  // Bold → button becomes active; unbold → inactive again.
  await page.keyboard.press('ControlOrMeta+b');
  await expect(boldBtn).toHaveClass(/is-active/);
  await page.keyboard.press('ControlOrMeta+b');
  await expect(boldBtn).not.toHaveClass(/is-active/);

  // The size dropdown reflects the caret's font size instead of the blank
  // "Size" placeholder.
  const size = page.locator('.tob-select').first();
  await expect(size).not.toHaveValue('');
});
