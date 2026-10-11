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
