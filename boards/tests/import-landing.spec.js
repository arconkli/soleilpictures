// A cluster whose files are all in Files, its canvas empty — every folder a
// bulk import makes (src/components/UnplacedOffer.jsx): the board offers to
// put them on, all at once as justified rows in one undo step, or the ones you
// choose in Files. Driven through the ?local=1 harness, which never uploads.
import { expect, test } from '@playwright/test';

// A 1×1 PNG, enough for the harness.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const pngs = (n) => Array.from({ length: n }, (_, i) => ({ name: `still-${i + 1}.png`, mimeType: 'image/png', buffer: PNG }));

const offer = (page) => page.locator('.cnv-offer');
const onCanvas = (page) => page.locator('.canvas-wrap [data-card-id]');
const panel = (page) => page.locator('.list-wrap.is-panel');

// The flags go in before the app boots: the harness re-seeds on every load.
async function go(page, { bulk = true } = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((on) => {
    try {
      if (on) localStorage.setItem('soleil.dev.bulkImport', '1'); else localStorage.removeItem('soleil.dev.bulkImport');
      localStorage.setItem('soleil.dev.sidebarFiles', '1');
      localStorage.removeItem('soleil.files.dock');
      localStorage.setItem('soleil.files.dockHint', '1');
    } catch (_) {}
  }, bulk);
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
}

// Six photos into Files, then Files closed again: the board is empty and its
// cluster isn't.
async function fillFiles(page, n = 6) {
  await page.locator('.canvas-wrap').click({ position: { x: 400, y: 300 } });
  await page.keyboard.press('f');
  await expect(panel(page)).toBeVisible();
  await page.locator('.list-wrap input[type="file"][multiple]').setInputFiles(pngs(n));
  await expect(page.locator('.toast-msg').getByText(`Added ${n} files to Files — not on the board`)).toBeVisible();
  await page.locator('.canvas-wrap').click({ position: { x: 400, y: 300 } });
  await page.keyboard.press('f');
  await expect(panel(page)).toHaveCount(0);
}

test('the empty board says what is in Files and puts it all on as rows, framed, in one undo step', async ({ page }) => {
  await go(page);
  await fillFiles(page);
  await expect(offer(page).locator('.cnv-offer-title')).toHaveText('6 photos are in Files');
  await expect(offer(page).locator('.cnv-offer-sub')).toHaveText('They stay off the board until you put them on it — all of them, or the ones you choose.');
  await expect(page.locator('.cnv-waiting')).toHaveCount(0);
  expect(await onCanvas(page).count()).toBe(0);

  await offer(page).getByRole('button', { name: 'Put them on the board' }).click();
  await expect(onCanvas(page)).toHaveCount(6);
  await expect(offer(page)).toHaveCount(0);
  await expect(page.locator('.toast-msg').getByText('6 put on the board')).toBeVisible();

  // Justified: every row one height. Framed: every card in the window.
  const rects = await onCanvas(page).evaluateAll((els) => els.map((el) => ({
    top: parseFloat(el.style.top), h: parseFloat(el.style.height), box: el.getBoundingClientRect().toJSON(),
  })));
  const rows = new Map();
  for (const r of rects) rows.set(r.top, [...(rows.get(r.top) || []), r.h]);
  for (const hs of rows.values()) expect(new Set(hs).size).toBe(1);
  for (const { box } of rects) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(1440);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(900);
  }

  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(onCanvas(page)).toHaveCount(0);
  await expect(offer(page).locator('.cnv-offer-title')).toHaveText('6 photos are in Files');
});

test('Choose in Files opens Files beside the board', async ({ page }) => {
  await go(page);
  await fillFiles(page, 2);
  await offer(page).getByRole('button', { name: 'Choose in Files' }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('.ct-tile-flag.is-off')).toHaveCount(2);
});

// Bulk import is open everywhere since the sidebar release (2026-10-21), so
// the offer no longer needs the old dev opt-in, and the one-line note it
// replaced is gone.
test('without the old dev opt-in the board still offers to put them on, not the one-line note', async ({ page }) => {
  await go(page, { bulk: false });
  await fillFiles(page, 2);
  await expect(offer(page).locator('.cnv-offer-title')).toHaveText('2 photos are in Files');
  await expect(page.locator('.cnv-waiting')).toHaveCount(0);
});
