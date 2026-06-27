import { expect, test } from '@playwright/test';

// Keyboard-shortcuts overlay — opened with "?" or the toolbar help button;
// suppressed while typing in an editor.

test('"?" toggles the shortcuts overlay; Escape closes it', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();

  await page.keyboard.press('Shift+?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Select / move');
  await expect(dialog).toContainText('Drag a card onto a board card');

  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('help button in the toolbar opens the overlay', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();

  await page.getByLabel('Keyboard shortcuts').click();
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});

test('"?" while editing a note types instead of opening the overlay', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByTitle('Add note (N)').click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });

  await page.keyboard.type('really?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeVisible();
  await expect(page.locator('.card .note-body').last()).toContainText('really?');
});

test('empty board shows add-card tiles; double-click drops a note and clears them', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();

  // The local root board ships full of demo cards — create a fresh board
  // and open it to get an empty canvas.
  await page.getByTitle('Add board').click();
  const wrap = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: wrap.width / 2, y: wrap.height / 2 } });
  const newBoard = page.locator('.card', { hasText: 'Untitled board' }).first();
  await newBoard.dblclick();
  await expect(page.locator('.cnv-empty-tiles')).toHaveCount(1);

  const cb = await page.locator('.canvas-wrap').boundingBox();
  // Double-click on BARE canvas — offset away from the centered tiles panel
  // (and clear of the left tool rail / bottom-right zoom control).
  await page.locator('.canvas-wrap').dblclick({ position: { x: 160, y: cb.height - 140 } });

  // Double-click on the bare canvas creates a note in edit mode...
  await expect(page.locator('.card .note-body[contenteditable="true"]')).toBeVisible();
  // ...and the board is no longer empty, so the tiles go away.
  await expect(page.locator('.cnv-empty-tiles')).toHaveCount(0);
});

test('N / D / A keys switch tools', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();

  await page.keyboard.press('n');
  await expect(page.locator('.cnv-hint')).toContainText('place a note');
  await page.keyboard.press('d');
  await expect(page.locator('.cnv-hint')).toContainText('Drag to draw');
  await page.keyboard.press('a');
  await expect(page.locator('.cnv-hint')).toContainText('free arrow');
  await page.keyboard.press('Escape');
  await expect(page.locator('.cnv-hint')).not.toBeVisible();
});
