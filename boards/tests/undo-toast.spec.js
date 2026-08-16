// Undo affordances, exercised FOR REAL — the first tests in this repo that
// actually press Cmd+Z and click an Undo toast. Runs against ?local=1, whose
// shell now has a genuine (snapshot-stack) undo instead of no-op stubs; the
// Yjs engine's semantics are covered separately by undo-redo.spec.js.
//
// Harness notes (see project_local_test_harness): everything runs on
// `&blank=1` (zoom 1, no auto-frame — the seeded board's auto-frame races
// fixed click positions), with LOW-on-canvas coordinates so the blank
// board's centered "Start your cluster" tiles never intercept the click.
// Free-draw is the `d` keyboard shortcut (off the rail).

import { expect, test } from '@playwright/test';

async function goBlank(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
}

// Create a committed note card with the given text (the boards-smoke flow:
// add-note tool → click canvas → type → click away to commit).
async function createNote(page, text) {
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: { x: 350, y: 540 } });
  await page.locator('.note-body[contenteditable="true"]').last().click();
  await page.keyboard.type(text);
  await page.locator('.canvas-wrap').click({ position: { x: 60, y: 640 } });
  await expect(page.locator('.card', { hasText: text })).toBeVisible();
}

test('delete → Undo toast click restores the card', async ({ page }) => {
  await goBlank(page);
  await createNote(page, 'toast-me');
  const note = page.locator('.card', { hasText: 'toast-me' }).first();
  await note.click({ position: { x: 6, y: 6 } });
  await page.keyboard.press('Backspace');
  await expect(page.locator('.card', { hasText: 'toast-me' })).toHaveCount(0);

  const toast = page.locator('.toast', { hasText: 'Card deleted' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  // The card comes back — the toast is wired to a real undo now, not a stub.
  await expect(page.locator('.card', { hasText: 'toast-me' })).toBeVisible();
});

test('Cmd+Z undoes a delete; Cmd+Shift+Z redoes it (real keypresses)', async ({ page }) => {
  await goBlank(page);
  await createNote(page, 'zundo');
  const note = page.locator('.card', { hasText: 'zundo' }).first();
  await note.click({ position: { x: 6, y: 6 } });
  await page.keyboard.press('Backspace');
  await expect(page.locator('.card', { hasText: 'zundo' })).toHaveCount(0);

  // The delete is the newest step, so ONE Cmd+Z restores it deterministically.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.card', { hasText: 'zundo' })).toBeVisible();

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('.card', { hasText: 'zundo' })).toHaveCount(0);

  // And back once more — the redo stack survives round trips.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.card', { hasText: 'zundo' })).toBeVisible();
});

test('stroke-only delete shows the Undo toast', async ({ page }) => {
  await goBlank(page);
  const canvas = page.locator('.canvas-wrap');
  // Draw a stroke, marquee-select it, delete — this path never toasted.
  await page.keyboard.press('d');
  await canvas.dragTo(canvas, {
    sourcePosition: { x: 300, y: 500 },
    targetPosition: { x: 470, y: 520 },
  });
  await expect(page.locator('.strokes-layer path').first()).toBeVisible();
  await page.getByRole('button', { name: 'Select tool', exact: true }).click();
  await canvas.dragTo(canvas, {
    sourcePosition: { x: 280, y: 470 },
    targetPosition: { x: 500, y: 560 },
  });
  await page.keyboard.press('Backspace');
  await expect(page.locator('.strokes-layer path')).toHaveCount(0);
  await expect(page.locator('.toast', { hasText: 'Deleted' })).toBeVisible();
});
