import { expect, test } from '@playwright/test';

// Strokes vs. selections. Three ways a selection used to hijack the drawing
// tools or damage what it held:
//   - a freshly committed SketchPad drawing is left SELECTED, and the draw tool
//     then routed every line drawn anywhere on the board into it, where the
//     card clipped it to nothing;
//   - a stroke selection's transform box stayed hit-testable under Draw, so a
//     line started inside it moved the old strokes instead of drawing;
//   - moving a stroke rebuilt every point as [x, y], flattening pen pressure.
// Harness: ?local=1&reset=1&blank=1 (blank board, free-draw on `d`).

const RAIL_RIGHT = 300;
const boardStrokes = (page) => page.locator('.strokes-layer path[data-stroke-line]');
const cardPaths = (page) => page.locator('.card .card-strokes-overlay path').count();

async function board(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  // Generous, as in canvas-pointer-fixes: under parallel load the first boot
  // can outlast the default 5s.
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.keyboard.press('d');
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-draw/);
}

// Picks a draw mode (Pen / Lasso) on the tool bar. Not a Playwright click: when
// its hit check misses a tool-bar button under load, the retry force-scrolls
// the overflow-hidden .canvas-wrap to "reveal" it, which slides the bar into
// mid-canvas and moves every page coordinate the test draws at afterwards.
async function pickMode(page, name) {
  const btn = page.getByRole('button', { name, exact: true });
  await btn.dispatchEvent('click');
  await expect(btn).toHaveClass(/is-active/);
}

// The canvas maps pointer coordinates assuming the wrap is never scrolled.
const wrapUnscrolled = (page) => expect.poll(() => page.evaluate(() => {
  const w = document.querySelector('.canvas-wrap');
  return w.scrollLeft + w.scrollTop;
})).toBe(0);

async function drawStroke(page, x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function lasso(page, poly) {
  await page.mouse.move(poly[0][0], poly[0][1]);
  await page.mouse.down();
  for (const [x, y] of poly.slice(1)) await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test('with a fresh drawing selected, a line drawn elsewhere stays on the board', async ({ page }) => {
  await board(page);
  await page.locator('.tob-canvas-btn').first().click();
  const pad = page.locator('.sketchpad-surface');
  await expect(pad).toBeVisible();
  await pad.dragTo(pad, { sourcePosition: { x: 100, y: 100 }, targetPosition: { x: 220, y: 160 } });
  await page.getByRole('button', { name: 'Add to canvas' }).click();
  await expect(pad).toBeHidden();
  await expect(page.locator('.card-kind-art')).toHaveCount(1);
  await expect(page.locator('.card-kind-art.is-selected')).toHaveCount(1);
  const inCard = await cardPaths(page);

  await page.keyboard.press('d');
  await page.waitForTimeout(200);
  // Somewhere clearly off the art card.
  const box = await page.locator('.card-kind-art').boundingBox();
  const vp = page.viewportSize();
  const y = box.y + box.height + 60 < vp.height - 40 ? box.y + box.height + 60 : Math.max(80, box.y - 60);
  await drawStroke(page, RAIL_RIGHT + 40, y, RAIL_RIGHT + 200, y + 10);

  await expect(boardStrokes(page)).toHaveCount(1);
  expect(await cardPaths(page)).toBe(inCard);
  // Board drawing is iterative — no flip back to Select.
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-draw/);
});

test('a stroke selection does not swallow the next line drawn inside its box', async ({ page }) => {
  // Waits on state, not time: under load a fixed pause let the second line
  // start before the selection box had gone.
  const selBox = page.locator('.strokes-layer rect');
  await board(page);
  await drawStroke(page, 360, 300, 480, 380);
  await expect(boardStrokes(page)).toHaveCount(1);
  await pickMode(page, 'Lasso');
  await wrapUnscrolled(page);
  await lasso(page, [[520, 260], [520, 420], [RAIL_RIGHT + 20, 420], [RAIL_RIGHT + 20, 262], [518, 262]]);
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-select/);
  // The lasso picked the stroke: its transform box is up under Select.
  await expect.poll(() => selBox.count()).toBeGreaterThan(0);
  const before = await boardStrokes(page).first().getAttribute('d');

  await page.keyboard.press('d');
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-draw/);
  await pickMode(page, 'Pen');
  await wrapUnscrolled(page);
  // Under Draw the box is gone, so nothing in it can take the pointerdown.
  await expect(selBox).toHaveCount(0);
  // Start INSIDE the old selection box.
  await drawStroke(page, 420, 330, 470, 300);

  await expect(boardStrokes(page)).toHaveCount(2);
  expect(await boardStrokes(page).first().getAttribute('d')).toBe(before);
});

test('moving a pen-pressure stroke keeps its pressure, and one ⌘Z undoes the move', async ({ page }) => {
  await board(page);
  // A pen stroke with real pressure, as untrusted PointerEvents (the
  // coalesced-events fallback handles them — see lib/pointerStroke.js).
  await page.evaluate(async () => {
    const wrap = document.querySelector('.canvas-wrap');
    const ev = (t, x, y, p, extra = {}) => new PointerEvent(t, {
      bubbles: true, cancelable: true, composed: true, pointerId: 7,
      pointerType: 'pen', isPrimary: true, button: 0, buttons: 1, pressure: p,
      clientX: x, clientY: y, ...extra,
    });
    wrap.dispatchEvent(ev('pointerdown', 360, 300, 0.2));
    for (let i = 1; i <= 12; i++) {
      window.dispatchEvent(ev('pointermove', 360 + i * 10, 300 + i * 5, 0.2 + i * 0.06));
      await new Promise(requestAnimationFrame);
    }
    window.dispatchEvent(ev('pointerup', 480, 360, 0, { buttons: 0 }));
    await new Promise(requestAnimationFrame);
  });
  await page.waitForTimeout(200);
  const line = boardStrokes(page).first();
  await expect(line).toHaveCount(1);
  // A pressure stroke paints as a filled outline.
  await expect(line).not.toHaveAttribute('fill', 'none');
  const before = await line.getAttribute('d');

  await pickMode(page, 'Lasso');
  await wrapUnscrolled(page);
  await lasso(page, [[520, 260], [520, 420], [RAIL_RIGHT + 20, 420], [RAIL_RIGHT + 20, 262], [518, 262]]);
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-select/);

  await page.mouse.move(420, 330);
  await page.mouse.down();
  await page.mouse.move(460, 380, { steps: 8 });
  await page.mouse.move(500, 420, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const moved = boardStrokes(page).first();
  expect(await moved.getAttribute('d')).not.toBe(before);
  await expect(moved).not.toHaveAttribute('fill', 'none');

  // Clear the selection so ⌘Z is the board's undo, then undo the move.
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => boardStrokes(page).first().getAttribute('d')).toBe(before);
});
