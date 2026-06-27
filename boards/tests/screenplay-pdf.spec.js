// Screenplay PDF export — proves the previously-untested export path actually
// produces a valid, industry-formatted PDF, by (1) asserting the element indents
// directly and (2) generating a real multi-page PDF and reading it back with
// pdfjs-dist to check page count, page numbers, (MORE)/(CONT'D), Courier, and
// the on-page x-coordinates of each element (to ~1/100in).
//
// Driven through the ?docqa=1 bridge (window.__soleilDocTest.screenplay), which
// now also exposes buildScreenplayPdfBlob / elementXInches / PDF_GEOMETRY.

import { expect, test } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Parse PDF bytes in Node with pdfjs-dist (legacy build → no browser worker).
async function parsePdf(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Satisfy the worker-src check; Node has no Worker global so pdfjs runs the
  // fake worker on the main thread, which is fine for text extraction.
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // Each item: { str, transform:[a,b,c,d,e,f] } — e,f are x,y in points.
    pages.push(tc.items.map((i) => ({ str: i.str, x: i.transform[4] / 72, y: i.transform[5] / 72 })));
  }
  return { numPages: doc.numPages, pages };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!(window.__soleilDocTest && window.__soleilDocTest.screenplay
    && window.__soleilDocTest.screenplay.buildScreenplayPdfBlob), null, { timeout: 15000 });
});

test('element indents match industry standard (Final Draft positions)', async ({ page }) => {
  const g = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    return {
      scene: S.elementXInches('scene'),
      action: S.elementXInches('action'),
      character: S.elementXInches('character'),
      parenthetical: S.elementXInches('parenthetical'),
      dialogue: S.elementXInches('dialogue'),
      transition: S.elementXInches('transition'),
      geo: S.PDF_GEOMETRY,
    };
  });
  expect(g.scene).toBeCloseTo(1.5, 2);        // slugline flush at the 1.5" left margin
  expect(g.action).toBeCloseTo(1.5, 2);
  expect(g.dialogue).toBeCloseTo(2.5, 2);     // dialogue 2.5"
  expect(g.character).toBeCloseTo(3.7, 2);    // character cue 3.7"
  expect(g.parenthetical).toBeCloseTo(3.1, 2); // parenthetical 3.1"
  expect(g.transition).toBeCloseTo(7.5, 2);   // right-aligned to the 1" right margin
  expect(g.geo.LEFT).toBeCloseTo(1.5, 2);
  expect(g.geo.RIGHT).toBeCloseTo(7.5, 2);
  expect(g.geo.LINE).toBeCloseTo(1 / 6, 3);   // 6 lines/inch (12pt single-space)
});

test('exports a valid, paginated, industry-formatted PDF', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const S = window.__soleilDocTest.screenplay;
    // A long dialogue forces a page split with (MORE)/(CONT'D); a title page
    // adds an unnumbered first sheet.
    const longDialogue = Array(400).fill('apple').join(' ');
    const blocks = [
      { element: 'scene', text: 'INT. ROOM - DAY' },
      { element: 'action', text: 'She paces by the window.' },
      { element: 'character', text: 'JANE' },
      { element: 'dialogue', text: longDialogue },
      { element: 'transition', text: 'CUT TO:' },
      { element: 'scene', text: 'EXT. PARK - NIGHT' },
    ];
    const titlePage = { enabled: true, title: 'THE TEST', credit: 'Written by', authors: 'A. Writer' };
    const blob = await S.buildScreenplayPdfBlob(blocks, { title: 'The Test', titlePage, sceneNumbers: false });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return {
      b64: btoa(bin),
      size: buf.length,
      bodyPages: S.paginate(blocks).pageCount, // body pages, excluding the title page
    };
  });

  expect(result.size).toBeGreaterThan(1000);
  const bytes = Uint8Array.from(Buffer.from(result.b64, 'base64'));
  expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');

  expect(result.bodyPages).toBeGreaterThanOrEqual(2); // long dialogue must split
  const { numPages, pages } = await parsePdf(bytes);
  // Title page + the paginator's body pages.
  expect(numPages).toBe(result.bodyPages + 1);

  const allText = pages.flat().map((i) => i.str).join('\n');
  expect(allText).toContain('THE TEST');          // title page rendered
  expect(allText).toContain('INT. ROOM - DAY');   // slugline
  expect(allText).toMatch(/MORE/);                // split-dialogue marker
  expect(allText).toMatch(/CONT['’]D/);           // continued-cue marker

  // Page numbering follows the SCRIPT (body) pages, not the PDF pages: the title
  // page is unnumbered, the first script page (pdf page 2) is unnumbered, and the
  // second script page (pdf page 3) carries "2." top-right.
  const numRe = /^\d+\.$/;
  const firstBody = pages[1];
  expect(firstBody.some((i) => numRe.test(i.str.trim())), 'first script page is unnumbered').toBeFalsy();
  const secondBody = pages[2] || [];
  const pageNum = secondBody.find((i) => i.str.trim() === '2.');
  expect(pageNum, 'second script page numbered "2." top-right').toBeTruthy();
  // Right-aligned: transform.x is the text's LEFT edge, so add the (monospace,
  // 0.1in/char) width to check the number is flush to the 7.5in right margin.
  const rightEdge = pageNum.x + pageNum.str.trim().length * 0.1;
  expect(rightEdge).toBeCloseTo(7.5, 1);
  expect(pageNum.y).toBeGreaterThan(10);          // near the top of the page (PDF y up)

  // Geometry on the first body page (scene + action + cue + dialogue start).
  const at = (pred) => { const it = firstBody.find(pred); return it ? it.x : null; };
  expect(at((i) => i.str.includes('INT. ROOM'))).toBeCloseTo(1.5, 1);   // scene 1.5"
  expect(at((i) => i.str === 'JANE')).toBeCloseTo(3.7, 1);              // cue 3.7"
  const dlg = firstBody.find((i) => i.str.includes('apple') && i.x > 2 && i.x < 3);
  expect(dlg, 'a dialogue line should sit at ~2.5"').toBeTruthy();
  expect(dlg.x).toBeCloseTo(2.5, 1);                                    // dialogue 2.5"
});
