// The full-screen viewers a card opens — the PDF viewer, the image lightbox,
// the photo editor — are layers OVER the board, not part of it.
//
// They used to render inside .canvas-wrap (the PDF viewer and the canvas-level
// lightbox) or bubble through the React tree back to the card that opened them
// (the grid cell's lightbox and editor). So a wheel over a PDF panned the board,
// a drag on a lightbox dragged the grid behind it, and Backspace with a viewer
// button focused deleted the selected card. Local QA mode, no backend.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const SAMPLE_PDF = resolve(dirname(fileURLToPath(import.meta.url)), '../public/sample.pdf');

async function go(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => { try { localStorage.removeItem('soleil-boards-tweaks'); } catch (_) {} });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await expect(page.locator('.rail-brand')).toBeVisible();
}

async function addPdf(page) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    (async () => {
      await page.getByRole('button', { name: 'Add menu', exact: true }).click();
      await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    })(),
  ]);
  await chooser.setFiles(SAMPLE_PDF);
  await expect(page.locator('.pdfc').first()).toBeVisible({ timeout: 15000 });
}

const parentIsBody = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return !!el && el.parentElement === document.body && !el.closest('.canvas-wrap');
}, sel);

test.describe('card overlays', () => {
  test('the PDF viewer sits over the board: the wheel scrolls its pages and Backspace leaves the card alone', async ({ page }) => {
    await go(page);
    await addPdf(page);
    const before = await page.locator('[data-card-id]').count();

    await page.locator('.pdfc .ic-expand').first().click();
    const viewer = page.locator('.pdfv[role="dialog"]');
    await expect(viewer.locator('.pdfv-page canvas').first()).toBeVisible({ timeout: 15000 });
    expect(await parentIsBody(page, '.pdfv[role="dialog"]')).toBe(true);

    // Zoom in so the three pages are certainly taller than the viewport.
    await viewer.getByRole('button', { name: 'Zoom in' }).click();
    await viewer.getByRole('button', { name: 'Zoom in' }).click();
    const sc = viewer.locator('.pdfv-scroll');
    const box = await sc.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 900);
    await expect.poll(() => sc.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // A focused viewer button is not an "editable target": the board's
    // Backspace must not reach the card behind the viewer.
    await viewer.getByRole('button', { name: 'Zoom out' }).focus();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Escape');
    await expect(page.locator('.pdfv')).toHaveCount(0);
    await expect(page.locator('[data-card-id]')).toHaveCount(before);
  });

  test('the canvas image lightbox is portaled out of the board', async ({ page }) => {
    await go(page);
    const card = page.locator('[data-card-id]:has(.ic-img)').first();
    await card.locator('.ic-img').waitFor({ state: 'visible' });
    await card.hover();
    await card.locator('.ic-expand').click();
    await expect(page.locator('.lightbox')).toBeVisible();
    expect(await parentIsBody(page, '.lightbox')).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('.lightbox')).toHaveCount(0);
  });

  test('dragging on a grid cell\'s full-screen viewer does not drag the grid behind it', async ({ page }) => {
    await go(page);
    const grid = page.locator('[data-card-id="home-grid"]');
    const cell = grid.locator('.gridc-cell-image').first();
    await cell.locator('.gc-img').waitFor({ state: 'visible' });
    const at = await grid.boundingBox();

    await cell.hover();
    await cell.getByRole('button', { name: 'Open full screen' }).click();
    const lb = page.locator('.lightbox');
    await expect(lb).toBeVisible();

    // A double-click on the viewer must not reach the grid either.
    await lb.locator('.lightbox-stage').dispatchEvent('dblclick');
    // Press on the backdrop and drag a long way. The release is a backdrop
    // click, which closes the viewer — the grid must still be where it was.
    await page.mouse.move(60, 450);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(60 + i * 30, 450 + i * 20);
    await page.mouse.up();

    if (await lb.count()) await page.keyboard.press('Escape');
    await expect(lb).toHaveCount(0);
    const after = await grid.boundingBox();
    expect(Math.abs(after.x - at.x)).toBeLessThan(1);
    expect(Math.abs(after.y - at.y)).toBeLessThan(1);
  });
});
