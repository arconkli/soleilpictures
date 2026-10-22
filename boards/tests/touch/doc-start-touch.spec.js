// How a doc starts in the doc look, under a finger (mockups S-card, S-phone),
// held to a dev opt-in (lib/appHost.js docLookAllowed): one tap on an empty
// doc card's Start writing opens it. On the real canvas, through
// ?local=1&richdocs=1, placed with the rail's doc tool.
import { expect, test } from '@playwright/test';
import { emptyCanvasPoint, tap } from './helpers.js';

const docCards = (page) => page.locator('.cards-layer .card.card-kind-doc');
const win = (page) => page.locator('.doc-card-modal');

test('one tap on Start writing opens an empty doc', async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('soleil.dev.docLook', '1'); } catch (_) {}
  });
  await page.goto('/?local=1&reset=1&blank=1&richdocs=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Add doc tool' }).tap();
  await tap(page, await emptyCanvasPoint(page));
  await expect(docCards(page)).toHaveCount(1);
  // A doc just added opens at once; close it to reach the card.
  await expect(win(page)).toBeVisible();
  await win(page).getByRole('button', { name: 'Close document' }).tap();
  await expect(win(page)).toHaveCount(0);
  const start = docCards(page).getByRole('button', { name: 'Start writing' });
  await expect(start).toBeVisible();
  const box = await start.boundingBox();
  await tap(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await expect(win(page)).toBeVisible();
});
