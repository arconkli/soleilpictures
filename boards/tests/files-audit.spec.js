// Files: defects from the 2026-10 platform audit (FILES-LIST-*), each pinned
// where only a real layout or a real event shows it. Driven through the
// ?local=1 harness.
import { expect, test } from '@playwright/test';
import { openFullFiles } from './files-helpers.js';

async function go(page, { width = 1440, height = 900, blank = false } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(`/?local=1&reset=1${blank ? '&blank=1' : ''}`);
  await page.evaluate((b) => {
    try { localStorage.removeItem('soleil.files.dock'); localStorage.setItem('soleil.files.dockHint', '1'); } catch (_) {}
    // blank=1 must stay in the URL: rewriting it away re-seeds the demo board.
    if (!b) window.history.replaceState(null, '', '/?local=1');
  }, blank);
  await page.reload();
  await expect(page.locator('.canvas-wrap')).toBeVisible();
}

// Full Files at any width: on a phone the topbar's Files button carries a
// count in its name, and there's no room for the panel, so it opens full.
async function openFull(page) {
  if (page.viewportSize().width > 700) { await openFullFiles(page); return; }
  await page.getByRole('button', { name: /^Files/ }).click();
  await expect(full(page)).toBeVisible();
}

async function openPanel(page) {
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: 300 } });
  await page.keyboard.press('f');
  await expect(panel(page)).toBeVisible();
}

const panel = (page) => page.locator('.list-wrap.is-panel');
const full = (page) => page.locator('.list-wrap:not(.is-panel)');

// A 1×1 PNG, enough for the harness (it never uploads).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const pngs = (...names) => names.map((name) => ({ name, mimeType: 'image/png', buffer: PNG }));

// The bar fits when nothing in it spills: no sideways overflow in the pill, and
// its last button (×) ends inside the box it sits in.
async function expectSelbarFits(page, wrap, box) {
  const bar = wrap.locator('.list-selbar');
  await expect(bar).toBeVisible();
  expect(await bar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  expect(await wrap.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const clear = await bar.getByRole('button', { name: 'Clear selection' }).boundingBox();
  const pill = await bar.boundingBox();
  expect(clear.x + clear.width).toBeLessThanOrEqual(pill.x + pill.width + 0.5);
  expect(pill.x + pill.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
}

test('FILES-LIST-01: the selection bar fits the panel at its default width, Put on board included', async ({ page }) => {
  await go(page);
  await openPanel(page);
  // A dropped file waits off the board, so the bar offers Put on board too.
  await panel(page).locator('input[type="file"][multiple]').setInputFiles(pngs('waiting.png'));
  const tile = panel(page).locator('.ct-tile-name[title="waiting.png"]');
  await expect(tile).toBeVisible();
  await tile.click();
  const bar = panel(page).locator('.list-selbar');
  await expect(bar.getByRole('button', { name: 'Put on board' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Delete' })).toBeVisible();
  await expectSelbarFits(page, panel(page), await page.locator('.fdl-files').boundingBox());
});

test('FILES-LIST-01: full Files at phone width keeps the whole selection bar on screen', async ({ page }) => {
  await go(page, { width: 390, height: 844 });
  await openFull(page);
  await full(page).locator('input[type="file"][multiple]').setInputFiles(pngs('waiting.png'));
  const tile = full(page).locator('.ct-tile-name[title="waiting.png"]');
  await expect(tile).toBeVisible();
  await tile.click();
  const bar = full(page).locator('.list-selbar');
  await expect(bar.getByRole('button', { name: 'Put on board' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Delete' })).toBeVisible();
  await expectSelbarFits(page, full(page), { x: 0, width: 390 });
});

test('FILES-LIST-X1: the phone bottom-nav + adds files in full Files, where no board is mounted', async ({ page }) => {
  await go(page, { width: 390, height: 844 });
  await openFull(page);
  await expect(page.locator('.canvas-wrap')).toHaveCount(0);
  // The harness hides its puck outside the canvas; the app's shows it on any
  // editable cluster and sends this event, which only the board answered.
  const chooser = page.waitForEvent('filechooser', { timeout: 4000 });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('soleil-mobile-add-card', { detail: { boardId: 'root' } })));
  const fc = await chooser;
  await fc.setFiles(pngs('from-plus.png'));
  await expect(full(page).locator('.ct-tile-name[title="from-plus.png"]')).toBeVisible();
});
