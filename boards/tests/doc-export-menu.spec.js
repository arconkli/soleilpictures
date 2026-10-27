// Regression + behavior for the doc/screenplay "Export" control.
//
// 1) The dropdown must actually be reachable. The old toolbar (.doc-tb) was a
//    horizontal scroll container (overflow-x:auto; overflow-y:hidden); for
//    months the Export menu was an inline absolutely-positioned child of it, so
//    it was CLIPPED to a few-pixel sliver — the user saw a dark sliver but could
//    never click "Export PDF". The fix portals the menu to <body> (fixed,
//    anchored to the trigger), as the bar's other menus are. getBoundingClientRect
//    IGNORES ancestor overflow-clipping, so a rect check would pass while
//    clipped — the reliable signal is hit-testing (document.elementFromPoint).
//
// 2) An exported screenplay is NAMED after the document and carries the
//    writer's title page when it is on (its title also drives the filename) —
//    and no cover when it is off, like Fountain and FDX (DOCS-19: a cover used
//    to be synthesized anyway, crediting whoever exported).

import { expect, test } from '@playwright/test';
import { exportRow, setScreenplay, setTitlePage } from './helpers/docFrame.js';
import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);

async function parsePdf(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(tc.items.map((i) => i.str).join(' '));
  }
  return { numPages: doc.numPages, text: pages.join('\n') };
}

async function readDownloadPdf(download) {
  const path = await download.path();
  return parsePdf(new Uint8Array(readFileSync(path)));
}

async function openScreenplayDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await expect(page.locator('.tt-editor').first()).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  await setScreenplay(page.locator('.doc-card-modal'), true);
  await expect(page.locator('.doc-paper.is-screenplay')).toBeVisible();
}

// Export's PDF row, in ⋯ › Export.
async function exportPdf(page) {
  const row = await exportRow(page.locator('.doc-card-modal'), 'pdf');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    row.click({ timeout: 4000 }),
  ]);
  return download;
}

// Is `locator`'s element the actual hit target at its own center (i.e. not
// clipped by an ancestor's overflow and not covered by anything)?
async function isHittable(locator) {
  if (!(await locator.count())) return { found: false };
  return locator.first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { found: true, hittable: false, reason: 'zero-size', r };
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return {
      found: true,
      hittable: !!top && (top === el || el.contains(top) || top.contains(el)),
      inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
      r: { top: r.top, bottom: r.bottom, height: r.height },
    };
  });
}

test('the Export menu opens fully (not clipped) and Export PDF adds no title page the writer turned off', async ({ page }) => {
  await openScreenplayDoc(page);

  // Open the menu and prove the "Export PDF" item is a genuine hit target — the
  // whole bug was that it existed in the DOM but was clipped to a sliver.
  const pdfRow = await exportRow(page.locator('.doc-card-modal'), 'pdf');
  await expect(pdfRow).toBeVisible();
  const menu = pdfRow.locator('xpath=ancestor::*[@role="menu"][1]');

  const hit = await isHittable(menu);
  expect(hit.found).toBe(true);
  expect(hit.r.height).toBeGreaterThan(40);   // a real multi-row menu, not a sliver
  expect(hit.inViewport).toBe(true);
  expect(hit.hittable).toBe(true);

  // Click it → a real PDF download, with the Title Page left off: body only,
  // no synthesized cover crediting the exporter.
  await page.evaluate(() => {
    window.__soleilDocTest.editor.commands.setContent(window.__soleilDocTest.screenplay.blocksToDocJSON([
      { element: 'scene', text: 'INT. KITCHEN - NIGHT' },
      { element: 'action', text: 'A kettle starts to sing.' },
    ]));
  });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    pdfRow.click({ timeout: 4000 }),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

  const pdf = await readDownloadPdf(download);
  expect(pdf.numPages).toBe(1);                       // the script, no cover
  expect(pdf.text).toMatch(/INT\. KITCHEN/);
  expect(pdf.text).not.toContain('Written by');
  expect(pdf.text).not.toContain('QA Tester');        // the exporter is not credited
});

test('a configured title page is included in the PDF and names the file', async ({ page }) => {
  await openScreenplayDoc(page);

  // Turn on the title page and give the screenplay a real title.
  await setTitlePage(page.locator('.doc-card-modal'), true);
  const titlePage = page.locator('.doc-card-modal .sp-title-page');
  await expect(titlePage).toBeVisible();
  const titleField = titlePage.locator('.sp-tp-title');
  await titleField.click();
  await titleField.fill('Big Fish');
  // Commit the field (blur by clicking the script body) and type a line.
  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();
  await page.keyboard.type('INT. RIVER - DAY\n');

  const download = await exportPdf(page);

  // Named after the document (the title-page title), not "Untitled doc".
  expect(download.suggestedFilename()).toBe('Big Fish.pdf');

  const pdf = await readDownloadPdf(download);
  expect(pdf.numPages).toBeGreaterThanOrEqual(2);
  expect(pdf.text).toContain('Big Fish');          // the title page is in the PDF
  expect(pdf.text).toMatch(/INT\. RIVER/i);        // and the body followed it
});
