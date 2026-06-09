import { expect, test } from '@playwright/test';

test('default route keeps the sign-in interface intact', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.auth-eyebrow')).toContainText('SOLEIL PICTURES');
  await expect(page.getByPlaceholder('you@soleilpictures.com')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send magic link' })).toBeDisabled();
});

test('stale magic-link URLs are cleared without poisoning the auth session', async ({ page }) => {
  let userRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/auth/v1/user')) userRequests += 1;
  });

  await page.goto('/#access_token=expired-token&refresh_token=expired-refresh&expires_at=1&expires_in=3600&token_type=bearer&type=magiclink');

  await expect(page.locator('.auth-eyebrow')).toContainText('SOLEIL PICTURES');
  await expect(page).toHaveURL(/\/$/);
  expect(userRequests).toBe(0);
});

test('local QA mode opens a usable Studio canvas', async ({ page }) => {
  await page.goto('/?local=1&reset=1');

  await expect(page.locator('.rail-brand')).toBeVisible();
  await expect(page.getByRole('main').getByText('Studio', { exact: true })).toBeVisible();
  await expect(page.getByTitle('Add note')).toBeVisible();
});

test('local QA mode can add a note, switch views, and toggle chrome', async ({ page }) => {
  await page.goto('/?local=1&reset=1');

  await page.getByTitle('Add note').click();
  await expect(page.getByText('Click on the canvas to place a note')).toBeVisible();
  await page.locator('.canvas-wrap').click({ position: { x: 420, y: 320 } });

  const newNote = page.locator('.card .note').last();
  await expect(newNote).toBeVisible();

  await page.getByRole('button', { name: 'List' }).click();
  await expect(page.getByText('Files')).toBeVisible();
  await expect(page.getByText('Empty note')).toBeVisible();

  await page.getByRole('button', { name: 'Canvas' }).click();
  await page.getByTitle('Toggle theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.locator('.sb-mid-collapse').click();
  await expect(page.locator('.app')).toHaveClass(/sb-collapsed/);
});

test('local QA mode exposes the core canvas tools cleanly', async ({ page }) => {
  await page.goto('/?local=1&reset=1');

  const canvas = page.locator('.canvas-wrap');
  // The reset=1 fixture seeds a non-empty starter set asynchronously after navigation,
  // so the baseline .count() races to 0 and throws off every +1 assertion below. Wait
  // until the count is BOTH non-zero (seed has painted) AND stable across two reads
  // (seed fully painted) before sampling — a bare `n === prevCount` would falsely settle
  // on the initial 0,0. (Pre-existing fragility, fixed while reworking the toolbar.)
  let prevCount = -1;
  await expect.poll(async () => {
    const n = await page.locator('.card').count();
    const settled = n > 0 && n === prevCount;
    prevCount = n;
    return settled;
  }, { timeout: 10000 }).toBe(true);
  const initialCardCount = await page.locator('.card').count();

  await page.getByTitle('Add board').click();
  await expect(page.getByText('Click on the canvas to place a board')).toBeVisible();
  await canvas.click({ position: { x: 220, y: 220 } });
  await expect(page.locator('.card')).toHaveCount(initialCardCount + 1);

  await page.getByRole('button', { name: 'Add menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Link card' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Shape', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByTitle('Add note').click();
  await expect(page.getByText('Click on the canvas to place a note')).toBeVisible();
  await canvas.click({ position: { x: 280, y: 260 } });
  await expect(page.locator('.note').last()).toBeVisible();

  await page.getByRole('button', { name: 'Add menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Shape', exact: true }).click();
  await expect(page.getByText('Click on the canvas to place a shape')).toBeVisible();
  await expect(page.locator('.tob').getByText('Shape')).toBeVisible();
  await canvas.click({ position: { x: 340, y: 300 } });

  await page.getByRole('button', { name: 'Add menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Palette' }).click();
  await canvas.click({ position: { x: 400, y: 340 } });
  await expect(page.locator('.pc').last()).toBeVisible();

  await page.getByTitle('Free-draw').click();
  await expect(page.getByTitle('Erase strokes')).toHaveCount(0);
  await expect(page.getByText('Drag to draw')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pen', exact: true })).toHaveClass(/is-active/);
  await expect(page.getByRole('button', { name: 'Eraser' })).toBeVisible();
  // Thickness controls render as buttons inside .tob-thickness, not as labeled text.
  await expect(page.locator('.tob .tob-thickness button').first()).toBeVisible();
  const strokePathCount = await page.locator('.strokes-layer path').count();
  await canvas.dragTo(canvas, {
    sourcePosition: { x: 500, y: 300 },
    targetPosition: { x: 570, y: 330 },
  });
  await expect(page.locator('.strokes-layer path')).toHaveCount(strokePathCount + 2);

  await page.getByTitle('Arrow - click 2 cards, or drag on empty canvas').click();
  await expect(page.getByText('Click a card to start, or drag on empty canvas for a free arrow')).toBeVisible();
  // .tob renders arrow options; presence is enough.
  await expect(page.locator('.tob')).toBeVisible();
  const arrowPathCount = await page.locator('.arrows-layer path').count();
  await page.locator('.card', { has: page.locator('.bc') }).first().click({ position: { x: 20, y: 20 } });
  await page.locator('.card', { has: page.locator('.note') }).last().click({ position: { x: 20, y: 20 } });
  await expect(page.locator('.arrows-layer path')).toHaveCount(arrowPathCount + 2);

  await page.getByTitle('Pan canvas (H or Space)').click();
  await expect(page.getByText('Drag to pan')).toBeVisible();
});

test('local QA mode keeps toolbar color picker polished and contained', async ({ page }) => {
  await page.goto('/?local=1&reset=1');

  await page.getByRole('button', { name: 'Add menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Shape', exact: true }).click();
  await expect(page.locator('.tob').getByText('Shape')).toBeVisible();
  await page.locator('.tob').getByTitle(/Custom hex/).first().click();

  const picker = page.locator('.cp-pop');
  await expect(picker).toBeVisible();
  // Picker title is the current hex value (e.g. "#F5F5F6") — verify hex-shaped text.
  await expect(picker.locator('.cp-title')).toBeVisible();
  await expect(picker.locator('.cp-title')).toHaveText(/^#[0-9A-F]{6}$/i);

  // The picker uses an SV square + hue strip (replaced the old wheel).
  const svBox = await picker.locator('.cp-sv').boundingBox();
  expect(svBox.width).toBeGreaterThanOrEqual(120);
  expect(svBox.height).toBeGreaterThanOrEqual(80);

  const pickerBox = await picker.boundingBox();
  const viewport = page.viewportSize();
  expect(pickerBox.x).toBeGreaterThanOrEqual(0);
  expect(pickerBox.y).toBeGreaterThanOrEqual(0);
  expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual(viewport.width);
  expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual(viewport.height);
});

test('local QA mode keeps context submenus inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 500 });
  await page.goto('/?local=1&reset=1');

  const canvas = page.locator('.canvas-wrap');
  await canvas.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 180,
      clientY: rect.top + 230,
    }));
  });
  await page.getByText('Background').hover();

  const submenu = page.locator('.ctx-submenu').last();
  await expect(submenu).toBeVisible();
  const box = await submenu.boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
});

test('local QA mode opens board cards from the canvas with one deliberate click', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));

  // Features is a list-view board → renders with .bc-list-title (no .bc-cover).
  // Halcyon is a canvas-view board → has .bc-cover. Either way, double-clicking
  // the card opens it.
  const halcyonBoard = page.locator('.card', { has: page.locator('.bc-name', { hasText: 'Halcyon' }) });
  await halcyonBoard.dblclick();

  await expect(page.locator('.crumb.here')).toHaveText('Halcyon');
});

test('local QA mode preserves session location and card edits across refresh', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  // Wipe persisted tweaks too so theme / compact-sidebar from prior tests
  // don't change the click target geometry.
  await page.evaluate(() => { try { localStorage.removeItem('soleil-boards-tweaks'); } catch (_) {} });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));

  const canvas = page.locator('.canvas-wrap');
  // Open Halcyon (canvas-view board) by double-clicking its card.
  await page.locator('.card', { has: page.locator('.bc-name', { hasText: 'Halcyon' }) }).dblclick();
  await expect(page.locator('.crumb.here')).toHaveText('Halcyon');
  await page.getByRole('button', { name: 'Canvas' }).click();

  await page.getByTitle('Add note').click();
  await canvas.click({ position: { x: 430, y: 330 } });
  await expect(page.locator('.card .note').last()).toBeVisible();
  await page.keyboard.type('Persistent refresh note');
  // Click on the breadcrumb (no buttons here, just plain text) to blur + commit.
  await page.locator('.crumbs').click({ force: true });
  await page.waitForTimeout(80);

  const card = page.locator('.card', { hasText: 'Persistent refresh note' }).last();
  // Drag using page.mouse — element-level dragTo gets blocked by SVG subtrees
  // intercepting pointer events even when not visually above.
  const cardBox = await card.boundingBox();
  await page.keyboard.press('Escape');
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down({ button: 'left' });
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(cardBox.x + i * 14, cardBox.y + i * 6);
  }
  await page.mouse.up({ button: 'left' });
  // Resize via the bottom-right handle (.card-resize)
  const resize = card.locator('.card-resize');
  const rb = await resize.boundingBox();
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down({ button: 'left' });
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(rb.x + i * 10, rb.y + i * 8);
  }
  await page.mouse.up({ button: 'left' });
  const before = await card.evaluate((node) => {
    return {
      left: Math.round(parseFloat(node.style.left)),
      top: Math.round(parseFloat(node.style.top)),
      width: Math.round(parseFloat(node.style.width)),
      height: Math.round(parseFloat(node.style.height)),
    };
  });

  await page.reload();

  await expect(page.locator('.crumb.here')).toHaveText('Halcyon');
  const restored = page.locator('.card', { hasText: 'Persistent refresh note' }).last();
  await expect(restored).toBeVisible();
  const after = await restored.evaluate((node) => {
    return {
      left: Math.round(parseFloat(node.style.left)),
      top: Math.round(parseFloat(node.style.top)),
      width: Math.round(parseFloat(node.style.width)),
      height: Math.round(parseFloat(node.style.height)),
    };
  });
  expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(3);
  expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(3);
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(3);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(3);
});

test('local QA mode lets select marquee delete drawn strokes', async ({ page }) => {
  await page.goto('/?local=1&reset=1');

  const canvas = page.locator('.canvas-wrap');
  await page.getByTitle('Free-draw').click();
  await canvas.dragTo(canvas, {
    sourcePosition: { x: 300, y: 500 },
    targetPosition: { x: 470, y: 520 },
  });
  await canvas.dragTo(canvas, {
    sourcePosition: { x: 300, y: 560 },
    targetPosition: { x: 470, y: 580 },
  });
  await expect(page.locator('.strokes-layer path')).toHaveCount(4);

  await page.getByTitle('Select / move (V)').click();
  await canvas.dragTo(canvas, {
    sourcePosition: { x: 280, y: 470 },
    targetPosition: { x: 500, y: 610 },
  });
  await expect(page.locator('.strokes-layer path')).toHaveCount(6);

  await page.keyboard.press('Backspace');
  await expect(page.locator('.strokes-layer path')).toHaveCount(0);
});

test('local QA mode erases part of a stroke from the draw tool', async ({ page }) => {
  await page.goto('/?local=1&reset=1');

  const canvas = page.locator('.canvas-wrap');
  await page.getByTitle('Free-draw').click();
  await canvas.dragTo(canvas, {
    sourcePosition: { x: 450, y: 320 },
    targetPosition: { x: 650, y: 320 },
  });
  await expect(page.locator('.strokes-layer path')).toHaveCount(2);

  await page.getByRole('button', { name: 'Eraser' }).click();
  await expect(page.getByText('Drag to erase strokes')).toBeVisible();
  await canvas.dragTo(canvas, {
    sourcePosition: { x: 540, y: 285 },
    targetPosition: { x: 560, y: 355 },
  });

  await expect(page.locator('.strokes-layer path')).toHaveCount(4);
});

test('local QA mode turns URLs in text notes into removable previews', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  // Reset tweaks so theme/sidebar settings don't bleed across tests.
  await page.evaluate(() => { try { localStorage.removeItem('soleil-boards-tweaks'); } catch (_) {} });
  await page.reload();

  await page.getByTitle('Add note').click();
  await page.locator('.canvas-wrap').click({ position: { x: 420, y: 320 } });
  // Auto-focus places caret in the new note's editable.
  await page.keyboard.type('Research https://example.com/deck');
  // Click on the empty topbar area to blur the note and trigger linkify.
  await page.locator('.tb-right').click({ force: true });

  const note = page.locator('.card .note').last();
  await expect(note.locator('a', { hasText: 'https://example.com/deck' })).toBeVisible();
  await expect(note.locator('.note-link-preview')).toBeVisible();

  await note.getByRole('button', { name: 'Remove link preview' }).click();
  await expect(note.locator('.note-link-preview')).toBeHidden();
  await expect(note).toContainText('https://example.com/deck');
});

test('local QA mode keeps expanded card contents inside card bounds', async ({ page }) => {
  await page.goto('/?local=1&reset=1');

  await page.getByTitle('Add note').click();
  await page.locator('.canvas-wrap').click({ position: { x: 420, y: 320 } });
  await page.keyboard.type('https://example.com/' + 'very-long-path-segment'.repeat(16));
  await page.keyboard.press('Tab');

  const card = page.locator('.card').last();
  const contained = await card.evaluate((node) => {
    const cardStyle = getComputedStyle(node);
    const body = node.querySelector('.note-body');
    const bodyStyle = getComputedStyle(body);
    return cardStyle.overflow === 'hidden' &&
      ['auto', 'scroll', 'hidden'].includes(bodyStyle.overflowY) &&
      body.clientHeight <= node.clientHeight &&
      body.scrollWidth <= body.clientWidth + 1;
  });
  expect(contained).toBe(true);
});

test('local QA mode uses in-app dialogs instead of native prompts', async ({ page }) => {
  await page.goto('/?local=1&reset=1');

  page.on('dialog', dialog => {
    throw new Error(`Unexpected native dialog: ${dialog.message()}`);
  });

  await page.getByRole('button', { name: 'Add menu', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();

  await page.getByRole('button', { name: 'Topbar add menu' }).click();
  await page.getByRole('menuitem', { name: 'Linked board' }).click();
  await expect(page.getByPlaceholder(/Search in Studio/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.picker')).toBeHidden();

  // Plain-card delete: no confirm — an Undo toast instead.
  await page.getByTitle('Add note').click();
  await page.locator('.canvas-wrap').click({ position: { x: 420, y: 320 } });
  await page.keyboard.type('disposable');
  // The fresh note opens in edit mode; click away to commit, then select it.
  await page.locator('.canvas-wrap').click({ position: { x: 60, y: 60 } });
  const note = page.locator('.card', { hasText: 'disposable' }).first();
  await note.click({ position: { x: 6, y: 6 } });
  const cardCount = await page.locator('.card').count();
  await page.keyboard.press('Backspace');
  await expect(page.getByRole('dialog', { name: /Delete/i })).toBeHidden();
  await expect(page.locator('.card')).toHaveCount(cardCount - 1);
  const undoToast = page.locator('.toast', { hasText: 'Card deleted' });
  await expect(undoToast).toBeVisible();
  await expect(undoToast.getByRole('button', { name: 'Undo' })).toBeVisible();

  // Board deletes keep the in-app confirm (they can contain a subtree).
  const boardCard = page.locator('[data-card-id="b-sundown"]');
  // Click the footer strip — the cover area opens the board on click.
  const bb = await boardCard.boundingBox();
  await boardCard.click({ position: { x: 12, y: bb.height - 8 } });
  await expect(boardCard).toHaveClass(/is-selected/);
  await page.keyboard.press('Backspace');
  await expect(page.getByRole('dialog', { name: /Delete/i })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: /Delete/i })).toBeHidden();
});

test('local QA mode keeps picker and settings simple', async ({ page }) => {
  await page.goto('/?local=1&reset=1');

  await page.getByText('Search boards').click();
  await expect(page.getByPlaceholder(/Search in Studio/)).toBeVisible();
  await page.getByPlaceholder(/Search in Studio/).fill('Sundown');
  await expect(page.locator('.picker-row-name', { hasText: 'Sundown Highway' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.picker')).toBeHidden();

  await page.locator('.twk-gear').click();
  await expect(page.locator('.twk-panel')).toBeVisible();
  await expect(page.locator('.twk-panel').getByText('Show arrows')).toBeVisible();
  await expect(page.locator('.twk-panel').getByText('Show messages')).toBeVisible();
});
