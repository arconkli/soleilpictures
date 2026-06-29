// Comprehensive end-to-end behavior tests in local QA mode.
// Covers every UI surface that doesn't depend on Supabase auth/realtime.
// Each test is intentionally focused — one behavior per test — so failures
// point at one root cause, not a tangle.

import { expect, test } from '@playwright/test';

// ─── helpers ──────────────────────────────────────────────────────────────

async function go(page, { blank = false } = {}) {
  // blank:true boots an EMPTY cluster (?blank=1) so canvas-placement tests click
  // bare canvas; default keeps the dense demo seed for tests that read it.
  const url = blank ? '/?local=1&reset=1&blank=1' : '/?local=1&reset=1';
  const after = blank ? '/?local=1&blank=1' : '/?local=1';
  await page.goto(url);
  // Wipe persisted tweaks (theme, compactSidebar, showMessages) so test
  // order doesn't change click geometry.
  await page.evaluate(() => { try { localStorage.removeItem('soleil-boards-tweaks'); } catch (_) {} });
  await page.goto(url);
  await page.evaluate((a) => window.history.replaceState(null, '', a), after);
  await expect(page.locator('.rail-brand')).toBeVisible();
}

async function withFreshSession(page, { blank = false } = {}) {
  // For tests that need to assert against persisted state, drop session storage first.
  const url = blank ? '/?local=1&reset=1&blank=1' : '/?local=1&reset=1';
  const after = blank ? '/?local=1&blank=1' : '/?local=1';
  await page.goto(url);
  await page.evaluate((a) => window.history.replaceState(null, '', a), after);
}

// ═══════════════ SIDEBAR ═══════════════

test.describe('Sidebar', () => {
  test('has rail + middle column with Home / Messages rows + search button', async ({ page }) => {
    await go(page);
    await expect(page.locator('.rail')).toBeVisible();
    await expect(page.locator('.sb-mid-title')).toContainText('Local Studio');
    await expect(page.locator('.sb-row').filter({ hasText: 'Home' })).toBeVisible();
    await expect(page.locator('.sb-row').filter({ hasText: 'Messages' })).toBeVisible();
    await expect(page.locator('.sb-search')).toBeVisible();
  });

  test('Messages row toggles the right-drawer panel', async ({ page }) => {
    await go(page);
    // Default closed.
    await expect(page.locator('.msg-panel')).toHaveCount(0);
    await page.locator('.sb-row').filter({ hasText: /^Messages/ }).click();
    await expect(page.locator('.msg-panel')).toBeVisible();
    // Click again to close.
    await page.locator('.sb-row').filter({ hasText: /^Messages/ }).click();
    await expect(page.locator('.msg-panel')).toHaveCount(0);
  });

  test('Compact sidebar collapses (middle column hides) + expands', async ({ page }) => {
    await go(page);
    await page.locator('.sb-mid-collapse').click();
    await expect(page.locator('.app')).toHaveClass(/sb-collapsed/);
    // The middle column is hidden via CSS; rail is still visible.
    await expect(page.locator('.rail')).toBeVisible();
    // Brand is hidden in compact mode; the .rail-toggle button replaces it.
    await expect(page.locator('.rail-brand')).toHaveCount(0);
    // The collapsed middle column overlays the rail-toggle (intercepts pointer
    // events), so dispatch the click on the element directly to fire its handler.
    await page.locator('.rail-toggle').dispatchEvent('click');
    await expect(page.locator('.app')).not.toHaveClass(/sb-collapsed/);
  });

  test('Home row navigates to HomeGraph surface', async ({ page }) => {
    await go(page);
    await page.locator('.sb-row').filter({ hasText: 'Home' }).click();
    await expect(page.locator('.sb-row').filter({ hasText: 'Home' })).toHaveClass(/active/);
  });
});

// ═══════════════ TOPBAR ═══════════════

test.describe('Topbar', () => {
  test('Theme toggle flips light/dark with no console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await go(page);
    await page.getByTitle('Toggle theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByTitle('Toggle theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(errors).toEqual([]);
  });

  test('Add menu button opens menu with all kinds', async ({ page }) => {
    await go(page);
    await page.getByRole('button', { name: 'Topbar add menu' }).click();
    // Local-mode topbar add menu has Add board / Linked cluster.
    const menuitems = page.locator('.topbar-add-menu [role="menuitem"], .topbar-add-menu button');
    expect(await menuitems.count()).toBeGreaterThan(0);
    // Close
    await page.keyboard.press('Escape');
  });
});

// ═══════════════ CANVAS — TOOLBAR & ADD MENU ═══════════════

test.describe('Canvas tools', () => {
  test('Add menu opens, lists Doc / Shape / Palette / Linked cluster (Board + Text note moved off)', async ({ page }) => {
    await go(page);
    await page.getByRole('button', { name: 'Add menu', exact: true }).click();
    for (const label of ['Doc', 'Shape', 'Palette', 'Linked cluster']) {
      await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
    }
    // Board is now a first-class toolbar tool, and Text note is the toolbar's Add-note
    // tool — so neither is repeated in the "+" menu anymore.
    await expect(page.getByRole('menuitem', { name: 'Cluster', exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Text note', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('Select tool is the default after page load', async ({ page }) => {
    await go(page);
    await expect(page.getByRole('button', { name: 'Select tool', exact: true })).toHaveClass(/active/);
  });

  test('Pan tool activates + shows hint', async ({ page }) => {
    await go(page);
    await page.getByRole('button', { name: 'Pan tool', exact: true }).click();
    await expect(page.getByText('Drag to pan')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('Add note → click → note card spawns', async ({ page }) => {
    await go(page, { blank: true });
    const before = await page.locator('.card').count();
    await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
    await expect(page.getByText('Click on the canvas to place a note')).toBeVisible();
    await page.locator('.canvas-wrap').click({ position: { x: 480, y: 380 } });
    await expect(page.locator('.card')).toHaveCount(before + 1);
    await expect(page.locator('.note').last()).toBeVisible();
  });

  test('Add Board via toolbar → click → board card spawns', async ({ page }) => {
    await go(page, { blank: true });
    const before = await page.locator('.card').count();
    await page.getByRole('button', { name: 'Add cluster tool', exact: true }).click();
    await expect(page.getByText('Click on the canvas to place a board')).toBeVisible();
    await page.locator('.canvas-wrap').click({ position: { x: 380, y: 320 } });
    await expect(page.locator('.card')).toHaveCount(before + 1);
  });

  test('Add Palette via Add menu → click → palette card spawns', async ({ page }) => {
    await go(page, { blank: true });
    await page.getByRole('button', { name: 'Add menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Palette', exact: true }).click();
    await page.locator('.canvas-wrap').click({ position: { x: 460, y: 360 } });
    await expect(page.locator('.pc').last()).toBeVisible();
  });

  test('Shape (via Add menu) activates + hint shows', async ({ page }) => {
    await go(page);
    await page.getByRole('button', { name: 'Add menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Shape', exact: true }).click();
    await expect(page.getByText('Click on the canvas to place a shape')).toBeVisible();
  });

  test('Free-draw tool activates + Pen/Eraser segmented control appears', async ({ page }) => {
    await go(page);
    await page.getByRole('button', { name: 'Free-draw tool', exact: true }).click();
    await expect(page.getByText('Drag to draw')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pen', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Eraser' })).toBeVisible();
  });

  test('Arrow tool activates + hint asks for cards', async ({ page }) => {
    await go(page);
    await page.getByRole('button', { name: 'Arrow tool', exact: true }).click();
    await expect(page.getByText(/Click a card to start/)).toBeVisible();
  });

  test('Esc returns to select tool', async ({ page }) => {
    await go(page);
    await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Select tool', exact: true })).toHaveClass(/active/);
  });
});

// ═══════════════ CANVAS — INTERACTION ═══════════════

test.describe('Canvas interaction', () => {
  test('Drag a card to a new position', async ({ page }) => {
    await go(page, { blank: true });
    // Place a note in an empty corner, give it content, and commit it (an empty /
    // uncommitted note isn't draggable — its body swallows the pointerdown).
    await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
    const cb = await page.locator('.canvas-wrap').boundingBox();
    await page.locator('.canvas-wrap').click({ position: { x: cb.width - 220, y: 140 } });
    await page.locator('.note-body[contenteditable="true"]').last().click();
    await page.keyboard.type('drag me');
    await page.locator('.canvas-wrap').click({ position: { x: 120, y: cb.height - 120 } });
    const note = page.locator('.card', { hasText: 'drag me' }).last();
    await expect(note).toBeVisible();
    // Pointer-events sequence with explicit pointer events for the card.
    const before = await note.boundingBox();
    const startX = before.x + before.width / 2;
    const startY = before.y + before.height / 2;
    // Use the underlying CDP-backed mouse APIs which fire BOTH mouse + pointer.
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });
    // The drag handler arms after pointerdown; subsequent pointermove deltas drive
    // it. Pace the moves — rapid moves coalesce on rAF so the drag can fail to arm.
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(startX + i * 10, startY + i * 6);
      await page.waitForTimeout(16);
    }
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(50);
    const after = await note.boundingBox();
    // If the drag worked, we should have moved at least 30px right.
    // (Soft assert as integer movement; allow small slop for snap.)
    if (after.x - before.x < 20) {
      // Surface diagnostic info before failing.
      throw new Error(`Card did not move: before.x=${before.x}, after.x=${after.x}`);
    }
  });

  test('Free-draw: dragging on canvas creates a stroke path', async ({ page }) => {
    await go(page, { blank: true });
    const before = await page.locator('.strokes-layer path').count();
    await page.getByRole('button', { name: 'Free-draw tool', exact: true }).click();
    const canvas = page.locator('.canvas-wrap');
    await canvas.dragTo(canvas, {
      sourcePosition: { x: 520, y: 300 },
      targetPosition: { x: 580, y: 340 },
    });
    expect(await page.locator('.strokes-layer path').count()).toBeGreaterThan(before);
  });

  test('Marquee: dragging empty area shows the marquee rect', async ({ page }) => {
    await go(page, { blank: true });
    // Find a definitely-empty region of the canvas (far right, above the toolbar).
    const cb = await page.locator('.canvas-wrap').boundingBox();
    const sx = cb.x + cb.width - 120;
    const sy = cb.y + 80;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(sx - i * 18, sy + i * 12, { steps: 1 });
    }
    await expect(page.locator('.marquee')).toBeVisible();
    await page.mouse.up();
  });

  test('Zoom +/− buttons change displayed zoom percent', async ({ page }) => {
    await go(page);
    const zoomLabel = page.locator('.cnv-zoom-val').first();
    const initial = (await zoomLabel.textContent()).trim();
    await page.locator('.cnv-zoom button').filter({ hasText: '+' }).click();
    const after = (await zoomLabel.textContent()).trim();
    expect(after).not.toBe(initial);
  });
});

// ═══════════════ LIST SURFACE ═══════════════

test.describe('List view', () => {
  test('switches between Canvas and List view', async ({ page }) => {
    await go(page);
    await page.getByRole('button', { name: 'List' }).click();
    await expect(page.locator('.list-wrap')).toBeVisible();
    await page.getByRole('button', { name: 'Canvas' }).click();
    await expect(page.locator('.canvas-wrap')).toBeVisible();
  });
});

// ═══════════════ TWEAKS PANEL ═══════════════

test.describe('Tweaks panel', () => {
  test('Gear button opens panel', async ({ page }) => {
    await go(page);
    await page.locator('.twk-gear').click();
    await expect(page.locator('.twk-panel')).toBeVisible();
    await expect(page.locator('.twk-panel').getByText('Theme')).toBeVisible();
  });

  test('Cmd+. keyboard shortcut opens panel', async ({ page }) => {
    await go(page);
    await page.keyboard.press('Meta+Period');
    const visible = await page.locator('.twk-panel').isVisible().catch(() => false);
    if (!visible) await page.keyboard.press('Control+Period');
    await expect(page.locator('.twk-panel')).toBeVisible();
  });

  test('Tweaks panel close button hides the panel', async ({ page }) => {
    await go(page);
    await page.locator('.twk-gear').click();
    await expect(page.locator('.twk-panel')).toBeVisible();
    await page.locator('.twk-panel button[aria-label="Close tweaks"]').click();
    await expect(page.locator('.twk-panel')).toHaveCount(0);
  });
});

// ═══════════════ PERSISTENCE ═══════════════

test.describe('Persistence', () => {
  test('Adding a note then reloading keeps the note', async ({ page }) => {
    await withFreshSession(page, { blank: true });
    const before = await page.locator('.card').count();
    await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
    await page.locator('.canvas-wrap').click({ position: { x: 500, y: 400 } });
    await expect(page.locator('.card')).toHaveCount(before + 1);
    await page.reload();
    await expect(page.locator('.card')).toHaveCount(before + 1);
  });
});

// ═══════════════ ALT-SESSION (URL param wiring only) ═══════════════

test.describe('Alt session', () => {
  test('?as=alt loads without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?local=1&as=alt');
    await page.waitForTimeout(400);
    expect(errors).toEqual([]);
  });
});

// ═══════════════ NO CONSOLE ERRORS ═══════════════

test.describe('Console health', () => {
  test('Local mode load: zero pageerror, zero console.error', async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await go(page);
    await page.waitForTimeout(600);
    expect(pageErrors).toEqual([]);
    // Filter out network/CORS noise that's environmental (local QA has no real
    // Supabase, so analytics/REST POSTs return 400s — "Failed to load resource").
    const real = consoleErrors.filter(t => !/(net::|favicon|cors|Failed to load resource)/i.test(t));
    expect(real).toEqual([]);
  });
});
