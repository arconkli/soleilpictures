// The admin Boards tab: the library of example boards the boards engine makes,
// the ones waiting for the owner's OK, and each board's downloadable shots.
//
// Drives the DEV-only fixture harness (?adminpreview=1): no auth, no network.
// showcase_library / showcase_decide / showcase_waiting answer from
// src/local/adminFixtures.js, which keeps decisions in a module Map, so an OK
// visibly moves a board for as long as the page stays open.

import { test, expect } from '@playwright/test';

const WAITING = 3;      // fixtures: three boards with status 'new'
const LIBRARY = 8;      // fixtures: eight OK'd, one skipped, one trashed
const FIRST_BOARD = '00000000-0000-4000-8000-000000000010'; // Afterglow: night exteriors look book

async function openTab(page, extra = '') {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`/admin?adminpreview=1&tab=boards${extra}`);
  return errors;
}

test('the Boards pill carries a badge for the boards waiting', async ({ page }) => {
  await openTab(page);
  const pill = page.getByRole('tab', { name: /Boards/ });
  await expect(pill.locator('.admin-tab-badge')).toHaveText(String(WAITING), { timeout: 20000 });
  await expect(pill.getByLabel(`${WAITING} waiting`)).toBeVisible();
});

test('the waiting panel lists the boards waiting, and OK moves one into the grid', async ({ page }) => {
  const errors = await openTab(page);
  await expect(page.getByText(`Waiting for your OK · ${WAITING}`)).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.ab-wcard')).toHaveCount(WAITING);
  await expect(page.locator('.ab-tile')).toHaveCount(LIBRARY);

  const title = 'Olive grove: a vineyard wedding board';
  const card = page.locator('.ab-wcard').filter({ hasText: title });
  await expect(card).toContainText('For /tools/free-mood-board-maker');
  await expect(card).toContainText('Passed every check');
  await card.getByRole('button', { name: 'OK', exact: true }).click();

  await expect(page.locator('.ab-wcard')).toHaveCount(WAITING - 1);
  await expect(page.locator('.ab-tile')).toHaveCount(LIBRARY + 1);
  await expect(page.locator('.ab-tile').filter({ hasText: title })).toHaveCount(1);
  await expect(page.locator('.toast-msg', { hasText: `OK’d “${title}”` })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Boards/ }).locator('.admin-tab-badge')).toHaveText(String(WAITING - 1));

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.ab-wcard')).toHaveCount(WAITING);
  await expect(page.locator('.ab-tile')).toHaveCount(LIBRARY);
  expect(errors).toEqual([]);
});

test('a cluster chip and the search both narrow the grid', async ({ page }) => {
  await openTab(page);
  await expect(page.locator('.ab-tile')).toHaveCount(LIBRARY, { timeout: 20000 });

  await page.getByRole('button', { name: /^Interiors/ }).click();
  await expect(page.locator('.ab-tile')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^Interiors/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^All/ }).click();
  await expect(page.locator('.ab-tile')).toHaveCount(LIBRARY);

  await page.getByRole('searchbox', { name: 'Search boards' }).fill('japandi');
  await expect(page.locator('.ab-tile')).toHaveCount(1);
  await expect(page.locator('.ab-tile')).toContainText('Quiet oak');

  await page.getByRole('searchbox', { name: 'Search boards' }).fill('zzzz-nothing');
  await expect(page.getByText('No boards match')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.ab-tile')).toHaveCount(LIBRARY);
});

test('opening a board shows its shots, downloads, and a Light/Dark switch', async ({ page }) => {
  const errors = await openTab(page);
  await page.locator('.ab-tile').filter({ hasText: 'Afterglow: night exteriors look book' })
    .getByRole('button', { name: 'Afterglow: night exteriors look book', exact: true }).click();

  await expect(page.locator('.ab-det')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('board')).toBe(FIRST_BOARD);
  await expect(page.getByRole('heading', { name: 'Afterglow: night exteriors look book' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in the app' })).toHaveAttribute('href', `/?to=b:${FIRST_BOARD}`);
  await expect(page.getByRole('link', { name: 'Open live ↗' })).toBeVisible();

  // The shots list: one row per full shot plus ONE row for the close-ups.
  const rows = page.locator('.ab-shots').first().locator('.ab-shot');
  await expect(rows).toHaveCount(9);
  await expect(page.getByText('Close-ups · 3')).toBeVisible();
  for (const link of await page.locator('.ab-shot a[download]').all()) {
    expect(await link.getAttribute('href')).toContain('dl=');
  }
  expect(await page.getByRole('link', { name: '↓ All (zip)' }).getAttribute('href')).toContain('dl=');

  // Close-ups expand into their own list.
  await page.getByRole('button', { name: 'Show close-ups' }).click();
  await expect(page.locator('#ab-closeups .ab-shot')).toHaveCount(3);

  // Light -> Dark changes the picture.
  const big = page.locator('.ab-big img');
  const light = await big.getAttribute('src');
  await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }).click();
  await expect.poll(() => big.getAttribute('src')).not.toBe(light);

  // Sections the engine recorded.
  await expect(page.getByRole('region', { name: 'Used on' })).toContainText('/tools/cinematography-lookbook');
  await expect(page.getByRole('region', { name: 'Engine check' })).toContainText('against the bar');
  await expect(page.getByRole('region', { name: 'Photo credits' })).toBeVisible();

  // Back to the grid drops ?board=.
  await page.getByRole('button', { name: '← Boards' }).click();
  await expect(page.locator('.ab-tile').first()).toBeVisible();
  expect(new URL(page.url()).searchParams.get('board')).toBeNull();
  expect(errors).toEqual([]);
});

test('?board=<id> opens the detail straight away', async ({ page }) => {
  await openTab(page, `&board=${FIRST_BOARD}`);
  await expect(page.locator('.ab-det')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'Afterglow: night exteriors look book' })).toBeVisible();
  await expect(page.locator('.ab-tile')).toHaveCount(0);
});

test('a waiting board can be OK’d from its detail', async ({ page }) => {
  await openTab(page, '&board=00000000-0000-4000-8000-000000000019');
  await expect(page.locator('.ab-det')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.ab-det-r')).toContainText('waiting for your OK');
  await page.locator('.ab-det-r').getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator('.ab-det-r')).toContainText('OK’d by you');
});

test('at phone width the page does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await openTab(page);
  await expect(page.locator('.ab-tile').first()).toBeVisible({ timeout: 20000 });

  const overflow = () => page.evaluate(() => {
    const ab = document.querySelector('.ab');
    const body = document.querySelector('.admin-body');
    const r = ab.getBoundingClientRect();
    return {
      doc: document.documentElement.scrollWidth - window.innerWidth,
      body: body.scrollWidth - body.clientWidth,
      tab: Math.round(r.right - window.innerWidth),
    };
  });
  const grid = await overflow();
  expect(grid.doc).toBeLessThanOrEqual(0);
  expect(grid.body).toBeLessThanOrEqual(0);
  expect(grid.tab).toBeLessThanOrEqual(0);

  await page.locator('.ab-tile').first().getByRole('button').first().click();
  await expect(page.locator('.ab-det')).toBeVisible();
  const detail = await overflow();
  expect(detail.doc).toBeLessThanOrEqual(0);
  expect(detail.body).toBeLessThanOrEqual(0);
  expect(detail.tab).toBeLessThanOrEqual(0);
});
