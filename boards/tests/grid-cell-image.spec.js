import { expect, test } from '@playwright/test';

// Full image controls for a grid IMAGE cell — parity with a standalone image
// (fit/reposition/zoom + the non-destructive photo-adjust stack, a full-screen
// editor, and a full-screen viewer + download). The seeded Studio board carries
// `home-grid`, a storyboard grid whose bottom-left cell (`hg-img`) already holds
// an image, so we can drive the controls without an upload backend.

test.describe('grid cell image controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?local=1&reset=1');
    await page.locator('[data-card-id="home-grid"] .gridc-cell-image .gc-img').first().waitFor({ state: 'visible' });
  });

  const imgCell = (page) => page.locator('[data-card-id="home-grid"] .gridc-cell-image').first();
  const setRange = (loc, v) => loc.evaluate((el, val) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, v);

  async function openEditor(page) {
    const cell = imgCell(page);
    await cell.hover();
    await cell.getByRole('button', { name: 'Edit photo' }).click();
    const pop = page.locator('.gridc-photo-pop');
    await expect(pop).toBeVisible();
    return pop;
  }

  test('Edit photo exposes framing + the essentials adjust panel', async ({ page }) => {
    const pop = await openEditor(page);
    await expect(pop.getByRole('button', { name: 'Fill' })).toBeVisible();
    await expect(pop.getByRole('button', { name: 'Fit', exact: true })).toBeVisible();
    await expect(pop.getByRole('button', { name: 'Reposition' })).toBeVisible();
    await expect(pop.getByRole('button', { name: 'Reset framing' })).toBeVisible();
    await expect(pop.locator('input[aria-label="Zoom"]')).toBeVisible();
    await expect(pop.locator('input[aria-label="Exposure"]')).toBeVisible();
  });

  test('a photo-adjust slider applies a filter that actually resolves', async ({ page }) => {
    const pop = await openEditor(page);
    const img = imgCell(page).locator('.gc-img');
    await setRange(pop.locator('input[aria-label="Exposure"]'), 60);
    await expect(img).toHaveAttribute('style', /soleil-adj-/);
    expect(await page.locator('filter[id^="soleil-adj-"]').count()).toBeGreaterThan(0);
    await pop.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(img).not.toHaveAttribute('style', /soleil-adj-/);
  });

  test('fit + zoom + reset framing drive the cell image', async ({ page }) => {
    const pop = await openEditor(page);
    const img = imgCell(page).locator('.gc-img');
    await pop.getByRole('button', { name: 'Fit', exact: true }).click();
    await expect(img).toHaveAttribute('style', /object-fit:\s*contain/);
    await pop.getByRole('button', { name: 'Fill' }).click();
    await expect(img).toHaveAttribute('style', /object-fit:\s*cover/);
    await setRange(pop.locator('input[aria-label="Zoom"]'), 2);
    await expect(img).toHaveAttribute('style', /scale\(2/);
    await pop.getByRole('button', { name: 'Reset framing' }).click();
    await expect(img).not.toHaveAttribute('style', /scale\(/);
  });

  test('Reposition pans object-position and keeps the editor open', async ({ page }) => {
    const pop = await openEditor(page);
    const img = imgCell(page).locator('.gc-img');
    await pop.getByRole('button', { name: 'Reposition' }).click();
    await expect(page.locator('.gridc-reposition')).toBeVisible();
    // Synthetic pointer drag on the reposition layer (page.mouse doesn't engage
    // the canvas move gesture; window-level pointermove drives onRepositionDown).
    const popMid = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const layer = document.querySelector('.gridc-reposition');
      const lr = layer.getBoundingClientRect();
      const pe = (t, x, y, tg, b) => tg.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: b }));
      const cx = lr.x + lr.width / 2, cy = lr.y + lr.height / 2;
      pe('pointerdown', cx, cy, layer, 1);
      for (let i = 1; i <= 8; i++) { pe('pointermove', cx - i * 7, cy - i * 5, document, 1); await sleep(12); }
      const open = !!document.querySelector('.gridc-photo-pop');
      pe('pointerup', cx - 56, cy - 40, document, 0);
      return open;
    });
    expect(popMid).toBe(true);                                   // popover stayed open THROUGH the drag
    await expect(pop).toBeVisible();                             // and after
    await expect(img).toHaveAttribute('style', /object-position:\s*\d+% \d+%/); // panned off center
  });

  test('Full screen opens the full-screen editor (all sliders + download, live)', async ({ page }) => {
    const pop = await openEditor(page);
    await pop.getByRole('button', { name: 'Full screen' }).click();
    const modal = page.locator('.iem');
    await expect(modal).toBeVisible();
    await expect(page.locator('.gridc-photo-pop')).toHaveCount(0);   // popover closed
    await expect(modal.locator('.iem-img')).toBeVisible();
    await expect(modal.locator('.iem-download')).toBeVisible();
    await expect(modal.locator('input[aria-label="Clarity"]')).toBeVisible();
    await expect(modal.locator('input[aria-label="Sharpness"]')).toBeVisible();
    // Editing in the modal updates the on-canvas cell live (GridCard-owned).
    await setRange(modal.locator('input[aria-label="Exposure"]'), 50);
    await expect(imgCell(page).locator('.gc-img')).toHaveAttribute('style', /soleil-adj-/);
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
  });

  test('Open full screen opens a TRULY full-screen lightbox viewer with download', async ({ page }) => {
    const cell = imgCell(page);
    await cell.hover();
    await cell.getByRole('button', { name: 'Open full screen' }).click();
    const lb = page.locator('.lightbox');
    await expect(lb).toBeVisible();
    await expect(lb.locator('.lightbox-img')).toBeVisible();
    await expect(lb.locator('.lightbox-download')).toBeVisible();
    // Fills the whole viewport (portaled to <body>, not clipped to the grid box).
    const box = await lb.boundingBox();
    const vp = page.viewportSize();
    expect(box.x).toBeLessThanOrEqual(1);
    expect(box.y).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(vp.width - 2);
    expect(box.height).toBeGreaterThanOrEqual(vp.height - 2);
    await page.keyboard.press('Escape');
    await expect(lb).toHaveCount(0);
  });

  test('Fit truly fits after a zoom (zoom-crop is ignored in contain mode)', async ({ page }) => {
    const pop = await openEditor(page);
    const img = imgCell(page).locator('.gc-img');
    // Zoom in while in Fill → the cell image is scaled (cropped in).
    await setRange(pop.locator('input[aria-label="Zoom"]'), 2);
    await expect(img).toHaveAttribute('style', /scale\(2/);
    // Fit → object-fit contain AND no leftover scale, so the whole image fits.
    await pop.getByRole('button', { name: 'Fit', exact: true }).click();
    await expect(img).toHaveAttribute('style', /object-fit:\s*contain/);
    await expect(img).not.toHaveAttribute('style', /scale\(/);
    // Fill again → the zoom-crop is restored (zoom value was preserved).
    await pop.getByRole('button', { name: 'Fill' }).click();
    await expect(img).toHaveAttribute('style', /scale\(2/);
  });

  test('dragging the grid hides the per-cell chrome', async ({ page }) => {
    const state = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const grid = document.querySelector('[data-card-id="home-grid"]');
      const gr = grid.getBoundingClientRect();
      const pe = (t, x, y, tg, b) => tg.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: b }));
      const gx = Math.round(gr.x + 24), gy = Math.round(gr.y + 10);
      pe('pointerdown', gx, gy, grid, 1);
      for (let i = 1; i <= 6; i++) { pe('pointermove', gx + i * 10, gy + i * 6, document, 1); await sleep(14); }
      grid.querySelector('.gridc-cell').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await sleep(20);
      const res = { dragging: grid.className.includes('is-dragging'), toolsOpacity: getComputedStyle(grid.querySelector('.gridc-celltools')).opacity };
      pe('pointerup', gx + 70, gy + 42, document, 0);
      return res;
    });
    expect(state.dragging).toBe(true);
    expect(state.toolsOpacity).toBe('0');       // hover pills suppressed mid-drag
  });

  test('the editor dismisses on outside-tap', async ({ page }) => {
    await openEditor(page);
    await page.mouse.click(12, 12);
    await expect(page.locator('.gridc-photo-pop')).toHaveCount(0);
  });
});
