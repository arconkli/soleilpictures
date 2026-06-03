import { expect, test } from '@playwright/test';

test('sketch-pad discard prompt uses the in-app dialog (not native confirm)', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByTitle('Free-draw').click();
  await page.getByTitle('Open a fullscreen drawing canvas').click();
  const pad = page.locator('.sketchpad-surface');
  await expect(pad).toBeVisible();

  // Draw a stroke so the discard prompt triggers.
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 100, { steps: 6 });
  await page.mouse.up();

  // Escape → in-app confirm dialog (a native window.confirm wouldn't render
  // a .feedback-dialog node and would block the event loop instead).
  await page.keyboard.press('Escape');
  const dialog = page.locator('.feedback-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Discard sketch?');
  // FeedbackOverlay close button now uses the shared X icon (svg), not 'x' text.
  await expect(dialog.locator('.modal-x svg')).toBeVisible();

  // Keep editing — cancel the discard, pad stays open.
  await dialog.getByRole('button', { name: /cancel|keep/i }).first().click();
  await expect(pad).toBeVisible();
});
