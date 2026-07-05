import { expect, test } from '@playwright/test';

// Full image controls for a grid IMAGE cell — parity with a standalone image
// (fit/reposition/zoom + the non-destructive photo-adjust stack). The seeded
// Studio board carries `home-grid`, a storyboard grid whose bottom-left cell
// (`hg-img`) already holds an image, so we can drive the controls without an
// upload backend (fillCellFromFiles needs one, and image cards can't be dragged
// into a cell under headless input).

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

  test('Edit photo exposes framing + the full photo-adjust panel', async ({ page }) => {
    const pop = await openEditor(page);
    // Framing controls (cell-specific).
    await expect(pop.getByRole('button', { name: 'Fill' })).toBeVisible();
    await expect(pop.getByRole('button', { name: 'Fit', exact: true })).toBeVisible();
    await expect(pop.getByRole('button', { name: 'Reposition' })).toBeVisible();
    await expect(pop.getByRole('button', { name: 'Reset framing' })).toBeVisible();
    await expect(pop.locator('input[aria-label="Zoom"]')).toBeVisible();
    // Photo adjustments (shared ImageAdjustPanel — the same one a standalone image gets).
    await expect(pop.locator('input[aria-label="Exposure"]')).toBeVisible();
    // Expand → the full Light/Color/Detail set (all 12 sliders).
    await pop.getByRole('button', { name: 'Full screen' }).click();
    await expect(pop.locator('input[aria-label="Clarity"]')).toBeVisible();
    await expect(pop.locator('input[aria-label="Sharpness"]')).toBeVisible();
  });

  test('a photo-adjust slider applies a filter that actually resolves', async ({ page }) => {
    const pop = await openEditor(page);
    const img = imgCell(page).locator('.gc-img');
    await setRange(pop.locator('input[aria-label="Exposure"]'), 60);
    // The cell <img> gains a per-cell filter AND GridCard renders the matching def.
    await expect(img).toHaveAttribute('style', /soleil-adj-/);
    expect(await page.locator('filter[id^="soleil-adj-"]').count()).toBeGreaterThan(0);
    // Reset (in the panel) clears it.
    await pop.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(img).not.toHaveAttribute('style', /soleil-adj-/);
  });

  test('fit + zoom + reset framing drive the cell image', async ({ page }) => {
    const pop = await openEditor(page);
    const img = imgCell(page).locator('.gc-img');
    // Fit → contain, Fill → cover.
    await pop.getByRole('button', { name: 'Fit', exact: true }).click();
    await expect(img).toHaveAttribute('style', /object-fit:\s*contain/);
    await pop.getByRole('button', { name: 'Fill' }).click();
    await expect(img).toHaveAttribute('style', /object-fit:\s*cover/);
    // Zoom → transform scale(); Reset framing clears it.
    await setRange(pop.locator('input[aria-label="Zoom"]'), 2);
    await expect(img).toHaveAttribute('style', /scale\(2/);
    await pop.getByRole('button', { name: 'Reset framing' }).click();
    await expect(img).not.toHaveAttribute('style', /scale\(/);
  });

  test('the editor dismisses on outside-tap', async ({ page }) => {
    await openEditor(page);
    await page.mouse.click(12, 12);
    await expect(page.locator('.gridc-photo-pop')).toHaveCount(0);
  });
});
