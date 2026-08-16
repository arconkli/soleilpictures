// Drawing/markup undo — the case the user actually reported: draw a line,
// press ⌘Z, the line must go away. Covers BOTH drawing surfaces:
//   - board free-draw (real keypress undo/redo of a drawn stroke), and
//   - the fullscreen sketch pad, which historically had NO undo at all and
//     leaked ⌘Z/Backspace to the canvas hidden behind it.
// Harness: ?local=1&reset=1&blank=1 + low-on-canvas coordinates (the blank
// board's centered tiles eat clicks; free-draw is the `d` shortcut).

import { expect, test } from '@playwright/test';

async function goBlank(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
}

test('draw a board stroke → ⌘Z removes it → ⌘⇧Z restores it', async ({ page }) => {
  await goBlank(page);
  const canvas = page.locator('.canvas-wrap');
  await page.keyboard.press('d');
  await canvas.dragTo(canvas, {
    sourcePosition: { x: 300, y: 500 },
    targetPosition: { x: 470, y: 520 },
  });
  await expect(page.locator('.strokes-layer path').first()).toBeVisible();

  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.strokes-layer path')).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('.strokes-layer path').first()).toBeVisible();
});

test('sketch pad: strokes undo/redo via keys AND buttons; board stays untouched', async ({ page }) => {
  await goBlank(page);
  const canvas = page.locator('.canvas-wrap');

  // A pre-existing, SELECTED note on the board — the isolation canary.
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await canvas.click({ position: { x: 350, y: 540 } });
  await page.locator('.note-body[contenteditable="true"]').last().click();
  await page.keyboard.type('iso-guard');
  await canvas.click({ position: { x: 60, y: 640 } });
  await expect(page.locator('.card', { hasText: 'iso-guard' })).toBeVisible();
  await page.locator('.card', { hasText: 'iso-guard' }).first().click({ position: { x: 6, y: 6 } });
  const cardCount = await page.locator('.card').count();

  // Open the pad from the Draw toolbar.
  await page.keyboard.press('d');
  await page.getByTitle('Open a fullscreen drawing canvas').click();
  const pad = page.locator('.sketchpad-surface');
  await expect(pad).toBeVisible();

  // ISOLATION: keys pressed inside the pad must not touch the board.
  // (⌘Z used to undo canvas state behind the overlay; Backspace used to
  // delete the selected card.)
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('Backspace');

  // Draw two strokes.
  await pad.dragTo(pad, { sourcePosition: { x: 100, y: 100 }, targetPosition: { x: 220, y: 160 } });
  await pad.dragTo(pad, { sourcePosition: { x: 120, y: 220 }, targetPosition: { x: 240, y: 260 } });
  await expect(page.locator('.sketchpad-svg path')).toHaveCount(2);

  // ⌘Z removes the last line — the reported bug, fixed.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.sketchpad-svg path')).toHaveCount(1);

  // The toolbar button removes the first.
  await page.getByRole('button', { name: 'Undo sketch change' }).click();
  await expect(page.locator('.sketchpad-svg path')).toHaveCount(0);

  // Redo twice brings both back (button + key).
  await page.getByRole('button', { name: 'Redo sketch change' }).click();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('.sketchpad-svg path')).toHaveCount(2);

  // Clear is undoable too.
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.locator('.sketchpad-svg path')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.sketchpad-svg path')).toHaveCount(2);

  // Commit, then verify the board: canary intact + exactly one new art card.
  await page.getByRole('button', { name: 'Add to canvas' }).click();
  await expect(pad).toBeHidden();
  await expect(page.locator('.card', { hasText: 'iso-guard' })).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(cardCount + 1);
});
