// Files beside the board — one view, two sizes (src/lib/filesDock.js,
// src/components/FilesDock.jsx), driven through the ?local=1 harness.
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
  // Keyboard focus on the board, not in any field.
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: 300 } });
}

const panel = (page) => page.locator('.list-wrap.is-panel');
const fullFiles = (page) => page.locator('.list-wrap:not(.is-panel)');
const filesSeg = (page) => page.getByRole('button', { name: 'Files', exact: true });
const boardSeg = (page) => page.getByRole('button', { name: 'Board', exact: true });

test('F opens Files beside the board, and the board stays live', async ({ page }) => {
  await go(page);
  await page.keyboard.press('f');
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(filesSeg(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(boardSeg(page)).toHaveAttribute('aria-pressed', 'false');
  // The board still takes clicks: selecting a card works with the panel open.
  await page.locator('.card.card-kind-image').first().click();
  await expect(page.locator('.card.card-kind-image.selected, .card.card-kind-image.is-selected').first()).toBeVisible();
  // F again puts Files away.
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: 300 } });
  await page.keyboard.press('f');
  await expect(panel(page)).toHaveCount(0);
  await expect(boardSeg(page)).toHaveAttribute('aria-pressed', 'true');
});

test('the topbar opens the panel, Board closes it, and the panel has its own close', async ({ page }) => {
  await go(page);
  await filesSeg(page).click();
  await expect(panel(page)).toBeVisible();
  await boardSeg(page).click();
  await expect(panel(page)).toHaveCount(0);
  await filesSeg(page).click();
  await page.getByRole('button', { name: 'Close Files' }).click();
  await expect(panel(page)).toHaveCount(0);
});

test('expand fills the pane with Files; Beside board docks it again; F from full goes to the board', async ({ page }) => {
  await go(page);
  await page.keyboard.press('f');
  await page.getByRole('button', { name: 'Expand Files to full screen' }).click();
  await expect(fullFiles(page)).toBeVisible();
  await expect(page.locator('.canvas-wrap')).toHaveCount(0);
  await page.getByRole('button', { name: /Beside board/ }).click();
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Expand Files to full screen' }).click();
  await expect(fullFiles(page)).toBeVisible();
  await page.locator('.list-wrap').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('f');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('.list-wrap')).toHaveCount(0);
});

test('dragging the divider resizes the panel, and far enough expands it', async ({ page }) => {
  await go(page);
  await page.keyboard.press('f');
  const divider = page.getByRole('separator', { name: 'Resize Files' });
  await expect(divider).toBeVisible();
  const box = await divider.boundingBox();
  const before = (await page.locator('.fdl-files').boundingBox()).width;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const after = (await page.locator('.fdl-files').boundingBox()).width;
  expect(after).toBeGreaterThan(before + 80);
  // Most of the way across → full Files.
  const box2 = await divider.boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(300, box2.y + box2.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(fullFiles(page)).toBeVisible();
  await expect(page.locator('.canvas-wrap')).toHaveCount(0);
});

test('with no room for a panel, F opens full-screen Files', async ({ page }) => {
  await go(page, { width: 800, height: 900 });
  await page.keyboard.press('f');
  await expect(fullFiles(page)).toBeVisible();
  await expect(page.locator('.canvas-wrap')).toHaveCount(0);
});

test('double-clicking a file in the panel keeps the board and the panel open', async ({ page }) => {
  await go(page);
  await page.keyboard.press('f');
  await expect(panel(page)).toBeVisible();
  const tile = panel(page).locator('.ct-tile').filter({ hasText: 'KEY ART' }).first();
  await tile.dblclick();
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('.canvas-wrap')).toBeVisible();
});

test('the panel browses into a folder and back without moving the board', async ({ page }) => {
  await go(page);
  const crumb = await page.locator('.crumb.here').innerText();
  await page.keyboard.press('f');
  const p = panel(page);
  await p.locator('.ft', { hasText: 'Features' }).dblclick();
  await expect(p.locator('.pb .pb-step.is-here')).toContainText('Features');
  await expect(p.locator('.cbt-note')).toBeVisible();
  // The board hasn't gone anywhere.
  await expect(page.locator('.crumb.here')).toHaveText(crumb);
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await p.getByRole('button', { name: 'Back' }).click();
  await expect(p.locator('.pb .pb-step.is-here')).toHaveText(crumb);
  await expect(p.locator('.cbt-note')).toHaveCount(0);
  // Expanding while browsing takes the app there, in Files.
  await p.locator('.ft', { hasText: 'Features' }).dblclick();
  await page.getByRole('button', { name: 'Expand Files to full screen' }).click();
  await expect(fullFiles(page)).toBeVisible();
  await expect(page.locator('.crumb.here')).toContainText('Features');
});

test('dragging this cluster\'s file from the panel moves its card to the drop point', async ({ page }) => {
  await go(page);
  await page.keyboard.press('f');
  const tile = panel(page).locator('[data-item-id="home-note"]');
  await expect(tile).toHaveAttribute('draggable', 'true');
  // An untouched board re-fits itself when its content changes, so check the
  // card's board position against the camera as it was at the drop.
  const cam = await page.locator('.cards-layer').evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el.parentElement).transform);
    return { z: m.a, x: m.e, y: m.f };
  });
  await tile.dragTo(page.locator('.canvas-wrap'), { targetPosition: { x: 260, y: 520 } });
  const at = { x: (260 - cam.x) / cam.z, y: (520 - cam.y) / cam.z };
  const card = page.locator('[data-card-id="home-note"]');
  await expect.poll(async () => {
    const st = await card.evaluate((el) => ({ l: parseFloat(el.style.left), t: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) }));
    return Math.round(Math.hypot(st.l + st.w / 2 - at.x, st.t + st.h / 2 - at.y));
  }).toBeLessThan(3);
});

test('another cluster\'s file drags in as a linked copy; a doc is offered as a move', async ({ page }) => {
  await go(page);
  await page.keyboard.press('f');
  const p = panel(page);
  await p.locator('.ft', { hasText: 'Sundown Highway' }).dblclick();
  await expect(p.locator('[data-item-id="s-img1"]')).toBeVisible();
  const cards = page.locator('[data-card-id]');
  const n0 = await cards.count();
  await p.locator('[data-item-id="s-img1"]').dragTo(page.locator('.canvas-wrap'), { targetPosition: { x: 320, y: 300 } });
  await expect(cards).toHaveCount(n0 + 1);
  await expect(page.getByText('Linked 1 file from “Sundown Highway”')).toBeVisible();
  // The original stays where it was.
  await expect(p.locator('[data-item-id="s-img1"]')).toBeVisible();

  await p.locator('[data-item-id="s-doc"]').dragTo(page.locator('.canvas-wrap'), { targetPosition: { x: 420, y: 560 } });
  await expect(cards).toHaveCount(n0 + 1);
  await page.getByRole('button', { name: 'Move here' }).click();
  await expect(page.locator('[data-card-id="s-doc"]')).toHaveCount(1);
  await expect(p.locator('[data-item-id="s-doc"]')).toHaveCount(0);
});

test('a plain click on a file in the panel selects it on the board', async ({ page }) => {
  await go(page);
  await page.keyboard.press('f');
  const tile = panel(page).locator('.ct-tile, .ct-row').nth(1);
  const id = await tile.getAttribute('data-item-id');
  await tile.click();
  await expect(page.locator(`[data-card-id="${id}"].selected, [data-card-id="${id}"].is-selected`)).toHaveCount(1);
});

test('a click on the divider of a panel at its widest leaves it beside the board', async ({ page }) => {
  await go(page);
  await page.keyboard.press('f');
  const divider = page.getByRole('separator', { name: 'Resize Files' });
  await divider.focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowLeft');
  const box = await divider.boundingBox();
  // Left half of the 7px divider — reads as at or past the panel's edge.
  await page.mouse.click(box.x + 1, box.y + box.height / 2);
  await expect(panel(page)).toBeVisible();
  await expect(fullFiles(page)).toHaveCount(0);
});

test('the View menu closes when its button is pressed again', async ({ page }) => {
  await go(page);
  await page.keyboard.press('f');
  const view = panel(page).getByRole('button', { name: /^View/ });
  await view.click();
  await expect(panel(page).getByRole('menu')).toBeVisible();
  await view.click();
  await expect(panel(page).getByRole('menu')).toHaveCount(0);
});
