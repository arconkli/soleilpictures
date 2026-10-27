import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Export → PNG image / PDF on the canvas's right-click menu (lib/exportBoard.js).
// Both looked for an <svg> in a hidden BoardThumbnail, which has drawn an <img>
// since 2026-05-27, so every export of every board said "Nothing to export."

async function boardWithANote(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: { x: 420, y: 320 } });
  await expect(page.locator('.card .note').last()).toBeVisible();
  await page.keyboard.type('Pick up at the diner, dusk');
  await page.keyboard.press('Escape');
}

async function exportAs(page, item) {
  await page.locator('.canvas-wrap').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: rect.left + 120, clientY: rect.top + 120,
    }));
  });
  await page.getByText('Export', { exact: true }).hover();
  await page.locator('.ctx-submenu').last().getByText(item, { exact: true }).click();
}

test('Export → PNG image downloads a picture of the board', async ({ page }) => {
  await boardWithANote(page);
  const download = page.waitForEvent('download');
  await exportAs(page, 'PNG image');
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.png$/);
  const png = readFileSync(await file.path());
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR: the board's own frame, at the covers' zoom and 2× supersample.
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(width).toBeGreaterThan(300);
  expect(height).toBeGreaterThan(200);
  await expect(page.getByText('Nothing to export.')).toHaveCount(0);
});

test('Export → PDF prints the picture from a frame, with no pop-up', async ({ page }) => {
  // Every frame's print() records what it would print, into the page.
  await page.addInitScript(() => {
    window.print = function () {
      const img = document.querySelector('img');
      const top = window.top;
      top.__printed = (top.__printed || []).concat([{ w: img?.naturalWidth || 0, h: img?.naturalHeight || 0, src: img?.src?.slice(0, 5) || '' }]);
    };
  });
  let popups = 0;
  page.on('popup', () => { popups += 1; });
  await boardWithANote(page);
  await exportAs(page, 'PDF (Save from Print)');
  await expect.poll(() => page.evaluate(() => window.__printed || [])).toHaveLength(1);
  const [printed] = await page.evaluate(() => window.__printed);
  expect(printed.src).toBe('blob:');
  expect(printed.w).toBeGreaterThan(300);
  expect(printed.h).toBeGreaterThan(200);
  expect(popups).toBe(0);
  await expect(page.getByText('Nothing to export.')).toHaveCount(0);
});

test('Export on an empty board says there is nothing to export', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await exportAs(page, 'PNG image');
  await expect(page.getByText('Nothing to export.')).toBeVisible();
});
