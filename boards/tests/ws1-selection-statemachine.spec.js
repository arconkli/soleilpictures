import { expect, test } from '@playwright/test';

// WS-1 — canvas selection/drag state machine. Verifies the Escape-abort
// mechanism and the deferred-clear marquee behavior against the no-auth
// ?local=1 Studio canvas.

const go = async (page) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select tool', exact: true })).toBeVisible();
};

test('Escape aborts an in-progress card drag (card stays put)', async ({ page }) => {
  await go(page);
  // Drag an existing seed card; Escape mid-drag must NOT commit the move.
  const card = page.locator('.card').first();
  await expect(card).toBeVisible();
  const before = await card.boundingBox();
  const startX = before.x + before.width / 2;
  const startY = before.y + before.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: 'left' });
  for (let i = 1; i <= 10; i++) await page.mouse.move(startX + i * 9, startY + i * 6);
  // Abort mid-drag. The window pointerup listener must be torn down so the
  // release below does NOT commit the move.
  await page.keyboard.press('Escape');
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(80);

  const after = await card.boundingBox();
  expect(Math.abs(after.x - before.x)).toBeLessThan(6);
  expect(Math.abs(after.y - before.y)).toBeLessThan(6);
});

test('Escape during a fresh marquee restores the prior selection', async ({ page }) => {
  await go(page);
  const cb = await page.locator('.canvas-wrap').boundingBox();

  // Select everything currently on the board via a full-canvas marquee.
  const sx = cb.x + 40, sy = cb.y + 60;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(sx + i * ((cb.width - 100) / 8), sy + i * ((cb.height - 160) / 8), { steps: 1 });
  }
  await page.mouse.up();
  const selectedCount = await page.locator('.card.is-selected').count();
  expect(selectedCount).toBeGreaterThan(0);

  // Start a NEW non-shift marquee in an empty corner, drag, then Escape.
  const ex = cb.x + cb.width - 90, ey = cb.y + 70;
  await page.mouse.move(ex, ey);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(ex - i * 8, ey + i * 8, { steps: 1 });
  await expect(page.locator('.marquee')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(60);

  // Marquee gone, prior selection restored (not wiped).
  await expect(page.locator('.marquee')).toHaveCount(0);
  expect(await page.locator('.card.is-selected').count()).toBe(selectedCount);
});

test('Plain click on empty canvas still deselects (deferred-clear path)', async ({ page }) => {
  await go(page);
  const cb = await page.locator('.canvas-wrap').boundingBox();

  // Select all, then a clean click on empty canvas should clear selection.
  const sx = cb.x + 40, sy = cb.y + 60;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(sx + i * ((cb.width - 100) / 8), sy + i * ((cb.height - 160) / 8), { steps: 1 });
  }
  await page.mouse.up();
  expect(await page.locator('.card.is-selected').count()).toBeGreaterThan(0);

  await page.mouse.click(cb.x + cb.width - 70, cb.y + 70);
  await page.waitForTimeout(60);
  expect(await page.locator('.card.is-selected').count()).toBe(0);
});
