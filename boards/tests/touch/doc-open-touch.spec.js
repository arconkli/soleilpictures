// A finger opens a doc (2026-10-20). A doc card opened on the browser's own
// double-click and nothing else, and WebKit never makes one out of two taps —
// so on an iPhone or an iPad a doc could only be opened with the two small
// buttons in its footer. Two taps on a doc card now open it, as two clicks do;
// the doc stays open once the second tap's click lands; one tap only selects.
//
// On the real canvas, through ?local=1&richdocs=1 (the doc tool's cards get the
// doc store App gives them), placed with the rail's doc tool, which every
// device shows.
import { expect, test } from '@playwright/test';
import { emptyCanvasPoint, tap } from './helpers.js';

const docCards = (page) => page.locator('.cards-layer .card.card-kind-doc');
const openDoc = (page) => page.locator('.doc-card-modal');

async function placeDoc(page) {
  await page.goto('/?local=1&reset=1&blank=1&richdocs=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Add doc tool' }).tap();
  await tap(page, await emptyCanvasPoint(page));
  await expect(docCards(page)).toHaveCount(1);
  // A doc just added opens, its title ready to name (doc-start-touch.spec.js):
  // Enter goes on to the body, and closing it leaves the card closed, and
  // empty, with Start writing.
  await expect(page.getByRole('textbox', { name: 'Document title' })).toBeFocused({ timeout: 15000 });
  await page.keyboard.press('Enter');
  await openDoc(page).getByRole('button', { name: 'Close document' }).tap();
  await expect(openDoc(page)).toHaveCount(0);
  await expect(docCards(page).getByRole('button', { name: 'Start writing' })).toBeVisible();
}

// A point on the card's preview page: the doc, not its title or its footer;
// near its top, above the Start writing in the middle of an empty one,
// and halfway across, clear of the rail a phone's card can slide under.
async function bodyPoint(page) {
  const box = await docCards(page).locator('.doc-card-page').boundingBox();
  return { x: box.x + box.width / 2, y: box.y + Math.min(12, box.height / 4) };
}

test('two taps on a doc card open the doc, and it stays open', async ({ page }) => {
  await placeDoc(page);
  // Every click that reaches the open doc from here on. The second tap's click
  // arrives after the doc is up, under the same finger: it must press nothing
  // in it — not the backdrop that closes it, not a toolbar button.
  await page.evaluate(() => {
    window.__docClicks = [];
    const note = (e) => {
      if (e.target.closest?.('.doc-card-modal, .doc-card-modal-backdrop')) {
        window.__docClicks.push(`${e.type}:${e.target.className || e.target.tagName}`);
      }
    };
    document.addEventListener('click', note, true);
    document.addEventListener('dblclick', note, true);
  });
  const p = await bodyPoint(page);
  await tap(page, p);
  await page.waitForTimeout(90);
  await tap(page, p);
  await expect(openDoc(page)).toBeVisible();
  await page.waitForTimeout(700);
  await expect(openDoc(page)).toBeVisible();
  expect(await page.evaluate(() => window.__docClicks)).toEqual([]);
});

test('one tap on a doc card selects it and opens nothing', async ({ page }) => {
  await placeDoc(page);
  await tap(page, await bodyPoint(page));
  await expect(docCards(page)).toHaveClass(/is-selected/);
  await page.waitForTimeout(700);
  await expect(openDoc(page)).toHaveCount(0);
});

test('two taps on the title rename the doc instead of opening it', async ({ page }) => {
  await placeDoc(page);
  // Leave the new doc's rename first, so the title is a closed label again.
  await tap(page, await emptyCanvasPoint(page));
  const box = await docCards(page).locator('.doc-card-title').boundingBox();
  const p = { x: box.x + Math.min(40, box.width / 2), y: box.y + box.height / 2 };
  await tap(page, p);
  await page.waitForTimeout(90);
  await tap(page, p);
  await expect(docCards(page).locator('.doc-card-title')).toHaveAttribute('contenteditable', 'true');
  await page.waitForTimeout(500);
  await expect(openDoc(page)).toHaveCount(0);
});
