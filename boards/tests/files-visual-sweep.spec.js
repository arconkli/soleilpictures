// Files: defects from the 2026-10 runtime visual sweep (VS-FILES-*), each
// pinned where only a real layout or a real event shows it. Driven through the
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

const full = (page) => page.locator('.list-wrap:not(.is-panel)');

test('VS-FILES-01: stepping through Quick look moves a one-file selection with it', async ({ page }) => {
  await go(page);
  await openFullFiles(page);
  await page.getByRole('button', { name: 'List layout' }).click();
  const rows = full(page).locator('.ct-body .ct-row:not(.ct-group)');
  await rows.nth(3).click();
  await expect(rows.nth(3)).toHaveClass(/is-selected/);
  await page.keyboard.press('Space');
  const ql = page.getByRole('dialog', { name: /^Quick look/ });
  await expect(ql).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Escape');
  await expect(ql).toHaveCount(0);
  // One row carries both the cursor and the selection; nothing else is marked.
  await expect(rows.nth(2)).toHaveClass(/is-selected/);
  await expect(rows.nth(2)).toHaveClass(/is-active/);
  await expect(full(page).locator('.ct-row.is-selected')).toHaveCount(1);
  await expect(full(page).locator('.ct-row.is-active')).toHaveCount(1);
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true });

  test('VS-FILES-02: a mixed-type List row is name + download, the button at the right edge', async ({ page }) => {
    await go(page, { width: 390, height: 844 });
    await page.getByRole('button', { name: /^Files/ }).click();
    await expect(full(page)).toBeVisible();
    await full(page).getByRole('button', { name: 'List layout' }).click();
    const row = full(page).locator('.ct-body .ct-row:not(.ct-group)').filter({ has: page.locator('.ct-dl') }).first();
    await expect(row).toBeVisible();
    const tracks = await row.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(tracks).toBe(2);
    const r = await row.boundingBox();
    const dl = await row.locator('.ct-dl').boundingBox();
    // Inside the 34px last track, not ~90px short of the edge.
    expect(r.x + r.width - (dl.x + dl.width)).toBeLessThan(34);
  });
});
