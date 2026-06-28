import { expect, test } from '@playwright/test';

// Wheel routing over notes. A note whose text overflows (autosize caps at
// NOTE_AUTOSIZE_MAX) must be wheel-scrollable while EDITING or SELECTED —
// the canvas wheel handler used to preventDefault everything and pan the
// canvas instead, so the only way to scroll a clipped note was dragging its
// scrollbar (and a wheel mid-edit flung the note off-screen). Unselected
// notes keep the canvas pan, and ctrl/cmd+wheel keeps zooming everywhere.

const transformOf = (page) => page.evaluate(() => {
  let tEl = null;
  document.querySelectorAll('.canvas-wrap div').forEach(el => {
    if (!tEl && el.style.transform && el.style.transform.includes('translate3d')) tEl = el;
  });
  return tEl ? tEl.style.transform : null;
});

async function placeOverflowingNote(page) {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: { x: 640, y: 200 } });
  const body = page.locator('.note-body[contenteditable="true"]');
  await body.waitFor();
  await body.click();
  for (let i = 1; i <= 35; i++) {
    await page.keyboard.type(`line ${i}`);
    if (i < 35) await page.keyboard.press('Enter');
  }
  // Editing body must actually overflow for the scroll assertions to mean
  // anything (autosize caps the card height well below 35 lines).
  await expect.poll(() => body.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(40);
  return body;
}

test('wheel over an EDITING clipped note scrolls its text, not the canvas', async ({ page }) => {
  const body = await placeOverflowingNote(page);
  const box = await body.boundingBox();
  const tfBefore = await transformOf(page);

  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(60, box.height / 2));
  await page.mouse.wheel(0, 240);
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await transformOf(page)).toBe(tfBefore);
});

test('wheel over a SELECTED (not editing) clipped note scrolls its text', async ({ page }) => {
  const body = await placeOverflowingNote(page);
  // Blur-commit, then click once to select.
  await page.locator('.canvas-wrap').click({ position: { x: 150, y: 650 } });
  await expect(page.locator('.note-body[contenteditable="true"]')).toHaveCount(0);
  const note = page.locator('.card .note').last();
  await note.click();
  await expect(page.locator('.card.is-selected')).toHaveCount(1);

  const roBody = note.locator('.note-body');
  const box = await roBody.boundingBox();
  const tfBefore = await transformOf(page);
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(60, box.height / 2));
  await page.mouse.wheel(0, 240);
  await expect.poll(() => roBody.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await transformOf(page)).toBe(tfBefore);
});

test('wheel over an UNSELECTED note still pans the canvas', async ({ page }) => {
  const body = await placeOverflowingNote(page);
  // Blur-commit and leave nothing selected.
  await page.locator('.canvas-wrap').click({ position: { x: 150, y: 650 } });
  await expect(page.locator('.card.is-selected')).toHaveCount(0);

  const note = page.locator('.card .note').last();
  const roBody = note.locator('.note-body');
  const box = await roBody.boundingBox();
  const tfBefore = await transformOf(page);
  // The body may carry a leftover scrollTop from edit-mode typing — assert
  // the wheel doesn't CHANGE it, not that it's zero.
  const stBefore = await roBody.evaluate(el => el.scrollTop);
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(60, box.height / 2));
  await page.mouse.wheel(0, 240);
  await expect.poll(() => transformOf(page)).not.toBe(tfBefore);
  expect(await roBody.evaluate(el => el.scrollTop)).toBe(stBefore);
});

test('ctrl+wheel over an editing note still zooms the canvas', async ({ page }) => {
  const body = await placeOverflowingNote(page);
  const box = await body.boundingBox();
  const tfBefore = await transformOf(page);
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(60, box.height / 2));
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  await expect.poll(() => transformOf(page)).not.toBe(tfBefore);
});
