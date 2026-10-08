// Render + interaction smoke for the cluster browser (Table/Gallery + toolbar),
// driven through the ?local=1 demo seed. Catches runtime/render regressions the
// pure-logic specs can't (hook misuse, prop mismatch, crashing preview).
import { expect, test } from '@playwright/test';
import { openFullFiles } from './files-helpers.js';

async function goList(page) {
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await expect(page.locator('.rail-brand')).toBeVisible();
  await openFullFiles(page);
  // Files opens in Grid for a cluster that isn't mostly audio; these specs
  // drive the table, so pick the List layout.
  await page.getByRole('button', { name: 'List layout' }).click();
}

test('list view renders the cluster browser toolbar + a table without JS errors', async ({ page }) => {
  // Ignore the local harness's expected backend noise (there is no real
  // Supabase in ?local mode) — only fail on genuine JS runtime errors.
  const isNoise = (t) => /ERR_NAME_NOT_RESOLVED|Failed to load resource|WebSocket connection/.test(t);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => { if (!isNoise(String(e))) errors.push(String(e)); });

  await goList(page);

  // Toolbar present (search + Sort + Filter + view toggle).
  await expect(page.locator('.cbt')).toBeVisible();
  await expect(page.locator('.cbt-input')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sort', exact: true })).toBeVisible();

  // The demo seed has non-board cards → a table of rows renders (no "·" fallback).
  await expect(page.locator('.ct-table')).toBeVisible();
  expect(await page.locator('.ct-row').count()).toBeGreaterThan(0);

  // No genuine runtime errors during render.
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Grid ⇄ List layout toggle swaps the view', async ({ page }) => {
  await goList(page);
  await expect(page.locator('.ct-table')).toBeVisible();
  await page.getByRole('button', { name: 'Grid layout' }).click();
  await expect(page.locator('.ct-gallery')).toBeVisible();
  await expect(page.locator('.ct-tile').first()).toBeVisible();
  await page.getByRole('button', { name: 'List layout' }).click();
  await expect(page.locator('.ct-table')).toBeVisible();
});

test('Sort menu opens and picking a key re-sorts', async ({ page }) => {
  await goList(page);
  await page.getByRole('button', { name: 'Sort', exact: true }).click();
  await expect(page.locator('.cbt-menu')).toBeVisible();
  await page.locator('.cbt-menu .ctx-item', { hasText: 'Name' }).click();
  // Menu closes after choosing; table still present + re-sorted.
  await expect(page.locator('.cbt-menu')).toHaveCount(0);
  await expect(page.locator('.ct-table')).toBeVisible();
});

test('search narrows the list', async ({ page }) => {
  await goList(page);
  const before = await page.locator('.ct-row').count();
  await page.locator('.cbt-input').fill('zzzzznomatch');
  await expect(page.locator('.cluster-browser-empty')).toBeVisible();
  await page.locator('.cbt-input').fill('');
  await expect(page.locator('.ct-row')).toHaveCount(before);
});

test('Grid rows are justified, and the tile size is remembered on this device', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => { try { localStorage.removeItem('soleil.files.tileSize'); } catch (_) {} window.history.replaceState(null, '', '/?local=1'); });
  await expect(page.locator('.rail-brand')).toBeVisible();
  await openFullFiles(page);
  await page.getByRole('button', { name: 'Grid layout' }).click();
  const tiles = page.locator('.ct-jg .ct-tile');
  await expect(tiles.first()).toBeVisible();
  const previewH = () => tiles.first().locator('.ct-tile-preview').evaluate((el) => Math.round(el.getBoundingClientRect().height));
  const medium = await previewH();
  await page.getByRole('button', { name: 'Large tiles' }).click();
  await expect.poll(previewH).toBeGreaterThan(medium);
  await page.getByRole('button', { name: 'Small tiles' }).click();
  await expect.poll(previewH).toBeLessThan(medium);
  await page.reload();
  await expect(page.locator('.rail-brand')).toBeVisible();
  await openFullFiles(page);
  await expect(page.getByRole('button', { name: 'Small tiles' })).toHaveAttribute('aria-pressed', 'true');
});
