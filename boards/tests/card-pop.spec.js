// A new card pops in (.is-new, ~280ms: CanvasSurface's newCardIds), then
// settles. Two arriving inside that window each settle: the second used to
// cancel the first's timer and leave it marked new for good, so its pop could
// replay. On the real canvas, through ?local=1.
import { expect, test } from '@playwright/test';

test('two cards added in quick succession both settle', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  const card = page.locator('.canvas-wrap .card[data-card-id="home-image"]');
  await expect(card).toBeVisible({ timeout: 30000 });
  await card.click();
  const before = await page.locator('.canvas-wrap .card').count();
  await page.keyboard.press('ControlOrMeta+d');
  await page.keyboard.press('ControlOrMeta+d');
  await expect(page.locator('.canvas-wrap .card')).toHaveCount(before + 2);
  await expect(page.locator('.canvas-wrap .card.is-new')).toHaveCount(0, { timeout: 2000 });
});
