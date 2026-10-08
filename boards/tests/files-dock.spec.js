// Files beside the board — one view, two sizes (src/lib/filesDock.js,
// src/components/FilesDock.jsx), driven through the ?local=1 harness.
import { expect, test } from '@playwright/test';

async function go(page, { width = 1440, height = 900 } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => {
    try { localStorage.removeItem('soleil.files.dock'); localStorage.setItem('soleil.files.dockHint', '1'); } catch (_) {}
    window.history.replaceState(null, '', '/?local=1');
  });
  await page.reload();
  await expect(page.locator('.rail-brand')).toBeVisible();
  // Keyboard focus on the board, not in any field.
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: 300 } });
}

const panel = (page) => page.locator('.list-wrap.is-panel');
const fullFiles = (page) => page.locator('.list-wrap:not(.is-panel)');
const filesSeg = (page) => page.getByRole('button', { name: 'Files', exact: true });
const boardSeg = (page) => page.getByRole('button', { name: 'Board', exact: true });

test('F opens Files beside the board, and the board stays live', async ({ page }) => {
  await go(page);
  await page.keyboard.press('f');
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(filesSeg(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(boardSeg(page)).toHaveAttribute('aria-pressed', 'false');
  // The board still takes clicks: selecting a card works with the panel open.
  await page.locator('.card.card-kind-image').first().click();
  await expect(page.locator('.card.card-kind-image.selected, .card.card-kind-image.is-selected').first()).toBeVisible();
  // F again puts Files away.
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: 300 } });
  await page.keyboard.press('f');
  await expect(panel(page)).toHaveCount(0);
  await expect(boardSeg(page)).toHaveAttribute('aria-pressed', 'true');
});

test('the topbar opens the panel, Board closes it, and the panel has its own close', async ({ page }) => {
  await go(page);
  await filesSeg(page).click();
  await expect(panel(page)).toBeVisible();
  await boardSeg(page).click();
  await expect(panel(page)).toHaveCount(0);
  await filesSeg(page).click();
  await page.getByRole('button', { name: 'Close Files' }).click();
  await expect(panel(page)).toHaveCount(0);
});

test('expand fills the pane with Files; Beside board docks it again; F from full goes to the board', async ({ page }) => {
  await go(page);
  await page.keyboard.press('f');
  await page.getByRole('button', { name: 'Expand Files to full screen' }).click();
  await expect(fullFiles(page)).toBeVisible();
  await expect(page.locator('.canvas-wrap')).toHaveCount(0);
  await page.getByRole('button', { name: /Beside board/ }).click();
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Expand Files to full screen' }).click();
  await expect(fullFiles(page)).toBeVisible();
  await page.locator('.list-wrap').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('f');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('.list-wrap')).toHaveCount(0);
});

test('dragging the divider resizes the panel, and far enough expands it', async ({ page }) => {
  await go(page);
  await page.keyboard.press('f');
  const divider = page.getByRole('separator', { name: 'Resize Files' });
  await expect(divider).toBeVisible();
  const box = await divider.boundingBox();
  const before = (await page.locator('.fdl-files').boundingBox()).width;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const after = (await page.locator('.fdl-files').boundingBox()).width;
  expect(after).toBeGreaterThan(before + 80);
  // Most of the way across → full Files.
  const box2 = await divider.boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(300, box2.y + box2.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(fullFiles(page)).toBeVisible();
  await expect(page.locator('.canvas-wrap')).toHaveCount(0);
});

test('with no room for a panel, F opens full-screen Files', async ({ page }) => {
  await go(page, { width: 800, height: 900 });
  await page.keyboard.press('f');
  await expect(fullFiles(page)).toBeVisible();
  await expect(page.locator('.canvas-wrap')).toHaveCount(0);
});

test('double-clicking a file in the panel keeps the board and the panel open', async ({ page }) => {
  await go(page);
  await page.keyboard.press('f');
  await expect(panel(page)).toBeVisible();
  const tile = panel(page).locator('.ct-tile').filter({ hasText: 'KEY ART' }).first();
  await tile.dblclick();
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('.canvas-wrap')).toBeVisible();
});
