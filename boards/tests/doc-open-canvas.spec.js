// A doc on the canvas opens on a double-click, and only on its own: the
// canvas's finger double tap (tests/touch/doc-open-touch.spec.js) left the
// mouse path to RichDocCard, and this holds it there. On the real canvas,
// through ?local=1&richdocs=1.
import { expect, test } from '@playwright/test';

const docCards = (page) => page.locator('.cards-layer .card.card-kind-doc');

async function placeDoc(page) {
  await page.goto('/?local=1&reset=1&blank=1&richdocs=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Add doc tool' }).click();
  const wrap = await page.locator('.canvas-wrap').boundingBox();
  await page.mouse.click(wrap.x + wrap.width * 0.7, wrap.y + wrap.height * 0.45);
  await expect(docCards(page)).toHaveCount(1);
  await expect(docCards(page).getByRole('button', { name: 'Open fullscreen' })).toBeVisible();
  // Leave the new doc's rename, so the title is a closed label again.
  await page.keyboard.press('Enter');
}

test('double-clicking a doc card opens the doc', async ({ page }) => {
  await placeDoc(page);
  await docCards(page).locator('.doc-card-page').dblclick();
  await expect(page.locator('.doc-card-modal')).toBeVisible();
});

test('double-clicking the doc card\'s title renames it instead', async ({ page }) => {
  await placeDoc(page);
  await docCards(page).locator('.doc-card-title').dblclick();
  await expect(docCards(page).locator('.doc-card-title')).toHaveAttribute('contenteditable', 'true');
  await page.waitForTimeout(400);
  await expect(page.locator('.doc-card-modal')).toHaveCount(0);
});
