import { expect, test } from '@playwright/test';

// A doc sheet is a fixed 816px (8.5in) box scaled by CSS `zoom`. On a phone
// that's ~2× the viewport and nothing auto-shrank it, so you saw about half the
// page with no way to reach the rest (horizontal panning was also dead — see
// the `html { touch-action }` note in styles.css). Screenplay was worse: its
// contract is that the on-screen wrap column, the paginator and the exported
// PDF all agree, which only holds while the sheet keeps its true geometry.
//
// The fix scales the WHOLE sheet to the available width instead of reflowing,
// so proportions, the 60ch column, the ch indents and the page breaks are all
// preserved exactly.

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

test('phone: a fixed-sheet doc auto-fits the viewport width', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome' && testInfo.project.name !== 'mobile-safari', 'phone-width only (≤640px)');
  await openDoc(page);

  // Paged prose is one of the two fixed-816px layouts (screenplay is the
  // other). Pageless prose is deliberately excluded — see the next test.
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    T.setPageless(T.ydoc, T.getScope(), false);
  });
  await expect(page.locator('.doc-paper.is-fit-width')).toBeVisible();

  const r = await readFit(page);
  expect(r).not.toBeNull();
  expect(r.fitMode).toBe(true);

  // The zoom is derived from the space actually available inside the paper, and
  // FLOORED to 2dp — never rounded up, or 816 x zoom would be wider than the
  // space and the paper would scroll sideways. So it sits within one floor step
  // BELOW the raw ratio, never above it.
  const expected = (r.paperClientWidth - r.padX) / PAGE_W;
  expect(r.zoom).toBeLessThanOrEqual(expected);
  expect(r.zoom).toBeGreaterThan(expected - 0.011);
  // …and it really did shrink (a phone is well under 816px + padding).
  expect(r.zoom).toBeLessThan(1);

  // The rendered sheet fits, so the page never scrolls sideways.
  expect(r.wrapRenderedWidth).toBeLessThanOrEqual(r.paperClientWidth + 1);
  expect(r.paperScrollWidth).toBeLessThanOrEqual(r.paperClientWidth + 1);
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
      // The rendered box, however, must fit the phone.
      renderedWidth: wrap.getBoundingClientRect().width,
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
  // Scaled down to fit.
  expect(r.renderedWidth).toBeLessThanOrEqual(r.paperClientWidth + 1);
});

test('desktop: fit mode is off and the sheet renders at 100%', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'tablet', 'runs on the wide (tablet) project only');
  await openDoc(page);
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    T.setDocMode(T.ydoc, T.getScope(), 'screenplay');
  });
  await expect(page.locator('.doc-paper.is-screenplay')).toBeVisible();
  const r = await readFit(page);
  expect(r.fitMode).toBe(false);
  expect(r.zoom).toBeCloseTo(1, 2);
});
