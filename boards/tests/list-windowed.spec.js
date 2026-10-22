// The List layout past 300 rows mounts only the rows near the viewport
// (ClusterTable), so a bulk import's Files open at once instead of freezing
// the tab; every row is still there to scroll to, to reach by keyboard and to
// select. Driven through the ?local=1 harness with tiny PNGs.
import { expect, test } from '@playwright/test';
import { openFullFiles } from './files-helpers.js';

// A 1×1 PNG, enough for the harness (it never uploads).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const N = 400;
const name = (k) => `DSC_${String(k).padStart(5, '0')}.png`;

const table = (page) => page.locator('.ct-table');
const row = (page, k) => table(page).locator('.ct-row', { has: page.locator('.ct-name', { hasText: name(k) }) });
const wrap = (page) => page.locator('.list-wrap:not(.is-panel)');

async function bigList(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.rail-brand')).toBeVisible();
  await openFullFiles(page);
  await page.locator('.list-wrap input[type="file"][multiple]')
    .setInputFiles(Array.from({ length: N }, (_, k) => ({ name: name(k), mimeType: 'image/png', buffer: PNG })));
  await page.getByRole('button', { name: 'List layout' }).click();
  await expect(table(page)).toHaveClass(/is-windowed/);
  await expect(row(page, 0)).toBeVisible();
}

test('a big List mounts a window of its rows and still says how many there are', async ({ page }) => {
  await bigList(page);
  const total = Number(await table(page).getAttribute('aria-rowcount'));
  expect(total).toBeGreaterThanOrEqual(N + 1);
  expect(await table(page).locator('.ct-row').count()).toBeLessThan(60);
  // Each mounted row knows its place among all of them; the header is row 1.
  await expect(table(page).locator('.ct-head')).toHaveAttribute('aria-rowindex', '1');
  const first = Number(await row(page, 0).getAttribute('aria-rowindex'));
  await expect(row(page, 1)).toHaveAttribute('aria-rowindex', String(first + 1));
});

test('scrolling to the end shows the last file in its place, with the scroll height of every row', async ({ page }) => {
  await bigList(page);
  const total = Number(await table(page).getAttribute('aria-rowcount'));
  const rowH = await row(page, 0).evaluate((el) => el.offsetHeight);
  const scrollHeight = await wrap(page).evaluate((el) => el.scrollHeight);
  expect(scrollHeight).toBeGreaterThanOrEqual((total - 1) * rowH);
  await wrap(page).evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(row(page, N - 1)).toBeVisible();
  await expect(row(page, N - 1)).toHaveAttribute('aria-rowindex', String(total));
  await expect(row(page, 0)).toHaveCount(0);
});

test('the keyboard reaches a row that was never mounted: ↑ with no cursor goes to the last file', async ({ page }) => {
  await bigList(page);
  await row(page, 3).click();
  await expect(row(page, N - 1)).toHaveCount(0);
  await page.keyboard.press('ArrowUp');
  await expect(row(page, N - 1)).toBeVisible();
  await expect(row(page, N - 1)).toHaveClass(/is-active/);
});

test('a range selection spans rows that were never mounted', async ({ page }) => {
  await bigList(page);
  await row(page, 2).click();
  await wrap(page).evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await row(page, N - 1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.list-selbar-count')).toHaveText(`${N - 2} selected`);
  await expect(row(page, N - 1)).toHaveClass(/is-selected/);
});
