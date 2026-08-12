// PDF card + in-app viewer (local QA mode — no backend).
// Exercises: the kind:'pdf' card render (placeholder + filename + page count),
// opening the fullscreen PdfViewer, page rendering via pdf.js (incl. the
// worker-resolves-under-Vite smoke check), zoom, and close.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

// The fixture the local harness has always used, now uploaded through the real
// picker instead of conjured by a menu item.
const SAMPLE_PDF = resolve(dirname(fileURLToPath(import.meta.url)), '../public/sample.pdf');

async function go(page) {
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => { try { localStorage.removeItem('soleil-boards-tweaks'); } catch (_) {} });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await expect(page.locator('.rail-brand')).toBeVisible();
}

// Add menu → File → choose a PDF.
//
// There is no "PDF" menu item any more, and there should not be: PDF creation
// was consolidated into the one file picker, which routes on type through
// classifyDropFile. This drives THAT path — the one a user actually takes —
// rather than a dedicated entry that no longer exists.
//
// openFilePicker builds a detached <input type=file> and clicks it, so there is
// no element to setInputFiles on; the filechooser event is how Playwright
// drives a real OS picker.
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

test.describe('PDF card', () => {
  test('uploading a PDF through the file picker spawns a PDF card', async ({ page }) => {
    await go(page);
    await addPdf(page);
    const card = page.locator('.pdfc').first();
    await expect(card.locator('.pdfc-info-name')).toContainText('sample.pdf');
    // Page count is deliberately NOT asserted here. Local QA mode points the
    // card at a blob URL and sets no pageCount (CanvasSurface.jsx:2225) — only
    // the uploaded path learns it, from uploadPdf. The viewer test below
    // asserts "1 / 3" instead, where pdf.js has actually parsed the file, which
    // is a stronger claim than a fixture constant ever was.
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
    const wrap = page.locator('.pdfc .pdfc-thumbwrap').first();
    await expect(wrap).toBeVisible();
    await wrap.dblclick();
    // The Suspense fallback (.pdfv) shows immediately; the lazy chunk can take a
    // moment to load under batch load, so allow extra time.
    await expect(page.locator('.pdfv')).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.pdfv')).toHaveCount(0);
  });
});
