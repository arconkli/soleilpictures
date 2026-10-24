// The canvas is a window onto the board: the board pans and zooms by its
// transform, and the canvas clips whatever lies past its edges (overflow
// hidden). A focus can still scroll a box that clips, to bring what it focused
// into view: writing in a grid's box past the canvas's right edge did, by
// hundreds of pixels, and the tool rail, the zoom and the bars that sit on the
// canvas slid out of place, the rail half off the screen, until a reload.
//
// On the real canvas, through ?local=1.
import { expect, test } from '@playwright/test';

const scrolled = (page) => page.locator('.canvas-wrap').evaluate((w) => [w.scrollLeft, w.scrollTop]);

test('writing in a box past the canvas\'s edge doesn\'t scroll the canvas, or move the rail and the zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?local=1&reset=1&blank=1');
  const wrap = page.locator('.canvas-wrap');
  await wrap.waitFor();
  await page.waitForTimeout(500);
  const [rail, zoom] = await Promise.all([page.locator('.cnv-tools').boundingBox(), page.locator('.cnv-zoom').boundingBox()]);

  // A grid, and one stamped to its right, past the canvas's edge.
  await wrap.evaluate((node) => {
    const r = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 520, clientY: r.top + 150 }));
  });
  await page.locator('.ctx-menu').first().locator('.ctx-submenu-wrap', { hasText: 'Add' }).hover();
  await page.locator('.ctx-submenu').getByRole('menuitem', { name: 'Grid', exact: true }).click();
  const first = page.locator('.card-kind-grid').first();
  await first.click({ position: { x: 180, y: 8 } });
  await page.getByRole('button', { name: 'Stamp a Grid right' }).click();
  await expect(page.locator('.card-kind-grid')).toHaveCount(2);
  const grids = page.locator('.card-kind-grid');
  const xs = await grids.evaluateAll((els) => els.map((e, i) => ({ i, x: e.getBoundingClientRect().x })));
  xs.sort((a, b) => a.x - b.x);
  const right = grids.nth(xs[1].i);

  // Text in its first box, written in.
  const cell = right.locator('.gridc-cell.is-empty').first();
  await cell.hover();
  await cell.getByRole('button', { name: 'Text', exact: true }).click();
  const editor = right.locator('[contenteditable="true"]').first();
  await editor.waitFor({ state: 'visible' });
  await editor.click();
  await page.keyboard.type('Night exteriors');
  await page.waitForTimeout(300);

  expect(await scrolled(page)).toEqual([0, 0]);
  const [railNow, zoomNow] = await Promise.all([page.locator('.cnv-tools').boundingBox(), page.locator('.cnv-zoom').boundingBox()]);
  expect(railNow.x).toBeCloseTo(rail.x, 0);
  expect(railNow.y).toBeCloseTo(rail.y, 0);
  expect(zoomNow.x).toBeCloseTo(zoom.x, 0);
  expect(zoomNow.y).toBeCloseTo(zoom.y, 0);
});

test('a script scrolling the canvas is put straight back', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  const wrap = page.locator('.canvas-wrap');
  await wrap.waitFor();
  // Something past its edges to scroll to, and a script that goes there.
  await wrap.evaluate((w) => {
    const far = document.createElement('div');
    far.style.cssText = 'position:absolute;left:0;top:0;width:4000px;height:3000px;pointer-events:none';
    w.appendChild(far);
    w.scrollLeft = 300;
    w.scrollTop = 80;
  });
  await expect.poll(() => scrolled(page)).toEqual([0, 0]);
});
