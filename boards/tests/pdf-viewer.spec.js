import { expect, test } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The full-screen PDF viewer:
//   CARDS-12 — it gives a page's bitmap back once it scrolls out of range and
//              draws it again when it returns. Every visited page used to keep
//              a full-resolution canvas for the life of the viewer.
//   CARDS-13 — zooming keeps the point you were reading in place. scrollTop
//              used to stay put while every page grew, so the view slid pages
//              away from where you were.

const SAMPLE_PDF = resolve(dirname(fileURLToPath(import.meta.url)), '../public/sample.pdf');

async function openViewer(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.rail-brand')).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    (async () => {
      await page.getByRole('button', { name: 'Add menu', exact: true }).click();
      await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    })(),
  ]);
  await chooser.setFiles(SAMPLE_PDF);
  await expect(page.locator('.pdfc').first()).toBeVisible({ timeout: 15000 });

  await page.locator('.pdfc .ic-expand').first().click();
  const viewer = page.locator('.pdfv[role="dialog"]');
  await expect(viewer.locator('.pdfv-page canvas').first()).toBeVisible({ timeout: 15000 });
  return viewer;
}

test('pages far out of view hold no canvas, and render again on return', async ({ page }) => {
  const viewer = await openViewer(page);
  const firstPage = viewer.locator('.pdfv-page[data-page="1"] canvas');
  await expect(firstPage).toHaveCount(1, { timeout: 15000 });

  // Max zoom: each page is several viewports tall, so page 1 is well past the
  // render margin once we're at the end of the document.
  const zoomIn = viewer.getByRole('button', { name: 'Zoom in' });
  for (let i = 0; i < 20 && await zoomIn.isEnabled(); i++) await zoomIn.click();
  const sc = viewer.locator('.pdfv-scroll');
  await sc.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(viewer.locator('.pdfv-page[data-page="3"] canvas')).toHaveCount(1, { timeout: 15000 });
  await expect(firstPage).toHaveCount(0);

  await sc.evaluate((el) => { el.scrollTop = 0; });
  await expect(firstPage).toHaveCount(1, { timeout: 15000 });
});

test('zooming keeps the reading position on the same page', async ({ page }) => {
  const viewer = await openViewer(page);
  const sc = viewer.locator('.pdfv-scroll');
  const zin = viewer.getByRole('button', { name: 'Zoom in' });
  const zout = viewer.getByRole('button', { name: 'Zoom out' });
  await zin.click(); await zin.click();
  // Where the middle of the view falls: which page, and how far down it.
  const where = () => sc.evaluate((el) => {
    const mid = el.scrollTop + el.clientHeight / 2;
    for (const p of el.querySelectorAll('.pdfv-page')) {
      if (mid >= p.offsetTop && mid < p.offsetTop + p.offsetHeight) return { page: p.dataset.page, frac: (mid - p.offsetTop) / p.offsetHeight };
    }
    return { page: null, frac: 0 };
  });
  await sc.evaluate((el) => {
    const p = el.querySelector('.pdfv-page[data-page="2"]');
    el.scrollTop = p.offsetTop + p.offsetHeight * 0.6 - el.clientHeight / 2;
  });
  const before = await where();
  expect(before.page).toBe('2');

  await zin.click(); await zin.click(); await zin.click();
  let after = await where();
  expect(after.page).toBe('2');
  expect(Math.abs(after.frac - before.frac)).toBeLessThan(0.02);

  for (let i = 0; i < 5; i++) await zout.click();
  after = await where();
  expect(after.page).toBe('2');
  expect(Math.abs(after.frac - before.frac)).toBeLessThan(0.02);
});
