import { expect, test } from '@playwright/test';

// NOTES-11: Escape in the size box, the line's width/angle fields and the
// arrow label field was meant to revert the typed value, but blur() ran the
// field's commit-on-blur with the typed value still in its closure, so
// Escape APPLIED it.

test('Escape in the note size box reverts the typed size', async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/?noteqa=1&toolbar=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
  await page.locator('[data-client="A"] .note').dblclick();
  const edit = page.locator('[data-client="A"] .note-body[contenteditable="true"]');
  await edit.waitFor();
  await edit.click();
  await page.keyboard.type('size');
  const size = page.locator('.tob-size-combo');
  await size.click();
  await size.fill('72');
  await page.keyboard.press('Escape');
  await expect(size).toHaveValue('15');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__soleilNoteTest.cardA.get('fontSize'))).toBeUndefined();
});

async function blank(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(800);
}

async function drag(page, x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function selectArrow(page) {
  await page.keyboard.press('v');
  const hit = page.locator('.arrow-g > path').first();
  const box = await hit.boundingBox();
  await hit.dispatchEvent('pointerdown', {
    button: 0, pointerId: 1, isPrimary: true,
    clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,
  });
  await page.mouse.up();
}

test('Escape in the arrow label field leaves the label alone', async ({ page }) => {
  await blank(page);
  await page.keyboard.press('a');
  await drag(page, 380, 300, 640, 300);
  await expect(page.locator('.arrow-g')).toHaveCount(1);
  await selectArrow(page);
  const pop = page.locator('.arrow-popover');
  await expect(pop).toBeVisible();
  const label = pop.locator('.ap-label-input');
  await label.click();
  await label.fill('foo');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await expect(page.locator('.arrow-g', { hasText: 'foo' })).toHaveCount(0);
  if (await label.isVisible()) await expect(label).toHaveValue('');
});

test('Escape in a line\'s angle and width fields reverts them', async ({ page }) => {
  await blank(page);
  await page.keyboard.press('a');
  await drag(page, 380, 300, 640, 300);
  await selectArrow(page);
  await page.locator('.arrow-popover [title="No arrowheads"]').click();
  const angle = page.locator('.tob-angle-input');
  await expect(angle).toBeVisible();
  const before = await angle.inputValue();
  await angle.click();
  await angle.fill('45');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await expect(angle).toHaveValue(before);

  const width = page.locator('.tob-px-input');
  const w0 = await width.inputValue();
  await width.click();
  await width.fill('17');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await expect(width).toHaveValue(w0);
});
