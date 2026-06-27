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
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  // Place on a CLEAR patch — the local root ships full of demo cards, so a click
  // at the centre lands on one and places nothing (the card eats the pointer).
  await page.locator('.canvas-wrap').click({ position: { x: 160, y: cb.height - 140 } });

  await page.keyboard.type('really?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeVisible();
  await expect(page.locator('.card .note-body').last()).toContainText('really?');
});

test('empty board shows add-card tiles; double-click opens the quick-add menu', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();

  // The local root board ships full of demo cards — create a fresh board
  // and open it to get an empty canvas.
  await page.getByRole('button', { name: 'Add board tool', exact: true }).click();
  const wrap = await page.locator('.canvas-wrap').boundingBox();
  // Place the new board on a CLEAR patch (centre is covered by demo cards).
  await page.locator('.canvas-wrap').click({ position: { x: 160, y: wrap.height - 140 } });
  const newBoard = page.locator('.card', { hasText: 'Untitled board' }).first();
  await newBoard.dblclick();
  await expect(page.locator('.cnv-empty-tiles')).toHaveCount(1);

  const cb = await page.locator('.canvas-wrap').boundingBox();
  // Double-click on BARE canvas — offset away from the centered tiles panel
  // (and clear of the left tool rail / bottom-right zoom control).
  await page.locator('.canvas-wrap').dblclick({ position: { x: 160, y: cb.height - 140 } });

  // Double-click no longer reflexively drops a note — it opens the quick-add
  // menu so the user chooses what to add. The board stays empty (tiles remain)
  // until a menu item is picked.
  const menu = page.locator('.cnv-quick-add');
  await expect(menu).toBeVisible();
  await expect(page.locator('.cnv-empty-tiles')).toHaveCount(1);

  // Choosing "Note" creates a note in edit mode and clears the tiles.
  await menu.locator('.cnv-quick-add-item', { hasText: 'Note' }).click();
  await expect(page.locator('.card .note-body[contenteditable="true"]')).toBeVisible();
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
