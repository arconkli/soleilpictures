import { expect, test } from '@playwright/test';

// Grids — live interaction in the local (?local=1) harness. Verifies the P2
// wiring end to end with REAL input: add a Grid via the canvas right-click menu,
// select it, drag a divider (the shared-edge resize), and fill an empty cell
// with text via the chooser. The pure layout/sequence math is covered separately
// by grids.spec.js (?gridqa=1).

async function addGrid(page) {
  const canvas = page.locator('.canvas-wrap');
  await canvas.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: rect.left + 520, clientY: rect.top + 150,
    }));
  });
  const menu = page.locator('.ctx-menu').first();
  await expect(menu).toBeVisible();
  await menu.locator('.ctx-submenu-wrap', { hasText: 'Add' }).hover();
  await page.locator('.ctx-submenu').getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.locator('.gridc-cell')).toHaveCount(3);
}

test.describe('grids — local interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?local=1&reset=1&blank=1');
    await page.waitForSelector('.canvas-wrap');
  });

  test('add a Grid, select it, and drag a divider to resize adjacent cells', async ({ page }) => {
    await addGrid(page);
    const grid = page.locator('.card-kind-grid').first();
    // Select by clicking the (empty) top cell near its top edge, away from the
    // centered chooser buttons.
    await grid.click({ position: { x: 180, y: 8 } });
    await expect(grid).toHaveClass(/is-selected/);

    // The bottom row's vertical divider becomes grabbable once selected.
    const divider = page.locator('.gridc-divider-x.is-grabbable').first();
    await expect(divider).toBeVisible();

    const bottomLeft = page.locator('.gridc-cell').nth(1);
    const beforeBox = await bottomLeft.boundingBox();
    const db = await divider.boundingBox();
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
    await page.mouse.down();
    await page.mouse.move(db.x - 70, db.y + db.height / 2, { steps: 6 });
    await page.mouse.up();

    const afterBox = await bottomLeft.boundingBox();
    expect(afterBox.width).toBeLessThan(beforeBox.width - 30);
  });

  test('linked Grids reflow together — global sync + unlink round-trip', async ({ page }) => {
    await addGrid(page);
    const first = page.locator('.card-kind-grid').first();
    await first.click({ position: { x: 180, y: 8 } });
    await expect(first).toHaveClass(/is-selected/);

    // Share layout → this Grid becomes linked to a shared template.
    await first.dispatchEvent('contextmenu');
    await page.locator('.ctx-menu').getByText('Share layout', { exact: true }).click();
    await expect(first.locator('.gridc-linked-badge')).toBeVisible();

    // Duplicate → a second Grid linked to the SAME template.
    await first.dispatchEvent('contextmenu');
    await page.locator('.ctx-menu').getByText('Duplicate', { exact: true }).click();
    await expect(page.locator('.card-kind-grid')).toHaveCount(2);

    const cellOf = (n) => page.locator('.card-kind-grid').nth(n).locator('.gridc-cell').nth(1);
    const before0 = await cellOf(0).boundingBox();
    const before1 = await cellOf(1).boundingBox();

    // Drag the (selected duplicate's) grabbable bottom divider left.
    const divider = page.locator('.gridc-divider-x.is-grabbable').first();
    const db = await divider.boundingBox();
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
    await page.mouse.down();
    await page.mouse.move(db.x - 70, db.y + db.height / 2, { steps: 6 });
    await page.mouse.up();

    // BOTH linked Grids reflow (they read the same shared template layout).
    const after0 = await cellOf(0).boundingBox();
    const after1 = await cellOf(1).boundingBox();
    expect(after0.width).toBeLessThan(before0.width - 30);
    expect(after1.width).toBeLessThan(before1.width - 30);

    // Unlink the duplicate → it keeps the (resized) layout independently.
    const dupe = page.locator('.card-kind-grid').nth(1);
    await dupe.dispatchEvent('contextmenu');
    await page.locator('.ctx-menu').getByText('Unlink layout', { exact: true }).click();
    await expect(dupe.locator('.gridc-linked-badge')).toHaveCount(0);
    const afterUnlink = await cellOf(1).boundingBox();
    expect(Math.abs(afterUnlink.width - after1.width)).toBeLessThan(4);
  });

  test('fill an empty cell with text via the chooser', async ({ page }) => {
    await addGrid(page);
    const grid = page.locator('.card-kind-grid').first();
    await grid.click({ position: { x: 180, y: 8 } });

    const cell = page.locator('.gridc-cell.is-empty').first();
    await cell.hover();
    await cell.getByRole('button', { name: 'Text', exact: true }).click();

    const editor = page.locator('.gridc-cell [contenteditable="true"]').first();
    await editor.click();
    await page.keyboard.type('Shot 1 action');

    // Blur by clicking empty canvas → editor commits, read-only html renders.
    await page.locator('.canvas-wrap').click({ position: { x: 60, y: 60 } });
    await expect(page.locator('.gridc-cell-text .gc-text')).toContainText('Shot 1 action');
  });
});
