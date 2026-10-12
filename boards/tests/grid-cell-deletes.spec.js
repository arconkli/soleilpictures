import { expect, test } from '@playwright/test';

// Deleting content inside a grid follows the house rule (an Undo toast), and
// removing a line never silently takes an image or text with it.
//   CARDS-05 — removing a line moves the removed side's content into an empty
//              neighbour; when both sides hold content it names the loss.
//   CARDS-10 — Clear on a filled cell shows the Undo toast.
//   CARDS-18 — a double-clicked cell left without a word goes back to empty.

async function addGrid(page) {
  const canvas = page.locator('.canvas-wrap');
  await canvas.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: rect.left + 520, clientY: rect.top + 150,
    }));
  });
  const menu = page.locator('.ctx-menu').first();
  await expect(menu).toBeVisible();
  await menu.locator('.ctx-submenu-wrap', { hasText: 'Add' }).hover();
  await page.locator('.ctx-submenu').getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.locator('.gridc-cell')).toHaveCount(3);
}

const grid = (page) => page.locator('.card-kind-grid').first();
const cellAt = (page, n) => grid(page).locator('.gridc-cell').nth(n);
const select = async (page) => {
  await grid(page).click({ position: { x: 180, y: 8 } });
  await expect(grid(page)).toHaveClass(/is-selected/);
};

// Type into cell n (0 = top, 1 = bottom-left, 2 = bottom-right) via the chooser.
async function typeInto(page, n, text) {
  const cell = cellAt(page, n);
  await cell.hover();
  await cell.getByRole('button', { name: 'Text', exact: true }).click();
  const editor = page.locator('.gridc-cell [contenteditable="true"]').first();
  await editor.waitFor({ state: 'visible' });
  await editor.click();
  await page.keyboard.type(text);
  await editor.evaluate((el) => el.blur());
  await page.locator('.canvas-wrap').click({ position: { x: 60, y: 60 } });
  await expect(cellAt(page, n).locator('.gc-text')).toContainText(text);
}

async function removeBottomLine(page) {
  await select(page);
  const line = grid(page).locator('.gridc-divider-x.is-grabbable').first();
  // The line is a few px wide between two cells; hover its middle directly.
  await line.hover({ force: true });
  await line.locator('.gridc-divider-rm').click();
  await expect(grid(page).locator('.gridc-cell')).toHaveCount(2);
}

test.describe('grid cell deletes', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?local=1&reset=1&blank=1');
    await page.waitForSelector('.canvas-wrap');
    await addGrid(page);
  });

  test('removing a line beside an empty cell keeps the content', async ({ page }) => {
    await select(page);
    await typeInto(page, 2, 'Right side');
    await removeBottomLine(page);
    await expect(grid(page).locator('.gc-text')).toContainText('Right side');
    await expect(page.locator('.toast-msg')).toHaveCount(0);
  });

  test('removing a line between two filled cells names the loss with Undo', async ({ page }) => {
    await select(page);
    await typeInto(page, 1, 'Left');
    await select(page);
    await typeInto(page, 2, 'Right');
    await removeBottomLine(page);
    await expect(page.locator('.toast-msg', { hasText: 'Removed a filled cell' })).toBeVisible();
    await expect(page.locator('.toast').getByRole('button', { name: 'Undo' })).toBeVisible();
  });

  test('Clear on a filled cell shows the Undo toast', async ({ page }) => {
    await select(page);
    await typeInto(page, 1, 'Gone soon');
    await select(page);
    const cell = cellAt(page, 1);
    await cell.hover({ position: { x: 20, y: 20 } });
    await cell.locator('.gridc-cell-x').click();
    await expect(page.locator('.toast-msg', { hasText: 'Cell cleared' })).toBeVisible();
    await expect(cellAt(page, 1)).toHaveClass(/is-empty/);
  });

  test('a double-clicked cell left blank goes back to empty', async ({ page }) => {
    await select(page);
    await cellAt(page, 1).dblclick({ position: { x: 20, y: 20 } });
    await expect(page.locator('.gridc-cell [contenteditable="true"]')).toBeVisible();
    await page.locator('.canvas-wrap').click({ position: { x: 60, y: 60 } });
    await expect(page.locator('.gridc-cell [contenteditable="true"]')).toHaveCount(0);
    await expect(cellAt(page, 1)).toHaveClass(/is-empty/);
  });
});
