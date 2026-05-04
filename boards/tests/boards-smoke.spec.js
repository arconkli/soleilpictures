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
  await page.goto('/?local=1');

  await expect(page.getByText('Soleil', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByText('Studio', { exact: true })).toBeVisible();
  await expect(page.getByTitle('Add note')).toBeVisible();
  await expect(page.locator('.inbox-title', { hasText: 'Inbox' })).toBeVisible();
});

test('local QA mode can add a note, switch views, and toggle chrome', async ({ page }) => {
  await page.goto('/?local=1');

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

  await page.getByTitle('Collapse').click();
  await expect(page.locator('.app')).toHaveClass(/sb-collapsed/);
});

test('local QA mode exposes the core canvas tools cleanly', async ({ page }) => {
  await page.goto('/?local=1');

  const canvas = page.locator('.canvas-wrap');
  const initialCardCount = await page.locator('.card').count();

  await page.getByRole('button', { name: 'Add menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Board', exact: true }).click();
  await expect(page.getByText('Click on the canvas to place a board')).toBeVisible();
  await canvas.click({ position: { x: 220, y: 220 } });
  await expect(page.locator('.card')).toHaveCount(initialCardCount + 1);

  await page.getByRole('button', { name: 'Add menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Link card' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Text note' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByTitle('Add note').click();
  await expect(page.getByText('Click on the canvas to place a note')).toBeVisible();
  await canvas.click({ position: { x: 280, y: 260 } });
  await expect(page.locator('.note').last()).toBeVisible();

  await page.getByTitle('Add shape').click();
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
  await expect(page.locator('.tob').getByText('Thickness')).toBeVisible();
  const strokePathCount = await page.locator('.strokes-layer path').count();
  await canvas.dragTo(canvas, {
    sourcePosition: { x: 500, y: 300 },
    targetPosition: { x: 570, y: 330 },
  });
  await expect(page.locator('.strokes-layer path')).toHaveCount(strokePathCount + 2);

  await page.getByTitle('Arrow - click 2 cards, or drag on empty canvas').click();
  await expect(page.getByText('Click a card to start, or drag on empty canvas for a free arrow')).toBeVisible();
  await expect(page.locator('.tob').getByText('Path')).toBeVisible();
  const arrowPathCount = await page.locator('.arrows-layer path').count();
  await page.locator('.card', { has: page.locator('.bc') }).first().click({ position: { x: 20, y: 20 } });
  await page.locator('.card', { has: page.locator('.note') }).last().click({ position: { x: 20, y: 20 } });
  await expect(page.locator('.arrows-layer path')).toHaveCount(arrowPathCount + 2);

  await page.getByTitle('Pan canvas (H or Space)').click();
  await expect(page.getByText('Drag to pan')).toBeVisible();
});

test('local QA mode keeps toolbar color picker polished and contained', async ({ page }) => {
  await page.goto('/?local=1');

  await page.getByTitle('Add shape').click();
  await expect(page.locator('.tob').getByText('Shape')).toBeVisible();
  await page.locator('.tob').getByTitle(/Custom hex/).first().click();

  const picker = page.locator('.cp-pop');
  await expect(picker).toBeVisible();
  await expect(picker.getByText('Soleil Color')).toBeVisible();

  const wheelBox = await picker.locator('.cp-wheel').boundingBox();
  expect(wheelBox.width).toBeGreaterThanOrEqual(120);
  expect(wheelBox.height).toBeGreaterThanOrEqual(80);

  const pickerBox = await picker.boundingBox();
  const viewport = page.viewportSize();
  expect(pickerBox.x).toBeGreaterThanOrEqual(0);
  expect(pickerBox.y).toBeGreaterThanOrEqual(0);
  expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual(viewport.width);
  expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual(viewport.height);
});

test('local QA mode keeps context submenus inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 500 });
  await page.goto('/?local=1');

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
  await page.goto('/?local=1');

  const featuresBoard = page.locator('.card', { has: page.locator('.bc-name', { hasText: 'Features' }) });
  await featuresBoard.locator('.bc-cover').click();

  await expect(page.locator('.crumb.here')).toHaveText('Features');
  await expect(page.locator('.card', { has: page.locator('.bc-name', { hasText: 'Features' }) })).toHaveCount(0);
});

test('local QA mode preserves session location and card edits across refresh', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));

  const canvas = page.locator('.canvas-wrap');
  await page.locator('.card', { has: page.locator('.bc-name', { hasText: 'Features' }) }).locator('.bc-cover').click();
  await expect(page.locator('.crumb.here')).toHaveText('Features');
  await page.getByRole('button', { name: 'Canvas' }).click();

  await page.getByTitle('Add note').click();
  await canvas.click({ position: { x: 430, y: 330 } });
  await expect(page.locator('.card .note').last()).toBeVisible();
  await page.keyboard.type('Persistent refresh note');
  await page.keyboard.press('Tab');

  const card = page.locator('.card', { hasText: 'Persistent refresh note' }).last();
  await card.dragTo(canvas, {
    sourcePosition: { x: 40, y: 30 },
    targetPosition: { x: 560, y: 390 },
  });
  await card.locator('.card-resize').dragTo(canvas, {
    targetPosition: { x: 700, y: 470 },
  });
  const before = await card.evaluate((node) => {
    return {
      left: Math.round(parseFloat(node.style.left)),
      top: Math.round(parseFloat(node.style.top)),
      width: Math.round(parseFloat(node.style.width)),
      height: Math.round(parseFloat(node.style.height)),
    };
  });

  await page.reload();

  await expect(page.locator('.crumb.here')).toHaveText('Features');
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
  await page.goto('/?local=1');

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
  await page.goto('/?local=1');

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
  await page.goto('/?local=1');

  await page.getByTitle('Add note').click();
  await page.locator('.canvas-wrap').click({ position: { x: 420, y: 320 } });
  await page.keyboard.type('Research https://example.com/deck');
  await page.keyboard.press('Tab');

  const note = page.locator('.card .note').last();
  await expect(note.locator('a', { hasText: 'https://example.com/deck' })).toBeVisible();
  await expect(note.locator('.note-link-preview')).toBeVisible();

  await note.getByRole('button', { name: 'Remove link preview' }).click();
  await expect(note.locator('.note-link-preview')).toBeHidden();
  await expect(note).toContainText('https://example.com/deck');
});

test('local QA mode keeps expanded card contents inside card bounds', async ({ page }) => {
  await page.goto('/?local=1');

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
  await page.goto('/?local=1');

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

  await page.getByTitle('Add note').click();
  await page.locator('.canvas-wrap').click({ position: { x: 420, y: 320 } });
  await page.locator('.card').last().click({ position: { x: 6, y: 6 } });
  await page.keyboard.press('Backspace');
  await expect(page.getByRole('dialog', { name: /Delete/i })).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog', { name: /Delete/i })).toBeHidden();
});

test('local QA mode keeps picker, inbox, and settings simple', async ({ page }) => {
  await page.goto('/?local=1');

  await page.getByText('Search boards').click();
  await expect(page.getByPlaceholder(/Search in Studio/)).toBeVisible();
  await page.getByPlaceholder(/Search in Studio/).fill('Sundown');
  await expect(page.locator('.picker-row-name', { hasText: 'Sundown Highway' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.picker')).toBeHidden();

  await page.getByPlaceholder(/Search inbox/).fill('motel');
  await expect(page.getByText('sunset_motel_ref.png')).toBeVisible();
  await expect(page.getByText('IMG_4429.heic')).toBeHidden();

  await page.getByLabel(/Open settings/).click();
  await expect(page.getByText('Board settings')).toBeVisible();
  await expect(page.getByText('Show arrows')).toBeVisible();
  await expect(page.getByText('Show cursors')).toBeVisible();
});
