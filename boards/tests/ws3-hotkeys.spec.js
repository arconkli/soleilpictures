import { expect, test } from '@playwright/test';

const go = async (page, { blank = true } = {}) => {
  // Default blank (empty cluster) so the placement/keyboard tests get a clear
  // canvas; the marquee test opts back to the seeded board (it needs cards).
  await page.goto(blank ? '/?local=1&reset=1&blank=1' : '/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select tool', exact: true })).toBeVisible();
};

test('v / h bare-key shortcuts switch the canvas tool', async ({ page }) => {
  await go(page);
  // Click empty canvas to ensure no editor focus, then use the keyboard.
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.mouse.click(cb.x + cb.width - 60, cb.y + 60);
  await page.keyboard.press('h');
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-pan/);
  await page.keyboard.press('v');
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-select/);
});

test('Escape stacks: tool reset first, then selection clear', async ({ page }) => {
  await go(page, { blank: false });
  const cb = await page.locator('.canvas-wrap').boundingBox();
  // Select everything via a full-canvas marquee.
  const sx = cb.x + 40, sy = cb.y + 60;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(sx + i * ((cb.width - 100) / 8), sy + i * ((cb.height - 160) / 8), { steps: 1 });
  }
  await page.mouse.up();
  const selCount = await page.locator('.card.is-selected').count();
  expect(selCount).toBeGreaterThan(0);

  // Switch to a non-select tool, then Escape should reset the tool but KEEP
  // the selection (first layer of the stack).
  await page.keyboard.press('h');
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-pan/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-select/);
  expect(await page.locator('.card.is-selected').count()).toBe(selCount);

  // Next Escape clears the selection.
  await page.keyboard.press('Escape');
  expect(await page.locator('.card.is-selected').count()).toBe(0);
});

test('Cmd/Ctrl+B bolds a note and does NOT toggle the sidebar', async ({ page }) => {
  await go(page);
  const appClassBefore = await page.locator('.app').getAttribute('class');

  // Place a note (auto-focuses its editable) and type into it.
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });
  // Focus the fresh note body before typing (placing enters edit mode, but typing
  // immediately races the caret landing).
  await page.locator('.note-body[contenteditable="true"]').last().click();
  await page.keyboard.type('hello world');
  const body = page.locator('.card .note-body').last();
  await expect(body).toContainText('hello world');

  // Select all within the note, then bold.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+b');

  // Bold mark applied to the note content...
  const html = await body.innerHTML();
  expect(html).toMatch(/font-weight:\s*bold|<b>|<strong>/i);
  // ...and the sidebar state is unchanged (Cmd+B was "bold", not "toggle sidebar").
  expect(await page.locator('.app').getAttribute('class')).toBe(appClassBefore);
});
