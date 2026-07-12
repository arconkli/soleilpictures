import { expect, test } from '@playwright/test';

// Grids — live interaction in the local (?local=1) harness. Verifies the P2
// wiring end to end with REAL input: add a Grid via the canvas right-click menu,
// select it, drag a divider (the shared-edge resize), and fill an empty cell
// with text via the chooser. The pure layout/sequence math is covered separately
// by grids.spec.js (?gridqa=1).

async function addGrid(page) {
  const canvas = page.locator('.canvas-wrap');
  await canvas.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: rect.left + 520, clientY: rect.top + 150,
    }));
  });
  const menu = page.locator('.ctx-menu').first();
  await expect(menu).toBeVisible();
  await menu.locator('.ctx-submenu-wrap', { hasText: 'Add' }).hover();
  await page.locator('.ctx-submenu').getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.locator('.gridc-cell')).toHaveCount(3);
}

test.describe('grids — local interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?local=1&reset=1&blank=1');
    await page.waitForSelector('.canvas-wrap');
  });

  test('add a Grid, select it, and drag a divider to resize adjacent cells', async ({ page }) => {
    await addGrid(page);
    const grid = page.locator('.card-kind-grid').first();
    // Select by clicking the (empty) top cell near its top edge, away from the
    // centered chooser buttons.
    await grid.click({ position: { x: 180, y: 8 } });
    await expect(grid).toHaveClass(/is-selected/);

    // The bottom row's vertical divider becomes grabbable once selected.
    const divider = page.locator('.gridc-divider-x.is-grabbable').first();
    await expect(divider).toBeVisible();

    const bottomLeft = page.locator('.gridc-cell').nth(1);
    const beforeBox = await bottomLeft.boundingBox();
    const db = await divider.boundingBox();
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
    await page.mouse.down();
    await page.mouse.move(db.x - 70, db.y + db.height / 2, { steps: 6 });
    await page.mouse.up();

    const afterBox = await bottomLeft.boundingBox();
    expect(afterBox.width).toBeLessThan(beforeBox.width - 30);
  });

  test('linked Grids reflow together — global sync + unlink round-trip', async ({ page }) => {
    await addGrid(page);
    const first = page.locator('.card-kind-grid').first();
    await first.click({ position: { x: 180, y: 8 } });
    await expect(first).toHaveClass(/is-selected/);

    // Share layout → this Grid becomes linked to a shared template.
    await first.dispatchEvent('contextmenu');
    await page.locator('.ctx-menu').getByText('Share layout', { exact: true }).click();
    await expect(first.locator('.gridc-linked-badge')).toBeVisible();

    // Duplicate → a second Grid linked to the SAME template.
    await first.dispatchEvent('contextmenu');
    await page.locator('.ctx-menu').getByText('Duplicate', { exact: true }).click();
    await expect(page.locator('.card-kind-grid')).toHaveCount(2);

    const cellOf = (n) => page.locator('.card-kind-grid').nth(n).locator('.gridc-cell').nth(1);
    const before0 = await cellOf(0).boundingBox();
    const before1 = await cellOf(1).boundingBox();

    // Drag the (selected duplicate's) grabbable bottom divider left.
    const divider = page.locator('.gridc-divider-x.is-grabbable').first();
    const db = await divider.boundingBox();
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
    await page.mouse.down();
    await page.mouse.move(db.x - 70, db.y + db.height / 2, { steps: 6 });
    await page.mouse.up();

    // BOTH linked Grids reflow (they read the same shared template layout).
    const after0 = await cellOf(0).boundingBox();
    const after1 = await cellOf(1).boundingBox();
    expect(after0.width).toBeLessThan(before0.width - 30);
    expect(after1.width).toBeLessThan(before1.width - 30);

    // Unlink the duplicate → it keeps the (resized) layout independently.
    const dupe = page.locator('.card-kind-grid').nth(1);
    await dupe.dispatchEvent('contextmenu');
    await page.locator('.ctx-menu').getByText('Unlink layout', { exact: true }).click();
    await expect(dupe.locator('.gridc-linked-badge')).toHaveCount(0);
    const afterUnlink = await cellOf(1).boundingBox();
    expect(Math.abs(afterUnlink.width - after1.width)).toBeLessThan(4);
  });

  // Add a "[#]" tag to the bottom-left cell of the (selected) Grid.
  async function tagBottomCell(page) {
    const cell = page.locator('.gridc-cell.is-empty').nth(1); // bottom-left
    await cell.hover();
    await cell.getByRole('button', { name: 'Text', exact: true }).click();
    const editor = page.locator('.gridc-cell [contenteditable="true"]').first();
    await editor.click();
    await page.keyboard.type('[#]');
    await page.locator('.canvas-wrap').click({ position: { x: 60, y: 60 } });
  }

  test('directional + stamps a numbered neighbor (auto-sequence)', async ({ page }) => {
    await addGrid(page);
    const grid = page.locator('.card-kind-grid').first();
    await grid.click({ position: { x: 180, y: 8 } });
    await tagBottomCell(page);
    // Re-select (the blur click cleared selection) and stamp to the right.
    await grid.click({ position: { x: 180, y: 8 } });
    await grid.hover();
    await page.locator('.gridc-add-right').first().click();

    await expect(page.locator('.card-kind-grid')).toHaveCount(2);
    // Both Grids share the layout + sequence; their [#] cells resolve to 1 and 2.
    const texts = page.locator('.card-kind-grid .gridc-cell-text .gc-text');
    await expect(texts.nth(0)).toHaveText('1');
    await expect(texts.nth(1)).toHaveText('2');
  });

  test('bulk matrix generates a numbered sequence', async ({ page }) => {
    await addGrid(page);
    const grid = page.locator('.card-kind-grid').first();
    await grid.click({ position: { x: 180, y: 8 } });
    await tagBottomCell(page);
    await grid.click({ position: { x: 180, y: 8 } });

    // Generate a 3 x 1 matrix from this Grid.
    await grid.dispatchEvent('contextmenu');
    await page.locator('.ctx-menu').getByText('Generate matrix…', { exact: true }).click();
    await page.locator('.modal input, .modal textarea, [role="dialog"] input').first().fill('3 x 1');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();

    await expect(page.locator('.card-kind-grid')).toHaveCount(3);
    const nums = await page.locator('.card-kind-grid .gridc-cell-text .gc-text').allInnerTexts();
    expect(nums.map((s) => s.trim()).sort()).toEqual(['1', '2', '3']);
  });

  async function makeMatrix(page, cols, rows) {
    const grid = page.locator('.card-kind-grid').first();
    await grid.click({ position: { x: 60, y: 8 } }); // select
    const ctl = page.locator('.grid-matrix-ctl');
    await expect(ctl).toBeVisible();
    await ctl.locator('input').nth(0).fill(String(cols));
    await ctl.locator('input').nth(1).fill(String(rows));
    await ctl.getByRole('button', { name: 'Make grid' }).click();
    await expect(page.locator('.card-kind-grid')).toHaveCount(cols * rows);
  }

  test('the inline control makes a flush, connected matrix', async ({ page }) => {
    await addGrid(page);
    await makeMatrix(page, 4, 3); // 12 grids
    const boxes = await page.locator('.card-kind-grid').evaluateAll((els) => els.map((e) => {
      const b = e.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    }));
    const w0 = boxes[0].w, h0 = boxes[0].h;
    // every grid is the same size
    expect(boxes.every((b) => Math.abs(b.w - w0) < 2 && Math.abs(b.h - h0) < 2)).toBe(true);
    // flush: some grid's left edge == another's right edge on the same row (touching)
    const touching = boxes.some((a) => boxes.some((b) => a !== b && Math.abs(a.x - (b.x + b.w)) < 2 && Math.abs(a.y - b.y) < 2));
    expect(touching).toBe(true);
  });

  test('resizing one grid in a connected matrix resizes + re-tiles all', async ({ page }) => {
    await addGrid(page);
    await makeMatrix(page, 3, 1); // horizontal strip
    const geom = () => page.locator('.card-kind-grid').evaluateAll((els) => els.map((e) => ({
      x: Math.round(parseFloat(e.style.left)), w: Math.round(parseFloat(e.style.width)),
    })));
    const before = await geom();
    // resize the rightmost grid (last in DOM) — select via a spot clear of the
    // top-left "Linked" badge / edge "+" / cell toolbar, then drag its handle.
    const last = page.locator('.card-kind-grid').last();
    await last.click({ position: { x: 270, y: 45 } });
    const hb = await last.locator('.card-resize').boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 90, hb.y + 50, { steps: 6 });
    await page.mouse.up();
    const after = await geom();
    const widths = after.map((g) => g.w);
    expect(new Set(widths).size).toBe(1);              // all the SAME width now
    expect(widths[0]).toBeGreaterThan(before[0].w + 30); // and bigger
    // flush: sorted by x, each starts where the previous ended
    const sorted = [...after].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) expect(Math.abs(sorted[i].x - (sorted[i - 1].x + sorted[i - 1].w))).toBeLessThan(2);
  });

  test('fill an empty cell with text via the chooser', async ({ page }) => {
    await addGrid(page);
    const grid = page.locator('.card-kind-grid').first();
    await grid.click({ position: { x: 180, y: 8 } });

    const cell = page.locator('.gridc-cell.is-empty').first();
    await cell.hover();
    await cell.getByRole('button', { name: 'Text', exact: true }).click();

    const editor = page.locator('.gridc-cell [contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible' });
    await editor.click();
    await page.keyboard.type('Shot 1 action');
    await expect(editor).toContainText('Shot 1 action');

    // Blur the editor → it commits the html; the read-only body then renders.
    await editor.evaluate((el) => el.blur());
    await page.locator('.canvas-wrap').click({ position: { x: 60, y: 60 } });
    await expect(page.locator('.gridc-cell-text .gc-text')).toContainText('Shot 1 action');
  });

  test('re-entering a text cell keeps its text and shows the format toolbar', async ({ page }) => {
    await addGrid(page);
    const grid = page.locator('.card-kind-grid').first();
    await grid.click({ position: { x: 180, y: 8 } });

    // Create a text cell with content, then commit it (read-only body renders).
    const empty = page.locator('.gridc-cell.is-empty').first();
    await empty.hover();
    await empty.getByRole('button', { name: 'Text', exact: true }).click();
    const editor = page.locator('.gridc-cell [contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible' });
    await editor.click();
    await page.keyboard.type('Keep me');
    await editor.evaluate((el) => el.blur());
    await page.locator('.canvas-wrap').click({ position: { x: 60, y: 60 } });
    await expect(grid.locator('.gridc-cell-text .gc-text')).toContainText('Keep me');

    // Double-click back into the cell. Regression: the editor used to mount BLANK
    // (autoFocus skipped the DOM seed), so the saved text vanished and typing
    // overwrote it. It must now show the saved text, and the bottom formatting
    // toolbar must appear scoped to the cell (no card-only "Card background").
    await grid.locator('.gridc-cell-text').first().dblclick();
    const reEditor = page.locator('.gridc-cell [contenteditable="true"]').first();
    await reEditor.waitFor({ state: 'visible' });
    await expect(reEditor).toContainText('Keep me');
    await expect(page.locator('.tob')).toBeVisible();
    await expect(page.locator('.tob [title="Bold (⌘B)"]')).toHaveCount(1);
    await expect(page.locator('.tob [title="Card background"]')).toHaveCount(0);
    // The cell-scoped background control (rides the shared/pinned style path).
    await expect(page.locator('.tob [title="Box background"]')).toHaveCount(1);
  });

  test('select a box (single click) surfaces the scope control; "This box" is remembered per grid', async ({ page }) => {
    await addGrid(page);
    const grid = page.locator('.card-kind-grid').first();
    await grid.click({ position: { x: 180, y: 8 } });

    // Commit a text cell so we have a filled, read-only box to select.
    const empty = page.locator('.gridc-cell.is-empty').first();
    await empty.hover();
    await empty.getByRole('button', { name: 'Text', exact: true }).click();
    const editor = page.locator('.gridc-cell [contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible' });
    await editor.click();
    await page.keyboard.type('Shot A');
    await editor.evaluate((el) => el.blur());
    await page.locator('.canvas-wrap').click({ position: { x: 60, y: 60 } });
    const roCell = grid.locator('.gridc-cell-text').first();
    await expect(roCell.locator('.gc-text')).toContainText('Shot A');

    // SINGLE click the box (no double-click into text) → the style bar appears with
    // the segmented scope control, defaulting to "All boxes" (shared). Emphasis
    // (needs a live editor) is hidden; Box background is available for the box.
    await roCell.click();
    const scope = page.locator('.tob-scope');
    await expect(scope).toBeVisible();
    await expect(scope.getByRole('button', { name: 'All boxes' })).toHaveAttribute('aria-pressed', 'true');
    await expect(scope.getByRole('button', { name: 'This box' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.tob [title="Bold (⌘B)"]')).toHaveCount(0);
    await expect(page.locator('.tob [title="Box background"]')).toHaveCount(1);

    // Choose "This box" → isolates this box (pins its style) and flips the segment.
    await scope.getByRole('button', { name: 'This box' }).click();
    await expect(scope.getByRole('button', { name: 'This box' })).toHaveAttribute('aria-pressed', 'true');

    // The choice is remembered for this grid: selecting ANOTHER (still-empty) box
    // in the same grid pre-selects "This box" so per-box edits stay one click.
    const sibling = page.locator('.gridc-cell.is-empty').first();
    await sibling.click();
    await expect(page.locator('.tob-scope').getByRole('button', { name: 'This box' }))
      .toHaveAttribute('aria-pressed', 'true');

    // The box style bar is a Select-tool affordance: switching to another tool must
    // release it (else it would hijack that tool's options bar).
    await page.keyboard.press('d');   // → Draw tool
    await expect(page.locator('.tob-scope')).toHaveCount(0);
    await page.keyboard.press('v');   // back to Select
  });

  test('Box background paints a text cell with readable ink and reverts on No background', async ({ page }) => {
    await addGrid(page);
    const grid = page.locator('.card-kind-grid').first();
    await grid.click({ position: { x: 180, y: 8 } });

    // Make a text cell and keep its editor open (the toolbar is cell-scoped).
    const cell = page.locator('.gridc-cell.is-empty').first();
    await cell.hover();
    await cell.getByRole('button', { name: 'Text', exact: true }).click();
    const editor = page.locator('.gridc-cell [contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible' });
    await editor.click();
    await page.keyboard.type('painted cell');

    // Pick a color swatch (first non-transparent, non-custom one in the popover)
    // → the editing surface paints and the ink adjusts.
    await page.getByTitle('Box background').click();
    await page.locator('.tob-pop .tob-sw:not(.tob-sw-custom):not([title="No background"])').first().click();
    const editWrap = page.locator('.gridc-cell .gc-text-edit').first();
    await expect.poll(() => editWrap.evaluate((el) => el.style.background)).not.toBe('');

    // Commit → the read-only body keeps the painted surface.
    await editor.evaluate((el) => el.blur());
    await page.locator('.canvas-wrap').click({ position: { x: 60, y: 60 } });
    const roText = grid.locator('.gridc-cell-text .gc-text').first();
    const painted = await roText.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(painted).not.toBe('rgba(0, 0, 0, 0)');
    // Ink contrasts with the surface (readableOn/readableInk applied).
    const ink = await roText.evaluate((el) => getComputedStyle(el).color);
    expect(ink).not.toBe(painted);

    // Re-enter and revert via "No background" → back to the default surface.
    await grid.locator('.gridc-cell-text').first().dblclick();
    await page.locator('.gridc-cell [contenteditable="true"]').first().waitFor();
    await page.getByTitle('Box background').click();
    await page.getByTitle('No background').click();
    await expect.poll(() => page.locator('.gridc-cell .gc-text-edit').first()
      .evaluate((el) => el.style.background)).toBe('');
  });

  test('split buttons respond to REAL pointer clicks (fresh unfocused cell)', async ({ page }) => {
    await addGrid(page);
    // No prior focus on the cell: the first press used to trigger a focus
    // re-render that remounted the inline pill mid-click and ate the event.
    const cell = page.locator('.gridc-cell').nth(1);
    await cell.hover();
    await cell.getByTitle('Add a vertical line (split into columns)').click();
    await expect(page.locator('.gridc-cell')).toHaveCount(4);
    // And again on another fresh cell, splitting into rows.
    const top = page.locator('.gridc-cell').first();
    await top.hover();
    await top.getByTitle('Add a horizontal line (split into rows)').click();
    await expect(page.locator('.gridc-cell')).toHaveCount(5);
  });

  // Click a cell to focus it, then paste — the cell auto-formats by clipboard type.
  async function pasteInto(page, text) {
    await page.evaluate((t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
  }

  test('paste text into a focused cell formats it as text', async ({ page }) => {
    await addGrid(page);
    const grid = page.locator('.card-kind-grid').first();
    // click an empty cell to focus it (the paste target)
    const cell = page.locator('.gridc-cell.is-empty').nth(1);
    await cell.click({ position: { x: 20, y: 8 } });
    await expect(page.locator('.gridc-cell.is-focused')).toHaveCount(1);
    await pasteInto(page, 'Pasted shot note');
    await expect(grid.locator('.gridc-cell-text .gc-text')).toContainText('Pasted shot note');
  });

  test('paste a URL into a focused cell formats it as a link', async ({ page }) => {
    await addGrid(page);
    const grid = page.locator('.card-kind-grid').first();
    const cell = page.locator('.gridc-cell.is-empty').first();
    await cell.click({ position: { x: 30, y: 8 } });
    await expect(page.locator('.gridc-cell.is-focused')).toHaveCount(1);
    await pasteInto(page, 'https://example.com');
    const link = grid.locator('.gridc-cell-link .gc-link');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('href', 'https://example.com');
  });

  // Place a Grid centered near a screen point via the right-click "Add › Grid"
  // (the cursor position is where it drops), mirroring addGrid so it stays robust
  // to the right-click menu reorganization.
  async function placeGridAt(page, sx, sy) {
    await page.locator('.canvas-wrap').evaluate((node, p) => {
      const rect = node.getBoundingClientRect();
      node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + p.x, clientY: rect.top + p.y }));
    }, { x: sx, y: sy });
    const menu = page.locator('.ctx-menu').first();
    await menu.locator('.ctx-submenu-wrap', { hasText: 'Add' }).hover();
    await page.locator('.ctx-submenu').getByRole('button', { name: 'Grid', exact: true }).click();
  }

  test('cell focus clears when its grid is deleted (paste not swallowed)', async ({ page }) => {
    await addGrid(page);
    const grid = page.locator('.card-kind-grid').first();
    // click a cell → focuses it AND selects the grid
    await grid.locator('.gridc-cell').nth(1).click({ position: { x: 20, y: 8 } });
    await expect(page.locator('.gridc-cell.is-focused')).toHaveCount(1);
    await page.keyboard.press('Delete');
    await expect(page.locator('.card-kind-grid')).toHaveCount(0);
    await expect(page.locator('.gridc-cell.is-focused')).toHaveCount(0);
    // the stale focus is gone → a paste now lands on the canvas (a note), not nowhere
    await pasteInto(page, 'after delete');
    await expect(page.locator('.card-kind-note')).toHaveCount(1);
  });

  test('drag a grid into a cell grafts it inline (nested, source consumed)', async ({ page }) => {
    await placeGridAt(page, 320, 300);  // grid A (left)
    await placeGridAt(page, 760, 300);  // grid B (right)
    await expect(page.locator('.card-kind-grid')).toHaveCount(2);
    // resolve A (leftmost) and B (rightmost) by x
    const grids = page.locator('.card-kind-grid');
    const xs = await grids.evaluateAll((els) => els.map((e, i) => ({ i, x: e.getBoundingClientRect().x })));
    xs.sort((a, b) => a.x - b.x);
    const A = grids.nth(xs[0].i), B = grids.nth(xs[1].i);
    const aBox = await A.boundingBox(), bBox = await B.boundingBox();
    // drag B (grab top-left, clear of the centered chooser) onto A's bottom-right cell
    await page.mouse.move(bBox.x + 40, bBox.y + 24);
    await page.mouse.down();
    await page.mouse.move(aBox.x + aBox.width - 60, aBox.y + aBox.height - 60, { steps: 12 });
    await page.mouse.up();
    // B is consumed; A absorbed B's 3-cell layout into one cell → 3 - 1 + 3 = 5 cells
    await expect(page.locator('.card-kind-grid')).toHaveCount(1);
    await expect(page.locator('.card-kind-grid .gridc-cell')).toHaveCount(5);
  });

  // Fill a grid's first empty cell with a text caption, committing it (read body renders).
  async function addTextToCell(page, gridLoc, text) {
    const cell = gridLoc.locator('.gridc-cell.is-empty').first();
    await cell.hover();
    await cell.getByRole('button', { name: 'Text', exact: true }).click();
    const editor = gridLoc.locator('[contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible' });
    await editor.click();
    await page.keyboard.type(text);
    await editor.evaluate((el) => el.blur());
    await page.locator('.canvas-wrap').click({ position: { x: 40, y: 40 } });
  }
  const cellFontPx = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

  test('linked family shares text style live; a pinned box stays put; center works', async ({ page }) => {
    await addGrid(page);
    const gridA = page.locator('.card-kind-grid').first();
    await gridA.click({ position: { x: 180, y: 8 } });
    await expect(gridA).toHaveClass(/is-selected/);
    await page.getByRole('button', { name: 'Stamp a Grid right' }).click();
    await expect(page.locator('.card-kind-grid')).toHaveCount(2);
    // Resolve A (left) and B (right) by x so DOM order can't flake the test.
    const grids = page.locator('.card-kind-grid');
    const xs = await grids.evaluateAll((els) => els.map((e, i) => ({ i, x: e.getBoundingClientRect().x })));
    xs.sort((a, b) => a.x - b.x);
    const A = grids.nth(xs[0].i), B = grids.nth(xs[1].i);
    await addTextToCell(page, A, 'A');
    await addTextToCell(page, B, 'B');

    const bText = B.locator('.gridc-cell-text .gc-text').first();
    const before = await cellFontPx(bText);

    // Edit A's caption and bump the SHARED font size → B (un-pinned) follows live.
    await A.locator('.gridc-cell-text').first().dblclick();
    await expect(page.locator('.tob')).toBeVisible();
    await page.locator('.tob [aria-label="Increase font size"]').click();
    await page.locator('.tob [aria-label="Increase font size"]').click();
    await page.locator('.canvas-wrap').click({ position: { x: 40, y: 40 } });
    const afterShared = await cellFontPx(bText);
    expect(afterShared).toBeGreaterThan(before);

    // Center A's caption → the shared vAlign makes B's box flex-center too.
    await A.locator('.gridc-cell-text').first().dblclick();
    await page.locator('.tob button[title="Center — put the text dead-center of the box"]').click();
    await page.locator('.canvas-wrap').click({ position: { x: 40, y: 40 } });
    await expect(bText).toHaveCSS('justify-content', 'center');

    // Pin B ("only this box"), then change the shared style again → B must NOT move.
    await B.locator('.gridc-cell-text').first().dblclick();
    const scope = page.locator('.tob .tob-scope');
    await scope.getByRole('button', { name: 'This box' }).click();   // All boxes → This box
    await expect(scope.getByRole('button', { name: 'This box' })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.canvas-wrap').click({ position: { x: 40, y: 40 } });
    const bPinned = await cellFontPx(bText);
    await A.locator('.gridc-cell-text').first().dblclick();
    await page.locator('.tob [aria-label="Increase font size"]').click();
    await page.locator('.canvas-wrap').click({ position: { x: 40, y: 40 } });
    expect(await cellFontPx(bText)).toBe(bPinned);             // pinned box ignored the shared change
  });

  test('double-tap an empty cell turns it into a note', async ({ page }) => {
    await addGrid(page);
    const grid = page.locator('.card-kind-grid').first();
    // Double-tap the big top cell (away from the centered chooser) → instant note.
    await grid.locator('.gridc-cell.is-empty').first().dblclick({ position: { x: 40, y: 30 } });
    const editor = grid.locator('.gridc-cell [contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible' });
    await editor.click();
    await page.keyboard.type('Quick note');
    await editor.evaluate((el) => el.blur());
    await page.locator('.canvas-wrap').click({ position: { x: 40, y: 40 } });
    await expect(grid.locator('.gridc-cell-text .gc-text')).toContainText('Quick note');
  });

  test('Replace swaps a filled cell to another content type in place', async ({ page }) => {
    await addGrid(page);
    const grid = page.locator('.card-kind-grid').first();
    // Make a text cell (double-tap → note), commit it.
    await grid.locator('.gridc-cell.is-empty').first().dblclick({ position: { x: 40, y: 30 } });
    const editor = grid.locator('.gridc-cell [contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible' });
    await editor.click();
    await page.keyboard.type('caption');
    await editor.evaluate((el) => el.blur());
    await page.locator('.canvas-wrap').click({ position: { x: 40, y: 40 } });
    const cell = grid.locator('.gridc-cell-text').first();
    await expect(cell.locator('.gc-text')).toContainText('caption');

    // At rest a filled cell shows "Replace", NOT the chooser.
    await cell.hover();
    await expect(cell.getByRole('button', { name: 'Replace' })).toBeVisible();
    await expect(cell.getByRole('button', { name: 'Text', exact: true })).toHaveCount(0);
    // Click Replace → the Text/Image/Link chooser appears on this filled cell.
    await cell.getByRole('button', { name: 'Replace' }).click();
    await expect(cell.getByRole('button', { name: 'Image', exact: true })).toBeVisible();
    // Swap to a Link → fill the in-app URL dialog → same cell becomes a link.
    await cell.getByRole('button', { name: 'Link', exact: true }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('textbox').first().fill('https://example.com');
    await dlg.getByRole('button', { name: 'Add' }).click();
    await expect(grid.locator('.gridc-cell-link .gc-link')).toHaveCount(1);
  });

  // Split a 180px bottom cell into columns → two ~90px cells (below
  // GRID_TUNING.PILL_MIN_W=172) → those cells swap the inline pill for a compact
  // trigger that opens a portaled full-size menu with every option.
  async function makeCompactCell(page) {
    // Split the 180×150 bottom-left cell into columns → two ~90px cells (below
    // GRID_TUNING.PILL_MIN_W=172). Real hover + click on the pill button — this
    // used to need a programmatic el.click() workaround, which was actually
    // masking a bug: the first press re-rendered the cell (focusCell) and the
    // inline pill (an inline component back then) remounted mid-click.
    const cell = page.locator('.gridc-cell').nth(1);
    await cell.hover();
    await cell.getByTitle('Add a vertical line (split into columns)').click();
    const mini = page.locator('.gridc-cell .gridc-pill-mini').first();
    await expect(mini).toBeVisible();
    return mini;
  }

  test('a too-small cell uses the pop-out menu for every insert option', async ({ page }) => {
    await addGrid(page);
    const mini = await makeCompactCell(page);

    // The compact cell has NO inline chooser (it moved to the pop-out).
    const compactCell = page.locator('.gridc-cell', { has: page.locator('.gridc-pill-mini') }).first();
    await expect(compactCell.getByRole('button', { name: 'Text', exact: true })).toHaveCount(0);

    // Open the portaled menu — it lives at <body>, escaping the .gridc clip.
    await mini.click();
    const menu = page.locator('.gridc-cell-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Text', exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Image', exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Link', exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Split into columns' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Split into rows' })).toBeVisible();
    // The menu is NOT inside the grid card (it's portaled to <body>).
    await expect(page.locator('.card-kind-grid .gridc-cell-menu')).toHaveCount(0);

    // Pick Text → the (tiny) cell mounts the editor, and the menu closes.
    await menu.getByRole('button', { name: 'Text', exact: true }).click();
    await expect(page.locator('.gridc-cell [contenteditable="true"]').first()).toBeVisible();
    await expect(menu).toHaveCount(0);
  });

  test('the cell pop-out menu dismisses on Escape and outside-tap', async ({ page }) => {
    await addGrid(page);
    const mini = await makeCompactCell(page);

    await mini.click();
    await expect(page.locator('.gridc-cell-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.gridc-cell-menu')).toHaveCount(0);

    await mini.click();
    await expect(page.locator('.gridc-cell-menu')).toBeVisible();
    await page.mouse.click(24, 24); // far from the menu
    await expect(page.locator('.gridc-cell-menu')).toHaveCount(0);
  });
});
