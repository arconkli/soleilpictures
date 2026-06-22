// Doc page layout: pageless is the DEFAULT (one continuous sheet, no page
// breaks); the "Pages" toolbar pill opts into real 8.5×11 pages; and — the
// reported bug — in page mode a long bullet list must NEVER render text in the
// dark gutter between page sheets (a list used to flow across as one atomic
// block). Driven via ?docqa=1 (window.__soleilDocTest).
import { expect, test } from '@playwright/test';

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

const pillSel = '.doc-card-modal .doc-tb-pages-toggle';
const sheetSel = '.doc-card-modal .doc-page-sheet';
const gapSel = '.doc-card-modal .doc-page-gap';

// Read the live doc's pageless flag from docMeta (the source of truth).
function readPageless(page) {
  return page.evaluate(() => {
    const T = window.__soleilDocTest;
    return T.getPageless(T.ydoc, T.getScope());
  });
}

test('prose docs are pageless by default — no page sheets or gutters', async ({ page }) => {
  await openDoc(page);
  await page.waitForTimeout(200); // give any (absent) pagination a chance to run
  expect(await readPageless(page)).toBe(true);
  await expect(page.locator(sheetSel)).toHaveCount(0);
  await expect(page.locator(gapSel)).toHaveCount(0);
  // The "Pages" pill exists (prose mode) but is inactive.
  const pill = page.locator(pillSel);
  await expect(pill).toBeVisible();
  await expect(pill).not.toHaveClass(/is-active/);
});

test('pageless: the sheet grows with content — text never spills off the page', async ({ page }) => {
  await openDoc(page);
  // Content far taller than one 1056px page.
  await page.evaluate(() => {
    const ps = Array.from({ length: 80 }, (_, i) => `<p>Paragraph ${i + 1}. The quick brown fox jumps over the lazy dog.</p>`).join('');
    window.__soleilDocTest.editor.chain().setContent(ps).run();
  });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const wrap = document.querySelector('.doc-card-modal .doc-editor-wrap');
    const ed = document.querySelector('.doc-card-modal .tt-editor');
    return { wrapH: wrap.getBoundingClientRect().height, edBottom: ed.getBoundingClientRect().bottom, wrapBottom: wrap.getBoundingClientRect().bottom };
  });
  // The white sheet is taller than a single page (it grew)…
  expect(r.wrapH).toBeGreaterThan(1056 + 200);
  // …and the editor's text bottom sits INSIDE the sheet (no abyss overflow).
  expect(r.edBottom).toBeLessThanOrEqual(r.wrapBottom + 1);
});

test('the Pages pill switches to a paged layout and persists in docMeta', async ({ page }) => {
  await openDoc(page);
  const pill = page.locator(pillSel);

  // Turn ON pages → white page sheets appear, pill activates, flag persists.
  await pill.click();
  await expect(page.locator(sheetSel).first()).toBeVisible({ timeout: 6000 });
  await expect(page.locator(pillSel)).toHaveClass(/is-active/);
  expect(await readPageless(page)).toBe(false);

  // Turn it back OFF → continuous again, no sheets.
  await page.locator(pillSel).click();
  await expect(page.locator(sheetSel)).toHaveCount(0, { timeout: 6000 });
  expect(await readPageless(page)).toBe(true);
});

test('page mode: a long bullet list never renders text in the page gutters', async ({ page }) => {
  await openDoc(page);

  // Switch to real pages and wait for the flow model to mount.
  await page.locator(pillSel).click();
  await expect(page.locator('.doc-card-modal .doc-pages-bg')).toBeVisible({ timeout: 6000 });

  // A bulleted outline tall enough to span several pages — the exact shape that
  // used to flow continuously across every gutter.
  await page.evaluate(() => {
    const items = Array.from({ length: 70 }, (_, i) =>
      `<li>Outline item ${i + 1} — enough prose on each row that the list runs well past a single page and is forced to break.</li>`).join('');
    window.__soleilDocTest.editor.chain().setContent(`<ul>${items}</ul>`).run();
  });

  // Wait for the paginator to produce more than one sheet, then let the
  // natural-offset measure loop converge.
  await page.waitForFunction((sel) => document.querySelectorAll(sel).length >= 2,
    sheetSel, { timeout: 8000 });
  await page.waitForTimeout(400);

  const report = await page.evaluate(() => {
    const root = document.querySelector('.doc-card-modal .tt-editor');
    const sheets = Array.from(document.querySelectorAll('.doc-card-modal .doc-page-sheet'))
      .map((el) => el.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);
    // Gutter bands = the dark space between consecutive sheets (shrunk 2px so a
    // line flush against a sheet edge isn't a false positive).
    const bands = [];
    for (let i = 0; i < sheets.length - 1; i++) {
      bands.push({ top: sheets[i].bottom + 2, bottom: sheets[i + 1].top - 2 });
    }
    // Measure TEXT line boxes only (per text node) so the transparent
    // .doc-page-gap spacer widget — which legitimately lives in a gutter — is
    // never counted.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const offenders = [];
    let lineBoxes = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue || !n.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.height === 0) continue;
        lineBoxes++;
        const center = r.top + r.height / 2;
        for (const b of bands) {
          if (center > b.top && center < b.bottom) {
            offenders.push({ center: Math.round(center), band: [Math.round(b.top), Math.round(b.bottom)] });
            break;
          }
        }
      }
    }
    return { sheetCount: sheets.length, bandCount: bands.length, lineBoxes, offenders };
  });

  expect(report.sheetCount).toBeGreaterThanOrEqual(2);
  expect(report.bandCount).toBeGreaterThanOrEqual(1);
  expect(report.lineBoxes).toBeGreaterThan(40); // sanity: we actually measured the list
  // The whole point: not a single line of text sits in a page gutter.
  expect(report.offenders).toEqual([]);
});
