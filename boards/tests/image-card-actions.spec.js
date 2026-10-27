// An image card's actions (Edit photo, Download, View full size) appear when
// the pointer is over the image. The keys reach them too, but tabbing onto one
// left the strip invisible: a button had the focus at opacity 0. The strip
// shows while one of its buttons has the keyboard's focus.
import { expect, test } from '@playwright/test';

test('an image card\'s actions show while the keys are on one of them', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  const card = page.locator('.canvas-wrap .card[data-card-id="home-image"]');
  await card.waitFor({ timeout: 30000 });
  const strip = card.locator('.ic-actions');
  await expect(strip).toHaveCSS('opacity', '0');
  const actions = strip.getByRole('button');
  await expect(actions).toHaveText(['', '', '']);
  // Their tooltips are the glass one (lib/looks.js tlTip).
  expect(await actions.evaluateAll((els) => els.map((el) => el.dataset.tlTip))).toEqual(['Edit photo', 'Download', 'View full size']);
  // A key first, so focus that follows counts as the keyboard's.
  await page.keyboard.press('Shift');
  await strip.getByRole('button', { name: 'Edit photo' }).focus();
  await page.keyboard.press('Tab');
  await expect(strip.getByRole('button', { name: 'Download' })).toBeFocused();
  await expect(strip).toHaveCSS('opacity', '1');
  // Off the strip, it hides again.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(strip).toHaveCSS('opacity', '0');
});
