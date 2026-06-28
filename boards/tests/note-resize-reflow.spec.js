import { expect, test } from '@playwright/test';

// Note resize reflow — height follows the text when the drag is mostly
// horizontal, so resizing a note never hides text behind an invisible
// scroll. A deliberate vertical pull (>16px) hands height back to the
// pointer (legacy free-resize).

const LONG_TEXT =
  'The quick brown fox jumps over the lazy dog while the band plays on ' +
  'and the credits roll past the harbor lights in the long summer dusk.';

async function placeNoteWithText(page) {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });
  await page.keyboard.type(LONG_TEXT);
  // Commit the edit (blur — Escape would revert).
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: cb.height - 30 } });
  const card = page.locator('.card:has(.note-body)').last();
  await expect(card.locator('.note-body')).toContainText('quick brown fox');
  return card;
}

async function dragHandle(page, card, dx, dy) {
  const handle = card.locator('.card-resize');
  // Card must be selected for the handle to be interactable.
  await card.click();
  const hb = await handle.boundingBox();
  const sx = hb.x + hb.width / 2;
  const sy = hb.y + hb.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dx / 2, sy + dy / 2, { steps: 5 });
  await page.mouse.move(sx + dx, sy + dy, { steps: 5 });
  await page.mouse.up();
}

async function overflowState(card) {
  return card.locator('.note-body').evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
}

test('narrowing a note reflows height so text still fits', async ({ page }) => {
  const card = await placeNoteWithText(page);
  const before = await card.boundingBox();

  // Mostly-horizontal drag: width shrinks, height should follow the text.
  await dragHandle(page, card, -Math.round(before.width * 0.45), 0);

  const after = await card.boundingBox();
  expect(after.width).toBeLessThan(before.width - 30);
  expect(after.height).toBeGreaterThan(before.height + 10); // re-wrapped taller
  const { scrollHeight, clientHeight } = await overflowState(card);
  expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 2); // no hidden text
});

test('widening a narrowed note shrinks height back', async ({ page }) => {
  const card = await placeNoteWithText(page);
  await dragHandle(page, card, -Math.round((await card.boundingBox()).width * 0.45), 0);
  const narrow = await card.boundingBox();

  await dragHandle(page, card, Math.round(narrow.width * 0.9), 0);

  const wide = await card.boundingBox();
  expect(wide.width).toBeGreaterThan(narrow.width + 30);
  expect(wide.height).toBeLessThan(narrow.height - 10);
  const { scrollHeight, clientHeight } = await overflowState(card);
  expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 2);
});

test('a deliberate vertical pull keeps pointer-controlled height (can clip)', async ({ page }) => {
  const card = await placeNoteWithText(page);
  const before = await card.boundingBox();

  // Strong vertical component latches height mode; pin the note well
  // below its content height.
  await dragHandle(page, card, -Math.round(before.width * 0.35), -Math.round(before.height * 0.45));

  const after = await card.boundingBox();
  expect(after.height).toBeLessThan(before.height - 20);
  const { scrollHeight, clientHeight } = await overflowState(card);
  expect(scrollHeight).toBeGreaterThan(clientHeight + 2); // user pinned it short
});

test('bumping font size from the toolbar re-fits the note height', async ({ page }) => {
  const card = await placeNoteWithText(page);
  const before = await card.boundingBox();

  // Re-enter edit mode and select all text.
  await card.locator('.note-body').dblclick();
  await expect(card.locator('.note-body[contenteditable="true"]')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');

  // Commit a larger size via the toolbar combo (mutates the DOM without
  // firing `input` — the MutationObserver path). 18px keeps the content
  // inside the 480px auto-size cap; past the cap notes scroll by design.
  const combo = page.locator('input.tob-size-combo');
  await combo.click();
  await combo.fill('18');
  await page.keyboard.press('Enter');

  await expect.poll(async () => (await card.boundingBox()).height).toBeGreaterThan(before.height + 20);
  const { scrollHeight, clientHeight } = await overflowState(card);
  expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 2);
});

test('clipped note shows the overflow cue; "Show all" fits it back', async ({ page }) => {
  const card = await placeNoteWithText(page);
  const before = await card.boundingBox();
  await dragHandle(page, card, -Math.round(before.width * 0.35), -Math.round(before.height * 0.45));

  // Clipped → fade class + hover-revealed chip.
  await expect(card.locator('.note')).toHaveClass(/is-overflowing/);
  await card.hover();
  const chip = card.locator('.note-more-chip');
  await expect(chip).toBeVisible();

  await chip.click();
  await expect(card.locator('.note')).not.toHaveClass(/is-overflowing/);
  const { scrollHeight, clientHeight } = await overflowState(card);
  expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 2);
});
