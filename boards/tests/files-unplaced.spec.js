// Files that are in a cluster but not on its board (src/lib/placement.js),
// driven through the ?local=1 harness.
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
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: 300 } });
}

const panel = (page) => page.locator('.list-wrap.is-panel');
const onCanvas = (page, id) => page.locator(`.canvas-wrap [data-card-id="${id}"]`);

async function removeFromBoard(page, id) {
  await onCanvas(page, id).click({ button: 'right' });
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Remove from board' }).click();
  await expect(onCanvas(page, id)).toHaveCount(0);
}

test('Remove from board takes a card off the canvas and keeps it in Files, marked; undo puts it back', async ({ page }) => {
  await go(page);
  await removeFromBoard(page, 'home-image');
  await expect(page.getByText('Removed from board — it’s still in Files')).toBeVisible();
  await page.keyboard.press('f');
  const tile = panel(page).locator('[data-item-id="home-image"]');
  await expect(tile).toBeVisible();
  await expect(tile.locator('.ct-onboard.is-off')).toHaveText('Not on board');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(onCanvas(page, 'home-image')).toHaveCount(1);
  await expect(tile.locator('.ct-onboard.is-off')).toHaveCount(0);
});

test('Put on board from Files places it again; ⌫ on the board still deletes', async ({ page }) => {
  await go(page);
  await removeFromBoard(page, 'home-image');
  await page.keyboard.press('f');
  await panel(page).locator('[data-item-id="home-image"]').click({ button: 'right' });
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Put on board' }).click();
  await expect(onCanvas(page, 'home-image')).toHaveCount(1);
  await expect(page.getByText('Put on the board')).toBeVisible();
  // Delete is unchanged: it deletes.
  await onCanvas(page, 'home-image').click();
  await page.keyboard.press('Backspace');
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Delete' });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(onCanvas(page, 'home-image')).toHaveCount(0);
  await expect(panel(page).locator('[data-item-id="home-image"]')).toHaveCount(0);
});

test('dragging a file that is not on the board onto it puts it where it was dropped', async ({ page }) => {
  await go(page);
  await removeFromBoard(page, 'home-link');
  await page.keyboard.press('f');
  const cam = await page.locator('.cards-layer').evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el.parentElement).transform);
    return { z: m.a, x: m.e, y: m.f };
  });
  await panel(page).locator('[data-item-id="home-link"]').dragTo(page.locator('.canvas-wrap'), { targetPosition: { x: 300, y: 260 } });
  await expect(onCanvas(page, 'home-link')).toHaveCount(1);
  const at = { x: (300 - cam.x) / cam.z, y: (260 - cam.y) / cam.z };
  const st = await onCanvas(page, 'home-link').evaluate((el) => ({ l: parseFloat(el.style.left), t: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) }));
  expect(Math.hypot(st.l + st.w / 2 - at.x, st.t + st.h / 2 - at.y)).toBeLessThan(3);
});

test('the Not on board filter shows only files that are off the board, and clicking one does not move the board', async ({ page }) => {
  await go(page);
  await removeFromBoard(page, 'home-image');
  await page.keyboard.press('f');
  await panel(page).getByRole('button', { name: /^View/ }).click();
  await page.locator('.cbt-menu .ctx-item', { hasText: 'Not on board' }).click();
  await page.keyboard.press('Escape');
  await expect(panel(page).locator('.ct-tile, .ct-row')).toHaveCount(1);
  const cam0 = await page.locator('.cards-layer').evaluate((el) => getComputedStyle(el.parentElement).transform);
  await panel(page).locator('[data-item-id="home-image"]').click();
  await page.waitForTimeout(400);
  expect(await page.locator('.cards-layer').evaluate((el) => getComputedStyle(el.parentElement).transform)).toBe(cam0);
});
