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

// A fullscreen doc covers the canvas, so it owns the keyboard: Escape closes
// it once the caret is out of its text, and a key meant for the canvas never
// reaches the cards hidden behind it. The canvas's own Escape (clear the
// selection) used to take the key first, so the doc stayed open.
async function openFullscreen(page) {
  await docCards(page).getByRole('button', { name: 'Open fullscreen' }).click();
  await expect(page.locator('.doc-card-modal-full')).toBeVisible();
  await expect(page.locator('.doc-card-modal .ProseMirror')).toBeVisible({ timeout: 15000 });
}
// Where a click on the page's grey surround leaves things: nothing focused,
// no caret in any text.
const leaveTheText = (page) => page.evaluate(() => {
  document.activeElement?.blur?.();
  window.getSelection()?.removeAllRanges();
});

test('Escape closes a fullscreen doc once the caret is out of its text', async ({ page }) => {
  await placeDoc(page);
  await openFullscreen(page);
  await leaveTheText(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.doc-card-modal')).toHaveCount(0);
});

test('Escape while writing in a fullscreen doc leaves it open', async ({ page }) => {
  await placeDoc(page);
  await openFullscreen(page);
  await page.locator('.doc-card-modal .ProseMirror').click();
  await page.keyboard.type('Scene one');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await expect(page.locator('.doc-card-modal')).toHaveCount(1);
  await expect(page.locator('.doc-card-modal .ProseMirror')).toContainText('Scene one');
});

test('Backspace in a fullscreen doc never deletes the cards behind it', async ({ page }) => {
  await placeDoc(page);
  // Select the card first: Backspace on the canvas deletes the selection.
  await docCards(page).locator('.doc-card-page').click();
  await expect(docCards(page)).toHaveClass(/selected/);
  await openFullscreen(page);
  await leaveTheText(page);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Meta+d');
  await page.waitForTimeout(300);
  await expect(page.locator('.doc-card-modal')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close document' }).click();
  await expect(docCards(page)).toHaveCount(1);
});

// One Escape, one layer: a menu inside the doc takes its Escape, and only the
// next one closes the doc.
for (const [label, menu] of [['Insert a block', '.doc-insert-menu'], ['Export', '.doc-export-menu']]) {
  test(`Escape closes the doc's ${label} menu first, then the doc`, async ({ page }) => {
    await placeDoc(page);
    await openFullscreen(page);
    await page.locator('.doc-card-modal').getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator(menu)).toBeVisible();
    await leaveTheText(page);
    await page.keyboard.press('Escape');
    await expect(page.locator(menu)).toHaveCount(0);
    await page.waitForTimeout(200);
    await expect(page.locator('.doc-card-modal')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.doc-card-modal')).toHaveCount(0);
  });
}
