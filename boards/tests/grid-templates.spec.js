import { expect, test } from '@playwright/test';

// Grid templates — the Templates panel on the rail (?local=1), plus a thin
// wiring check on the pure helpers via ?gridqa=1.
//
// The tree math itself (instantiate / sanitize / rehome / reading order) is
// covered exhaustively by src/lib/gridLayoutLibrary.test.mjs; what can only be
// proven with real input is the part this file owns: that the grid tool opens a
// picker instead of arming the placer, that picking decides between "place" and
// "re-cut" from the selection, and that a re-cut carries content across.
//
// NOT covered here: ⌘Z. The local harness stubs undo (see lib/undoRework notes),
// so single-step undo of an apply is asserted at the engine level instead.

const RAIL = (name) => ({ name, exact: true });

async function gotoBlankBoard(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForSelector('.canvas-wrap');
}

const gridTool = (page) => page.getByRole('button', RAIL('Add grid tool'));
const panel = (page) => page.locator('.cnv-tpl-panel');
const template = (page, name) => panel(page).getByRole('menuitem', RAIL(name));

// Place a new grid from a named template: pick it, then click empty canvas.
//
// Waits out the card-pop entry animation before returning. A new card carries
// .is-new for 200ms (styles.css: .card.is-new), and a hover() landing inside
// that window gets "subtree intercepts pointer events" instead of the cell —
// rarely on an idle machine, reliably when the dev server is under load.
async function placeTemplate(page, name, at = { x: 520, y: 300 }) {
  await gridTool(page).click();
  await expect(panel(page)).toBeVisible();
  await template(page, name).click();
  await page.locator('.canvas-wrap').click({ position: at });
  await expect(page.locator('.card-kind-grid')).toHaveCount(1);
  await expect(page.locator('.card-kind-grid.is-new')).toHaveCount(0);
}

test.describe('grid templates — the rail panel', () => {
  test.beforeEach(async ({ page }) => { await gotoBlankBoard(page); });

  // The core behavioural change: the grid tool used to arm the placer with one
  // hardcoded shape. It now opens the picker, and opening a picker must not
  // itself arm anything — otherwise a click meant to dismiss the panel drops a
  // grid nobody asked for.
  test('the grid tool opens the panel without arming the placer', async ({ page }) => {
    await gridTool(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(gridTool(page)).toHaveClass(/active/);
    await expect(gridTool(page)).toHaveAttribute('aria-expanded', 'true');

    // Clicking the canvas closes the panel and creates NOTHING.
    await page.locator('.canvas-wrap').click({ position: { x: 600, y: 400 } });
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('.card-kind-grid')).toHaveCount(0);
  });

  test('Escape closes the panel', async ({ page }) => {
    await gridTool(page).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('.card-kind-grid')).toHaveCount(0);
  });

  // Every built-in ships a thumbnail drawn from the same computeCellRects the
  // card uses, so "what the tile shows" and "what you get" cannot drift.
  test('the panel lists built-ins with a shape preview each', async ({ page }) => {
    await gridTool(page).click();
    const items = panel(page).getByRole('menuitem');
    expect(await items.count()).toBeGreaterThanOrEqual(5);
    await expect(panel(page).locator('.tplt-thumb')).toHaveCount(await items.count());
    // The 2x2 tile's preview draws exactly four cells.
    await expect(template(page, '2 × 2').locator('.tplt-thumb rect')).toHaveCount(4);
  });

  // Presets other than the storyboard were unreachable before this panel existed
  // — PRESETS was imported by the QA bridge and nothing else.
  test('picking a template places a grid with that shape', async ({ page }) => {
    await placeTemplate(page, '2 × 2');
    await expect(page.locator('.card-kind-grid')).toHaveCount(1);
    await expect(page.locator('.gridc-cell')).toHaveCount(4);
  });

  test('a different template gives a different shape', async ({ page }) => {
    await placeTemplate(page, '3 across');
    await expect(page.locator('.gridc-cell')).toHaveCount(3);
    await expect(page.locator('.gridc-divider-x')).toHaveCount(2); // two vertical lines
  });

  test('the contact sheet places nine cells', async ({ page }) => {
    await placeTemplate(page, 'Contact sheet · 3 × 3');
    await expect(page.locator('.gridc-cell')).toHaveCount(9);
  });

  // G is the escape hatch for anyone who already knows the shortcut: it places
  // the default immediately and never opens the picker.
  test('G still places the default storyboard with no panel', async ({ page }) => {
    await page.locator('.canvas-wrap').click({ position: { x: 700, y: 500 } });
    await page.keyboard.press('g');
    await expect(panel(page)).toHaveCount(0);
    await page.locator('.canvas-wrap').click({ position: { x: 520, y: 300 } });
    await expect(page.locator('.card-kind-grid')).toHaveCount(1);
    await expect(page.locator('.gridc-cell')).toHaveCount(3); // storyboard-1-2
  });

  // An armed template must not outlive the tool. Before this was wired, a shape
  // chosen minutes ago would silently come back on the next bare G.
  test('disarming the tool drops the armed template', async ({ page }) => {
    await gridTool(page).click();
    await template(page, '2 × 2').click();
    await page.keyboard.press('Escape');            // disarms the place tool

    await page.keyboard.press('g');                 // bare G → default, not 2x2
    await page.locator('.canvas-wrap').click({ position: { x: 520, y: 300 } });
    await expect(page.locator('.gridc-cell')).toHaveCount(3);
  });
});

test.describe('grid templates — applying to an existing grid', () => {
  test.beforeEach(async ({ page }) => { await gotoBlankBoard(page); });

  const selectGrid = async (page) => {
    await page.locator('.card-kind-grid').first().click({ position: { x: 180, y: 8 } });
  };

  // Same panel, opposite outcome, decided entirely by the selection — so the
  // header has to say which one is about to happen.
  test('the panel says whether it will place or replace', async ({ page }) => {
    await gridTool(page).click();
    await expect(panel(page).locator('.tplt-hint')).toContainText('click the canvas');
    await page.keyboard.press('Escape');

    await placeTemplate(page, '2 × 2');
    await selectGrid(page);
    await gridTool(page).click();
    await expect(panel(page).locator('.tplt-hint')).toContainText('Replaces');
  });

  test('applying re-cuts the selected grid in place', async ({ page }) => {
    await placeTemplate(page, '2 × 2');
    await expect(page.locator('.gridc-cell')).toHaveCount(4);

    await selectGrid(page);
    await gridTool(page).click();
    await template(page, '3 across').click();

    // Re-cut, not replaced: still ONE card, now with three cells.
    await expect(page.locator('.card-kind-grid')).toHaveCount(1);
    await expect(page.locator('.gridc-cell')).toHaveCount(3);
  });

  // The whole reason rehomeCells exists. A template's leaf ids are placeholders,
  // so applying one mints new ids — without re-homing, every filled cell would
  // be orphaned the moment somebody switched shape.
  test('cell content survives a re-cut', async ({ page }) => {
    await placeTemplate(page, 'Side by side');
    await selectGrid(page);

    // Type into the FIRST cell.
    const cell = page.locator('.gridc-cell.is-empty').first();
    await cell.hover();
    await cell.getByRole('button', RAIL('Text')).click();
    const editor = page.locator('.gridc-cell [contenteditable="true"]').first();
    await editor.click();
    await page.keyboard.type('SHOT ONE');
    await page.locator('.canvas-wrap').click({ position: { x: 60, y: 60 } });
    await expect(page.locator('.gridc-cell-text')).toHaveCount(1);

    // Grow it: 2 cells → 9. Nothing should be lost.
    await selectGrid(page);
    await gridTool(page).click();
    await template(page, 'Contact sheet · 3 × 3').click();

    await expect(page.locator('.gridc-cell')).toHaveCount(9);
    await expect(page.locator('.gridc-cell-text')).toHaveCount(1);
    await expect(page.locator('.gridc-cell-text .gc-text').first()).toHaveText('SHOT ONE');
    // ...and it stayed FIRST in reading order rather than landing anywhere.
    await expect(page.locator('.gridc-cell').first()).toHaveClass(/gridc-cell-text/);
  });

  // Shrinking can genuinely destroy content. House convention for anything
  // destructive is an undo toast that names what it cost.
  test('a lossy re-cut names the loss in an undo toast', async ({ page }) => {
    await placeTemplate(page, 'Side by side');
    await selectGrid(page);

    // Fill the SECOND cell only. Collapsing to one cell then has exactly one
    // real casualty: reading-order slot 0 survives (empty), slot 1 has nowhere
    // to go. One fill, one unambiguous number to assert.
    const cell = page.locator('.gridc-cell.is-empty').nth(1);
    await cell.hover();
    await cell.getByRole('button', RAIL('Text')).click();
    const editor = page.locator('.gridc-cell [contenteditable="true"]').first();
    await editor.click();
    await page.keyboard.type('TWO');
    await page.locator('.canvas-wrap').click({ position: { x: 60, y: 60 } });
    await expect(page.locator('.gridc-cell-text')).toHaveCount(1);

    await selectGrid(page);
    await gridTool(page).click();
    await template(page, 'Single cell').click();

    await expect(page.locator('.gridc-cell')).toHaveCount(1);
    const toast = page.locator('.toast', { hasText: 'filled cell' });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('1 filled cell removed');
    await expect(toast.getByRole('button', RAIL('Undo'))).toBeVisible();
  });

  // A clean re-cut is self-evident on screen; announcing it would be noise.
  test('a lossless re-cut stays quiet', async ({ page }) => {
    await placeTemplate(page, 'Side by side');
    await selectGrid(page);
    await gridTool(page).click();
    await template(page, 'Contact sheet · 3 × 3').click();

    await expect(page.locator('.gridc-cell')).toHaveCount(9);
    await expect(page.locator('.toast', { hasText: 'removed' })).toHaveCount(0);
  });

  // Reaching the same panel from the card, which also does the selecting.
  test('the card context menu opens the panel targeting that grid', async ({ page }) => {
    await placeTemplate(page, '2 × 2');
    await page.locator('.card-kind-grid').first().dispatchEvent('contextmenu');
    await page.locator('.ctx-menu').getByText('Apply template…', { exact: true }).click();

    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator('.tplt-hint')).toContainText('Replaces');
    await template(page, '3 across').click();
    await expect(page.locator('.card-kind-grid')).toHaveCount(1);
    await expect(page.locator('.gridc-cell')).toHaveCount(3);
  });
});

// The panel applies trees that other people authored (a teammate's saved
// template today, the public library later), so the repair path is load-bearing
// and has to be reachable from the QA bridge.
test.describe('grid templates — pure helpers via ?gridqa=1', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?gridqa=1');
    await page.waitForSelector('#root[data-gridqa-ready="1"]');
  });

  test('the bridge exposes the template helpers', async ({ page }) => {
    const kinds = await page.evaluate(() => {
      const T = window.__soleilGridTest;
      return ['instantiateLayout', 'sanitizeLayout', 'rehomeCells', 'readingOrder'].map(k => typeof T[k]);
    });
    expect(kinds).toEqual(['function', 'function', 'function', 'function']);
    const n = await page.evaluate(() => window.__soleilGridTest.BUILT_IN_LAYOUTS.length);
    expect(n).toBeGreaterThanOrEqual(5);
  });

  test('sanitizeLayout repairs junk fracs and refuses nonsense', async ({ page }) => {
    const out = await page.evaluate(() => {
      const T = window.__soleilGridTest;
      const bad = { type: 'row', children: [
        { type: 'leaf', id: 'a', frac: NaN },
        { type: 'leaf', id: 'b', frac: Infinity },
      ] };
      return {
        widths: T.computeCellRects(T.sanitizeLayout(bad), { x: 0, y: 0, w: 100, h: 100 }).map(r => Math.round(r.w)),
        nulls: [T.sanitizeLayout(null), T.sanitizeLayout('nope'), T.sanitizeLayout({ type: 'wat', children: [] })],
      };
    });
    expect(out.widths).toEqual([50, 50]);           // no NaN reaches the renderer
    expect(out.nulls).toEqual([null, null, null]);
  });

  test('instantiateLayout never reuses a template’s leaf ids', async ({ page }) => {
    const shared = await page.evaluate(() => {
      const T = window.__soleilGridTest;
      const tree = T.BUILT_IN_LAYOUTS.find(r => r.id === '2x2').tree;
      const a = T.leafIds(T.instantiateLayout(tree));
      const b = T.leafIds(T.instantiateLayout(tree));
      return { overlap: a.filter(id => b.includes(id)), count: a.length };
    });
    expect(shared.overlap).toEqual([]);
    expect(shared.count).toBe(4);
  });
});
