import { expect, test } from '@playwright/test';

test('canvas comment draft autofocuses its input on open', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  // Right-click an empty area → background menu → Add comment.
  await page.mouse.click(cb.x + cb.width - 90, cb.y + 110, { button: 'right' });
  await page.locator('.ctx-menu').getByText('Add comment', { exact: true }).first().click();
  const input = page.locator('.canvas-comment-draft-input');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  // Enter posts (the draft textarea already had this) — Shift+Enter would newline.
  await input.fill('hello');
  await input.press('Enter');
  await expect(page.locator('.canvas-comment-draft-input')).toHaveCount(0);
});
