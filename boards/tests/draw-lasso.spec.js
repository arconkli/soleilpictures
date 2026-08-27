import { expect, test } from '@playwright/test';

// Lasso select.
//
// Why this exists at all: one-finger touch on the select tool is routed to
// PANNING (onBackgroundPointerDown's touch branch), so the marquee has always
// been mouse- and stylus-only. A finger had no way to select a stroke — not to
// move one, not to recolour one, not to delete one. The lasso is that way in,
// and it works the same with a mouse.
//
// The invariant worth pinning is the majority rule: a stroke is taken when MOST
// of it is inside the loop, matching pickStrokeTarget's rule for deciding
// whether a stroke belongs to an art card. Anything else and "mostly inside"
// would mean two different things in the same app.

const RAIL_RIGHT = 300; // .cnv-tools sits around x 255-292; stay clear of it.

async function drawStroke(page, x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function lasso(page, poly) {
  await page.mouse.move(poly[0][0], poly[0][1]);
  await page.mouse.down();
  for (const [x, y] of poly.slice(1)) await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.waitForTimeout(1000);
  await page.keyboard.press('d');
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-draw/);
});

test('circling strokes selects them and hands over to the select tool', async ({ page }) => {
  // Two strokes close together, one far away.
  await drawStroke(page, 340, 300, 400, 340);
  await drawStroke(page, 340, 380, 400, 420);
  await drawStroke(page, 800, 300, 880, 340);
  // Two <path> per committed stroke: the hit halo and the visible line.
  expect(await page.locator('.strokes-layer path').count()).toBe(6);

  await page.getByRole('button', { name: 'Lasso' }).click();
  await page.waitForTimeout(150);
  await lasso(page, [[430, 260], [430, 460], [RAIL_RIGHT + 5, 460], [RAIL_RIGHT + 5, 265], [430, 262]]);

  // A selected stroke gains a third path — its selection ring — so the two
  // inside the loop are selected and the far one is not.
  expect(await page.locator('.strokes-layer path').count()).toBe(8);
  // The handover matters: strokes are only interactive under the select tool,
  // so a lasso that left you in draw mode would select things you can't touch.
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-select/);
  await expect(page.getByText('2 selected')).toBeVisible();
});

test('a lasso that encloses nothing clears the selection and stays put', async ({ page }) => {
  await drawStroke(page, 340, 300, 400, 340);
  await page.getByRole('button', { name: 'Lasso' }).click();
  await page.waitForTimeout(150);
  await lasso(page, [[700, 600], [860, 600], [860, 700], [700, 700], [700, 605]]);

  expect(await page.locator('.strokes-layer path').count()).toBe(2); // no ring
  // Nothing was selected, so there is nothing to hand over to — staying in
  // lasso mode lets the user simply try again.
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-draw/);
});

test('lasso selection feeds the existing delete + undo path', async ({ page }) => {
  await drawStroke(page, 340, 300, 400, 340);
  await drawStroke(page, 800, 300, 880, 340);
  expect(await page.locator('.strokes-layer path').count()).toBe(4);

  await page.getByRole('button', { name: 'Lasso' }).click();
  await page.waitForTimeout(150);
  await lasso(page, [[430, 260], [430, 400], [RAIL_RIGHT + 5, 400], [RAIL_RIGHT + 5, 265], [430, 262]]);
  // 2 paths for the untouched stroke + 3 for the selected one (hit, ring, line).
  expect(await page.locator('.strokes-layer path').count()).toBe(5);

  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  expect(await page.locator('.strokes-layer path').count()).toBe(2);

  // Deleting shows an undo toast — the house convention — and ⌘Z brings it back.
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(300);
  expect(await page.locator('.strokes-layer path').count()).toBe(4);
});

test('the lasso is not ink — it leaves no stroke behind', async ({ page }) => {
  await page.getByRole('button', { name: 'Lasso' }).click();
  await page.waitForTimeout(150);
  await lasso(page, [[430, 260], [430, 460], [RAIL_RIGHT + 5, 460], [RAIL_RIGHT + 5, 265], [430, 262]]);
  expect(await page.locator('.strokes-layer path').count()).toBe(0);
});

test('lasso mode hides the ink controls that mean nothing for a selection', async ({ page }) => {
  await page.getByRole('button', { name: 'Lasso' }).click();
  await expect(page.getByText('Circle strokes to select')).toBeVisible();
  await expect(page.locator('.tob-swatches')).toHaveCount(0);
  await expect(page.locator('.tob-thickness')).toHaveCount(0);
  // Pen must not read as active while the lasso is the live mode.
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  await expect(pen).not.toHaveClass(/is-active/);
});
