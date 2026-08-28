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

  // The oldest muscle memory in the app: pick the tool, tap the canvas, get a
  // grid. Opening the picker must NOT swallow that click — the panel refines
  // which shape lands, it does not gate landing one.
  test('the grid tool arms the placer and opens the picker together', async ({ page }) => {
    await gridTool(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(gridTool(page)).toHaveClass(/active/);
    await expect(gridTool(page)).toHaveAttribute('aria-expanded', 'true');

    // Ignore the panel entirely and just click: you get the default storyboard.
    await page.locator('.canvas-wrap').click({ position: { x: 600, y: 400 } });
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('.card-kind-grid')).toHaveCount(1);
    await expect(page.locator('.gridc-cell')).toHaveCount(3); // storyboard-1-2
  });

  // Clicking it a second time is a cancel, not a second arm.
  test('clicking the grid tool again disarms it', async ({ page }) => {
    await gridTool(page).click();
    await expect(panel(page)).toBeVisible();
    await gridTool(page).click();
    await expect(panel(page)).toHaveCount(0);
    await page.locator('.canvas-wrap').click({ position: { x: 600, y: 400 } });
    await expect(page.locator('.card-kind-grid')).toHaveCount(0);
  });

  // Escape is a ladder: the first press closes the picker, the second disarms
  // the tool. Collapsing both into one press would make "I just wanted to shut
  // the panel" also cancel the thing you were about to do.
  test('Escape closes the panel, then disarms the tool', async ({ page }) => {
    await gridTool(page).click();
    await expect(panel(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(gridTool(page)).toHaveClass(/active/);      // still armed

    await page.keyboard.press('Escape');
    await page.locator('.canvas-wrap').click({ position: { x: 600, y: 400 } });
    await expect(page.locator('.card-kind-grid')).toHaveCount(0);
  });

  // Search is always present now. It used to be hidden below a 12-row threshold,
  // which meant the ten built-ins never revealed it and the feature was
  // effectively invisible until you had saved several of your own.
  test('search filters the list and survives no matches', async ({ page }) => {
    await gridTool(page).click();
    const search = panel(page).getByRole('searchbox', { name: 'Search templates' });
    await expect(search).toBeVisible();

    // Search crosses every section, so "contact" finds both the bare shape and
    // the store template built on it — which is the point of having both: one
    // is geometry, the other is that geometry with a name and labels.
    await search.fill('contact');
    await expect(panel(page).getByRole('menuitem')).toHaveCount(2);
    await expect(template(page, 'Contact sheet · 3 × 3')).toBeVisible();
    await expect(template(page, 'Contact sheet template')).toBeVisible();

    await search.fill('zzzz');
    await expect(panel(page).getByRole('menuitem')).toHaveCount(0);
    await expect(panel(page).locator('.tplt-empty')).toBeVisible();

    await search.fill('');
    expect(await panel(page).getByRole('menuitem').count()).toBeGreaterThanOrEqual(10);
  });

  // Typing then Enter is the fast path, so the first match must always be the
  // one that is armed — a stale cursor after filtering would pick nothing.
  test('Enter picks the top match after filtering', async ({ page }) => {
    await gridTool(page).click();
    await panel(page).getByRole('searchbox', { name: 'Search templates' }).fill('3 across');
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    await page.locator('.canvas-wrap').click({ position: { x: 520, y: 300 } });
    await expect(page.locator('.gridc-cell')).toHaveCount(3);
    await expect(page.locator('.gridc-divider-x')).toHaveCount(2);  // 3 across, not storyboard
  });

  // This is the test that should have existed first. The previous one set a
  // 480px-tall viewport to force overflow, which made it pass while the real
  // thing was broken at every normal window size: the panel opened at the grid
  // BUTTON's y — roughly 60% down a vertically-centred rail — and its
  // max-height was measured against the viewport, so it hung 114-205px below
  // the bottom of the screen. The content still fit inside max-height, so the
  // scroll container never activated and the last rows were both invisible and
  // unreachable.
  //
  // So: a NORMAL viewport, and assert the three things that were each false.
  test('the panel fits on screen and the whole list is reachable', async ({ page }) => {
    await gridTool(page).click();
    const scroller = panel(page).locator('.tplt-scroll');
    await expect(scroller).toBeVisible();

    const geom = await panel(page).evaluate((el) => ({
      offscreenBy: Math.round(el.getBoundingClientRect().bottom - window.innerHeight),
      portaled: el.parentElement === document.body,
    }));
    expect(geom.portaled, 'must escape the rail stacking context').toBe(true);
    expect(geom.offscreenBy, 'panel must not hang below the viewport').toBeLessThanOrEqual(0);

    // With the height now clamped to real space, the built-ins genuinely overflow.
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true);

    const zoomBefore = await page.evaluate(() => document.querySelector('.canvas')?.style.transform || '');
    await scroller.hover();
    await page.mouse.wheel(0, 2000);
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // The last row is actually reachable, not merely scrolled toward.
    const lastVisible = await page.evaluate(() => {
      const scroll = document.querySelector('.tplt-scroll');
      const rows = [...document.querySelectorAll('.cnv-tpl-panel .tplt-row-wrap')];
      const lr = rows[rows.length - 1].getBoundingClientRect();
      const sr = scroll.getBoundingClientRect();
      return lr.bottom <= sr.bottom + 1 && lr.bottom <= window.innerHeight;
    });
    expect(lastVisible, 'the last template must be reachable by scrolling').toBe(true);

    // ...and the canvas underneath never zoomed, which is the other half.
    const zoomAfter = await page.evaluate(() => document.querySelector('.canvas')?.style.transform || '');
    expect(zoomAfter).toBe(zoomBefore);
  });

  // A short window has no room below the button for a usable list, so the panel
  // repositions to the top edge rather than squeezing into a sliver.
  test('a short window repositions the panel instead of shrinking it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await gridTool(page).click();
    const geom = await panel(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
    });
    expect(geom.top).toBeGreaterThanOrEqual(0);
    expect(geom.bottom).toBeLessThanOrEqual(geom.vh);
  });

  // Sections fold, because once you have your own templates the shipped set is
  // mostly in the way. The state is remembered — re-collapsing it on every open
  // would make the affordance worthless.
  test('a section folds, reports its size, and stays folded', async ({ page }) => {
    await gridTool(page).click();
    const head = panel(page).getByRole('button', { name: /^Shapes \(\d+\)$/ });
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    const before = await panel(page).getByRole('menuitem').count();
    // Store + Shapes: the panel sells the same catalogue /templates does, so
    // folding one section leaves the other standing.
    expect(before).toBeGreaterThanOrEqual(20);
    // The parens live in the aria-label; the visible count is its own span.
    const shapes = Number(await head.locator('.tplt-section-count').textContent());

    await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'false');
    await expect(panel(page).getByRole('menuitem')).toHaveCount(before - shapes);
    // Folded is not hidden: the count is what keeps a closed section informative.
    await expect(head.locator('.tplt-section-count')).toHaveText(String(shapes));

    // Reopen the panel — the fold survived.
    await page.keyboard.press('Escape');
    await gridTool(page).click();
    await expect(panel(page).getByRole('button', { name: /^Shapes/ }))
      .toHaveAttribute('aria-expanded', 'false');
  });

  // Searching must reach inside folded sections, or a match hiding behind a
  // closed header is indistinguishable from no result at all.
  test('search sees through a folded section', async ({ page }) => {
    await gridTool(page).click();
    await panel(page).getByRole('button', { name: /^Shapes/ }).click();
    // The bare shape is now behind a closed heading; its store namesake is not.
    await expect(template(page, 'Contact sheet · 3 × 3')).toHaveCount(0);

    await panel(page).getByRole('searchbox', { name: 'Search templates' }).fill('contact');
    await expect(template(page, 'Contact sheet · 3 × 3')).toBeVisible();
  });

  // The rows are a GRID, so stepping the flat index by one on ArrowDown walks
  // ACROSS a row rather than down it — the cursor visibly jumped left and right
  // instead of descending. Navigation is geometric now.
  test('ArrowDown moves down a row, not sideways', async ({ page }) => {
    await gridTool(page).click();
    const search = panel(page).getByRole('searchbox', { name: 'Search templates' });
    await search.click();

    const centreOf = () => panel(page).locator('.tplt-row-wrap.is-active').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });

    await page.keyboard.press('ArrowDown');           // seed the cursor
    const a = await centreOf();
    await page.keyboard.press('ArrowDown');
    const b = await centreOf();
    expect(b.y, 'ArrowDown must descend').toBeGreaterThan(a.y);
    expect(Math.abs(b.x - a.x), 'ArrowDown must not slide sideways').toBeLessThan(20);

    await page.keyboard.press('ArrowRight');
    const c = await centreOf();
    expect(c.x, 'ArrowRight must move right').toBeGreaterThan(b.x);
    expect(Math.abs(c.y - b.y), 'ArrowRight must stay on its row').toBeLessThan(20);
  });

  // A long template name used to widen its own `1fr` track — measured, a
  // 54-character name took the 290px list to 457px — which gave .tplt-scroll a
  // horizontal overflow. Merely moving the cursor onto a tile then scrolled that
  // overflow and the whole list slid sideways under the fixed head.
  //
  // Asserted on the CONTAINER, not on the name's own styles: `text-overflow`,
  // `line-clamp` and `min-width` are three ways to spell the same intent and any
  // of them is fine, but a list that can scroll sideways never is.
  test('a long template name cannot widen the list', async ({ page }) => {
    await gridTool(page).click();
    await expect(panel(page)).toBeVisible();

    const m = await panel(page).evaluate((root) => {
      const scroll = root.querySelector('.tplt-scroll');
      const narrow = scroll.querySelector('[data-row-index]').clientWidth;
      root.querySelectorAll('.tplt-name').forEach((n, i) => {
        // Real words, plus one unbroken token — only the latter exercises
        // min-content width, which is what actually sizes the track.
        n.textContent = i === 1
          ? 'a'.repeat(70)
          : `Feature film storyboard master sequence ${i} with alternates`;
      });
      return {
        narrow,
        wide: scroll.querySelector('[data-row-index]').clientWidth,
        overflowX: scroll.scrollWidth - scroll.clientWidth,
        // Two lines of an 11px/1.3 face is ~29px; three would be ~43px.
        tallestName: Math.max(...[...root.querySelectorAll('.tplt-name')]
          .map((n) => n.getBoundingClientRect().height)),
      };
    });

    expect(m.overflowX, 'the template list must never scroll sideways').toBe(0);
    expect(m.wide, 'a long name must not widen its column').toBe(m.narrow);
    expect(m.tallestName, 'the name is clamped to two lines').toBeLessThan(36);
  });

  // Belt and braces on the same bug from the other side. scrollIntoView moves
  // BOTH axes and will scroll an `overflow-x: hidden` box quite happily — hidden
  // clips painting, it does not make a box unscrollable. Force the overflow that
  // a long name used to cause, then drive the cursor and prove nothing moves
  // horizontally while vertical scrolling still works.
  test('moving the cursor never scrolls the list sideways', async ({ page }) => {
    await gridTool(page).click();
    await expect(panel(page)).toBeVisible();
    await page.addStyleTag({ content: '.tplt-rows { width: 900px !important; }' });

    const scrollPos = () => panel(page).locator('.tplt-scroll')
      .evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));

    await panel(page).getByRole('searchbox', { name: 'Search templates' }).click();
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('ArrowDown');
      expect((await scrollPos()).left, 'no sideways scroll').toBe(0);
    }
    await page.keyboard.press('ArrowRight');
    expect((await scrollPos()).left, 'ArrowRight moves the cursor, not the list').toBe(0);
    // The vertical half must still work, or "never scrolls" is trivially true.
    expect((await scrollPos()).top, 'the last row was scrolled into view').toBeGreaterThan(0);
  });

  // A hint says how a box is meant to be filled, so it belongs on every panel
  // stamped off the source — a row of six storyboard frames where only the first
  // is labelled is a row of five unlabelled frames. Hints ride in gridMeta and
  // were simply not in the list of what a stamp carried.
  //
  // Uses the DEV-only __soleilGridLive bridge because the Templates panel is the
  // only way to author hints and local mode lists built-ins only, none of which
  // carry any.
  test('stamping a neighbour carries the cell hints across', async ({ page }) => {
    await page.evaluate(() => window.__soleilGridLive.addHintedGrid(
      { x: 420, y: 300 }, ['WIDE SHOT', 'ACTION', 'INSERT'],
    ));
    const grids = page.locator('.card-kind-grid');
    await expect(grids).toHaveCount(1);
    await expect(page.locator('.gridc-hint')).toHaveCount(3);

    await grids.first().click({ position: { x: 180, y: 8 } });
    await expect(grids.first()).toHaveClass(/is-selected/);
    await page.getByRole('button', { name: 'Stamp a Grid right' }).click();
    await expect(grids).toHaveCount(2);

    // Both grids, three cells each — the copy is labelled exactly like its source.
    await expect(page.locator('.gridc-hint')).toHaveCount(6);
    const texts = await page.locator('.gridc-hint').allTextContents();
    expect(texts.filter((t) => t === 'WIDE SHOT')).toHaveLength(2);
    expect(texts.filter((t) => t === 'ACTION')).toHaveLength(2);
    expect(texts.filter((t) => t === 'INSERT')).toHaveLength(2);
  });

  // A hint is not content, so it must not survive as text in the copy — it has
  // to still vanish the moment its cell is filled, exactly as on the source.
  test('a carried hint still disappears when its cell is filled', async ({ page }) => {
    await page.evaluate(() => window.__soleilGridLive.addHintedGrid(
      { x: 420, y: 300 }, ['WIDE SHOT', 'ACTION', 'INSERT'],
    ));
    const grids = page.locator('.card-kind-grid');
    await grids.first().click({ position: { x: 180, y: 8 } });
    await page.getByRole('button', { name: 'Stamp a Grid right' }).click();
    await expect(grids).toHaveCount(2);

    // Fill one cell of the STAMPED grid (the right-hand one).
    const xs = await grids.evaluateAll((els) => els.map((e, i) => ({ i, x: e.getBoundingClientRect().x })));
    xs.sort((a, b) => a.x - b.x);
    const copy = grids.nth(xs[1].i);
    const cell = copy.locator('.gridc-cell.is-empty').first();
    await cell.hover();
    await cell.getByRole('button', { name: 'Text', exact: true }).click();
    const editor = copy.locator('[contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible' });
    await editor.click();
    await page.keyboard.type('he walks in');
    await editor.evaluate((el) => el.blur());
    await page.locator('.canvas-wrap').click({ position: { x: 40, y: 40 } });

    // Five left: the filled cell's hint is gone, its five siblings remain.
    await expect(page.locator('.gridc-hint')).toHaveCount(5);
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
  // G arms without opening the picker — the shortcut is for people who already
  // know what they want.
  test('G arms the default storyboard with no panel', async ({ page }) => {
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
    await expect(panel(page).locator('.tplt-hint')).toContainText('Click the canvas');
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

  // Saving lives on the card too, not just in the panel footer. Under ?local=1
  // there is no backend, so the entry is absent rather than present-and-broken
  // — which is also what this asserts: the menu must not offer an action that
  // cannot work.
  test('save-as-template is absent without a backend', async ({ page }) => {
    await placeTemplate(page, '2 × 2');
    await page.locator('.card-kind-grid').first().dispatchEvent('contextmenu');
    await expect(page.locator('.ctx-menu')).toBeVisible();
    await expect(page.locator('.ctx-menu').getByText('Apply template…', { exact: true })).toBeVisible();
    await expect(page.locator('.ctx-menu').getByText('Save as template…', { exact: true })).toHaveCount(0);
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

  // Cell hints are stored by reading-order INDEX and only become cell ids once
  // the tree is instantiated. That translation is the seam most likely to break
  // silently — a hint landing on the wrong box looks like nothing at all.
  test('hints map to cells by reading order, after instantiation', async ({ page }) => {
    const out = await page.evaluate(() => {
      const T = window.__soleilGridTest;
      // 2x2 is stored column-major, so an id-order scheme would put TR
      // bottom-left. Reading order is what a person means by "box 2".
      const tree = T.instantiateLayout(T.BUILT_IN_LAYOUTS.find(r => r.id === '2x2').tree);
      const box = { x: 0, y: 0, w: 100, h: 100 };
      const order = T.readingOrder(T.computeCellRects(tree, box));
      const map = T.hintsToCellMap(tree, ['TL', 'TR', 'BL', 'BR'], box);
      return { byOrder: order.map(id => map[id]), count: Object.keys(map).length };
    });
    expect(out.byOrder).toEqual(['TL', 'TR', 'BL', 'BR']);
    expect(out.count).toBe(4);
  });

  test('hints are bounded and stripped before they can be stored', async ({ page }) => {
    const out = await page.evaluate(() => {
      const T = window.__soleilGridTest;
      return {
        markup: T.sanitizeHints(['<b>WIDE</b>']),
        allBlank: T.sanitizeHints(['', '   ']),
        tooLong: T.sanitizeHints(['x'.repeat(80)])[0].length,
        capped: T.sanitizeHints(Array.from({ length: 200 }, () => 'h')).length,
      };
    });
    expect(out.markup).toEqual(['WIDE']);
    expect(out.allBlank).toBe(null);      // nothing to say → no hints at all
    expect(out.tooLong).toBe(40);
    expect(out.capped).toBe(64);
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
