// The screen == PDF guarantee: for the SAME script, the on-screen page-break
// markers, the pure paginator's pageCount, and the print shell's page sections
// must agree. Plus a wrap-fidelity check: a block sized to N grid lines renders
// as N visual lines (the ch-grid matches the paginator's char widths).

import { expect, test } from '@playwright/test';

async function openScreenplay(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!(window.__soleilDocTest && window.__soleilDocTest.screenplay), null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await expect(page.locator('.tt-editor').first()).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  await page.locator('.doc-tb-screenplay-toggle').click();
  await expect(page.locator('.doc-paper.is-screenplay')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

test('on-screen pages == paginator pageCount == print sections', async ({ page }) => {
  await openScreenplay(page);

  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    // A multi-page script: several scenes with long action + a splitting dialogue.
    const blocks = [];
    for (let s = 0; s < 4; s++) {
      blocks.push({ element: 'scene', text: `INT. ROOM ${s} - DAY` });
      blocks.push({ element: 'action', text: ('word ').repeat(60 * 12).trim() }); // ~12 lines
      blocks.push({ element: 'character', text: 'SPEAKER' });
      blocks.push({ element: 'dialogue', text: ('talk ').repeat(35 * 8).trim() }); // ~8 lines
    }
    const paginated = S.paginate(blocks);
    const printHtml = S.screenplayPrintHTML(blocks, { title: 'Parity' });
    const printSections = (printHtml.match(/class="sp-page"/g) || []).length;

    // Render on screen via the live editor, then read the marker count.
    const ed = window.__soleilDocTest.editor;
    ed.commands.setContent(S.blocksToDocJSON(blocks));
    return { pageCount: paginated.pageCount, printSections, blocksLen: blocks.length };
  });

  // Let the decoration plugin recompute after setContent.
  await page.waitForTimeout(250);
  const markers = await page.locator('.doc-paper.is-screenplay .sp-page-break-rule').count();

  expect(r.pageCount).toBeGreaterThanOrEqual(2);
  // N pages → N-1 on-screen break markers, and N print page sections.
  expect(markers).toBe(r.pageCount - 1);
  expect(r.printSections).toBe(r.pageCount);
});

test('a dialogue sized to N grid lines renders as N visual lines (ch-grid matches paginator)', async ({ page }) => {
  await openScreenplay(page);

  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    // 3 lines of dialogue at 35ch: three 30-char words separated by spaces wrap
    // one-per-line (each 30 ≤ 35, two together 61 > 35).
    const text = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB CCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
    const wrapped = S.wrapText(text, 35).length;
    const blocks = [{ element: 'character', text: 'X' }, { element: 'dialogue', text }];
    const ed = window.__soleilDocTest.editor;
    ed.commands.setContent(S.blocksToDocJSON(blocks));
    return { wrapped };
  });
  await page.waitForTimeout(150);

  const visualLines = await page.evaluate(() => {
    const el = document.querySelector('.doc-paper.is-screenplay [data-screenplay-element="dialogue"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight);
    return Math.round(el.getBoundingClientRect().height / lh);
  });

  expect(r.wrapped).toBe(3);
  expect(visualLines).toBe(3);
});
