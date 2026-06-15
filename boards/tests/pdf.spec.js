// PDF card + in-app viewer (local QA mode — no backend).
// Exercises: the kind:'pdf' card render (placeholder + filename + page count),
// opening the fullscreen PdfViewer, page rendering via pdf.js (incl. the
// worker-resolves-under-Vite smoke check), zoom, and close.

import { expect, test } from '@playwright/test';

async function go(page) {
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => { try { localStorage.removeItem('soleil-boards-tweaks'); } catch (_) {} });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await expect(page.locator('.rail-brand')).toBeVisible();
}

async function addPdf(page) {
  await page.getByRole('button', { name: 'Add menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'PDF', exact: true }).click();
  await expect(page.locator('.pdfc').first()).toBeVisible();
}

test.describe('PDF card', () => {
  test('Add menu has a PDF entry that spawns a PDF card', async ({ page }) => {
    await go(page);
    await addPdf(page);
    const card = page.locator('.pdfc').first();
    await expect(card.locator('.pdfc-info-name')).toContainText('sample.pdf');
    await expect(card.locator('.pdfc-info-pages')).toContainText('3 pages');
  });

  test('opens the in-app viewer, renders pages, zooms, and closes', async ({ page }) => {
    const workerWarnings = [];
    page.on('console', (msg) => {
      const t = msg.text();
      if (/fake worker|workerSrc/i.test(t)) workerWarnings.push(t);
    });

    await go(page);
    await addPdf(page);

    // Open the viewer via the expand button.
    await page.locator('.pdfc .ic-expand').first().click();
    const viewer = page.locator('.pdfv');
    await expect(viewer).toBeVisible();

    // pdf.js renders at least the first page into a canvas.
    await expect(viewer.locator('.pdfv-page canvas').first()).toBeVisible({ timeout: 15000 });
    await expect(viewer.locator('.pdfv-pageind')).toContainText('1 / 3');

    // Worker resolved under Vite (no main-thread fake-worker fallback).
    expect(workerWarnings, workerWarnings.join('\n')).toHaveLength(0);

    // Zoom in changes the reported zoom %.
    const zoomBefore = await viewer.locator('.pdfv-zoomind').textContent();
    await viewer.getByRole('button', { name: 'Zoom in' }).click();
    await expect(viewer.locator('.pdfv-zoomind')).not.toHaveText(zoomBefore || '');

    // Escape closes.
    await page.keyboard.press('Escape');
    await expect(page.locator('.pdfv')).toHaveCount(0);
  });

  test('double-clicking the card opens the viewer', async ({ page }) => {
    await go(page);
    await addPdf(page);
    await page.locator('.pdfc .pdfc-thumbwrap').first().dblclick();
    await expect(page.locator('.pdfv')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.pdfv')).toHaveCount(0);
  });
});
