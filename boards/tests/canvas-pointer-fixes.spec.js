import { expect, test } from '@playwright/test';
import { TOKEN, routeShareBundle, routeAnalytics } from './helpers/share-fixture.js';

// Canvas pointer gestures and menus: small regressions, one test each.
// Harness: ?local=1&reset=1&blank=1.

async function blank(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.waitForTimeout(800);
}

test('reordering a palette swatch and missing never drops a stray note', async ({ page }) => {
  await blank(page);
  await page.getByRole('button', { name: 'Add menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Palette', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: { x: 460, y: 360 } });
  await expect(page.locator('.pc').last()).toBeVisible();
  const cards = await page.locator('.card').count();

  // Release the swatch on bare canvas, well away from the palette. Dispatched
  // by hand with one shared DataTransfer, which is what a real drag carries
  // from dragstart through to drop.
  const accepted = await page.evaluate(() => {
    const dt = new DataTransfer();
    const cell = document.querySelector('.pc-cell');
    cell.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const wrap = document.querySelector('.canvas-wrap');
    const r = wrap.getBoundingClientRect();
    const at = { clientX: r.left + 700, clientY: r.top + 600 };
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at });
    wrap.dispatchEvent(over);
    wrap.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
    cell.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return over.defaultPrevented;
  });
  await page.waitForTimeout(400);
  // The canvas doesn't even offer itself as a drop target for a swatch.
  expect(accepted).toBe(false);
  await expect(page.locator('.card')).toHaveCount(cards);
});

async function drag(page, x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

test('deleting an arrow from its menu does not select the next one', async ({ page }) => {
  await blank(page);
  await page.keyboard.press('a');
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-arrow/);
  await drag(page, 380, 200, 600, 200);
  await page.keyboard.press('a');
  await drag(page, 380, 300, 600, 300);
  await page.keyboard.press('a');
  await drag(page, 380, 400, 600, 400);
  await page.keyboard.press('Escape');
  await expect(page.locator('.arrow-g')).toHaveCount(3);

  // Right-click the middle arrow's hit path (arrows arc, so its bbox centre
  // isn't on the line — dispatch straight to the element).
  await page.locator('.arrow-g[data-arrow-idx="1"] > path').first()
    .dispatchEvent('contextmenu', { button: 2, clientX: 490, clientY: 300 });
  await page.locator('.ctx-menu').getByText('Delete arrow', { exact: true }).click();
  await expect(page.locator('.arrow-g')).toHaveCount(2);
  await expect(page.locator('.arrow-g.is-selected')).toHaveCount(0);
});

test('Clear all drawings shows Undo, and the old selection does not grab the next stroke', async ({ page }) => {
  await blank(page);
  await page.keyboard.press('d');
  await drag(page, 380, 300, 480, 340);
  await drag(page, 380, 420, 480, 460);
  const strokes = page.locator('.strokes-layer path[data-stroke-line]');
  await expect(strokes).toHaveCount(2);
  // Select the first stroke with the select tool.
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.mouse.click(430, 320);
  await expect(page.locator('.strokes-layer rect')).toHaveCount(1);

  await page.mouse.click(800, 600, { button: 'right' });
  await page.locator('.ctx-menu').getByText('Clear all drawings', { exact: true }).click();
  await expect(strokes).toHaveCount(0);
  const toast = page.locator('.toast', { hasText: 'Drawings cleared' });
  await expect(toast).toBeVisible();

  // A fresh stroke is not born selected.
  await page.keyboard.press('d');
  await drag(page, 380, 300, 480, 340);
  await expect(strokes).toHaveCount(1);
  await page.keyboard.press('v');
  await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-select/);
  await expect(page.locator('.strokes-layer rect')).toHaveCount(0);
});

test('the Clear all drawings toast puts every stroke back', async ({ page }) => {
  await blank(page);
  await page.keyboard.press('d');
  await drag(page, 380, 300, 480, 340);
  await drag(page, 380, 420, 480, 460);
  const strokes = page.locator('.strokes-layer path[data-stroke-line]');
  await expect(strokes).toHaveCount(2);
  await page.mouse.click(800, 600, { button: 'right' });
  await page.locator('.ctx-menu').getByText('Clear all drawings', { exact: true }).click();
  await expect(strokes).toHaveCount(0);
  await page.locator('.toast', { hasText: 'Drawings cleared' }).getByRole('button', { name: 'Undo' }).click();
  await expect(strokes).toHaveCount(2);
});

async function zoomIntoCentre(page, notches = 12) {
  await page.evaluate((n) => {
    const wrap = document.querySelector('.canvas-wrap');
    const r = wrap.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      wrap.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -240, ctrlKey: true, bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      }));
    }
  }, notches);
}

test('a card whose media is playing stays mounted when you zoom away from it', async ({ page }) => {
  // The dense 60-note share fixture: fit-all mounts everything, a deep zoom
  // into the centre culls the corners.
  await routeAnalytics(page, []);
  await routeShareBundle(page, { dense: true });
  await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);
  await expect(page.getByText('Note 0', { exact: true })).toBeVisible();

  // Stand-in for an audio card mid-playback: a media element inside the card
  // that has fired `play` (which doesn't bubble).
  await page.evaluate(() => {
    const card = document.querySelector('[data-card-id="card-grid-0"]');
    const a = document.createElement('audio');
    card.appendChild(a);
    a.dispatchEvent(new Event('play'));
  });
  await zoomIntoCentre(page);
  // The opposite corner, not playing, is culled once the zoom settles…
  await expect(page.locator('[data-card-id="card-grid-9"]')).toHaveCount(0, { timeout: 4000 });
  // …while the playing one is still there, its media element with it.
  await expect(page.locator('[data-card-id="card-grid-0"] audio')).toHaveCount(1);
});
