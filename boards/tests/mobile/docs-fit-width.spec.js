import { expect, test } from '@playwright/test';

// A doc sheet is a fixed 816px (8.5in) box scaled by CSS `zoom`. On a phone
// that's ~2× the viewport and nothing auto-shrank it, so you saw about half the
// page with no way to reach the rest (horizontal panning was also dead — see
// the `html { touch-action }` note in styles.css). Screenplay was worse: its
// contract is that the on-screen wrap column, the paginator and the exported
// PDF all agree, which only holds while the sheet keeps its true geometry.
//
// The fix scaled the WHOLE sheet to the available width instead of reflowing,
// so proportions, the 60ch column, the ch indents and the page breaks are all
// preserved exactly. That rendered 12pt text at ~6px on a 390px phone
// (VS-DOCS-05), so now:
//   - screenplay fits its 6.0in TEXT COLUMN to the width (the margins are a
//     pan away) — the sheet's geometry is still untouched;
//   - paged prose, which has no geometry contract (pagination is decoration
//     over one content fragment), shows continuous on a phone.

const PAGE_W = 816;

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

// The zoom the sheet is actually rendered at, plus the box it produces.
async function readFit(page) {
  return page.evaluate(() => {
    const paper = document.querySelector('.doc-paper');
    const wrap = document.querySelector('.doc-editor-wrap');
    if (!paper) return null;
    const cs = getComputedStyle(paper);
    return {
      fitMode: paper.classList.contains('is-fit-width'),
      zoom: parseFloat(cs.getPropertyValue('--doc-zoom')) || 1,
      paperClientWidth: paper.clientWidth,
      padX: (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0),
      wrapRenderedWidth: wrap ? wrap.getBoundingClientRect().width : null,
      paperScrollWidth: paper.scrollWidth,
    };
  });
}

test('phone: a paged prose doc shows continuous, at full size', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome' && testInfo.project.name !== 'mobile-safari', 'phone-width only (≤640px)');
  await openDoc(page);

  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    T.setPageless(T.ydoc, T.getScope(), false);
  });
  await expect(page.locator('.doc-paper.is-pageless')).toBeVisible();

  const r = await readFit(page);
  expect(r).not.toBeNull();
  // Not scaled: the text renders at its real size and the wrap is fluid.
  expect(r.fitMode).toBe(false);
  expect(r.zoom).toBeCloseTo(1, 2);
  expect(r.wrapRenderedWidth).toBeLessThanOrEqual(r.paperClientWidth + 1);
  // The doc's own setting is untouched — exports and wider screens keep pages.
  const stillPaged = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    return T.getPageless(T.ydoc, T.getScope()) === false;
  });
  expect(stillPaged).toBe(true);
});

test('phone: pageless prose is left fluid, not scaled', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome' && testInfo.project.name !== 'mobile-safari', 'phone-width only (≤640px)');
  await openDoc(page);
  // Pageless is the default. Its wrap is already width:100%/max-width:816px, so
  // it fits a phone on its own — scaling it would shrink readable text for no
  // reason. Fit mode must stay OFF here.
  const r = await readFit(page);
  expect(r.fitMode).toBe(false);
  expect(r.zoom).toBeCloseTo(1, 2);
  expect(r.wrapRenderedWidth).toBeLessThanOrEqual(r.paperClientWidth + 1);
});

test('phone: screenplay keeps its true 8.5in geometry while fitted', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome' && testInfo.project.name !== 'mobile-safari', 'phone-width only (≤640px)');
  await openDoc(page);

  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    T.setDocMode(T.ydoc, T.getScope(), 'screenplay');
  });
  await expect(page.locator('.doc-paper.is-screenplay')).toBeVisible();

  const r = await page.evaluate(() => {
    const paper = document.querySelector('.doc-paper');
    const wrap = document.querySelector('.doc-editor-wrap');
    const cs = getComputedStyle(wrap);
    return {
      fitMode: paper.classList.contains('is-fit-width'),
      // Layout px are PRE-zoom, so these must still read as the real sheet:
      // 8.5in wide with the industry 1.5in/1.0in left/right margins.
      wrapOffsetWidth: wrap.offsetWidth,
      padLeft: parseFloat(cs.paddingLeft),
      padRight: parseFloat(cs.paddingRight),
      // The rendered TEXT COLUMN, however, must fit the phone.
      zoom: parseFloat(getComputedStyle(paper).getPropertyValue('--doc-zoom')) || 1,
      padX: (parseFloat(getComputedStyle(paper).paddingLeft) || 0) + (parseFloat(getComputedStyle(paper).paddingRight) || 0),
      paperClientWidth: paper.clientWidth,
    };
  });

  expect(r.fitMode).toBe(true);
  // The narrow-viewport padding relief must NOT apply here — it would change
  // the sheet's proportions and break the paginator/PDF agreement.
  expect(r.padLeft).toBeCloseTo(144, 0);   // 1.5in
  expect(r.padRight).toBeCloseTo(96, 0);   // 1.0in
  // offsetWidth is an integer and the box is inside a CSS `zoom`, so WebKit can
  // report 815 for the same 816px box Chromium reports exactly.
  expect(Math.abs(r.wrapOffsetWidth - PAGE_W)).toBeLessThanOrEqual(1);
  // Scaled so the 6.0in (576px) column fits — floored, so never wider.
  expect(r.zoom).toBeLessThan(1);
  expect(576 * r.zoom).toBeLessThanOrEqual(r.paperClientWidth - r.padX + 1);
});

test('tablet: a script shows at 100%, its column whole on screen and its sheet a true page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'tablet', 'runs on the tablet project only');
  await openDoc(page);
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    T.setDocMode(T.ydoc, T.getScope(), 'screenplay');
  });
  await expect(page.locator('.doc-paper.is-screenplay')).toBeVisible();
  // An 834px portrait iPad has no room for the page list beside a page: the
  // list tucks away and the column fits the width at actual size
  // (lib/docRoom.js). With the list open the sheet used to be squeezed to the
  // paper, wrapping the script at about half its 60 characters. (A wide
  // window keeps fit mode off: doc-narrow-pane.spec.)
  const r = await readFit(page);
  expect(r.zoom).toBeCloseTo(1, 2);
  expect(576 * r.zoom).toBeLessThanOrEqual(r.paperClientWidth - r.padX + 1);
  expect(r.wrapRenderedWidth).toBeCloseTo(PAGE_W * r.zoom, 0);
});
