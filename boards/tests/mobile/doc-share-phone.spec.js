// A doc shared on its own (DocShareView), on a phone, in the doc look as in
// its cluster (2026-10-27): the look's phone header (Pages, the title, ⋯),
// with no Close of its own, since the page around it has none to close; ⋯
// holds Comments and Find, and Comments is the sheet from the bottom, over
// the header too. Driven through ?fileshareqa=doc-* (src/local/
// FileShareQaHarness.jsx), the real page over an in-memory room.

import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone-width only (≤640px)');
});

async function open(page, fixture) {
  await page.goto(`/?fileshareqa=${fixture}`);
  await page.waitForSelector('[data-fileshareqa-ready]', { state: 'attached' });
  await expect(page.locator('.dsv')).toHaveAttribute('data-doc-share-phase', 'ready');
}
const head = (page) => page.locator('.dsv .dl-head');
const more = (page) => head(page).getByRole('button', { name: /^More/ });
const sheet = (page) => page.getByRole('complementary', { name: 'Comments and find' });
const menu = (page) => page.getByRole('menu', { name: 'More' });

test('to edit: the look’s phone header, with no Close of its own; ⋯ has no Messages', async ({ page }) => {
  await open(page, 'doc-edit');
  await expect(head(page)).toHaveClass(/is-phone/);
  await expect(head(page).locator('.dl-title')).toHaveValue('Pilot, revisions');
  await expect(head(page).getByRole('button', { name: 'Close document' })).toHaveCount(0);
  await more(page).tap();
  await expect(menu(page).getByRole('menuitem', { name: /^Comments/ })).toBeVisible();
  await expect(menu(page).getByRole('menuitem', { name: 'Find' })).toBeVisible();
  await expect(menu(page).getByRole('menuitem', { name: /^Messages/ })).toHaveCount(0);
  // Shared without "Allow exporting".
  await expect(menu(page).getByRole('menuitem', { name: 'Export' })).toHaveCount(0);
});

test('Comments is the sheet over the whole doc, header too', async ({ page }) => {
  await open(page, 'doc-edit');
  await page.evaluate(() => { const r = window.__fileShareQa.docRooms; r[r.length - 1].thread({}); });
  await more(page).tap();
  await menu(page).getByRole('menuitem', { name: /^Comments/ }).tap();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page)).toHaveClass(/is-sheet/);
  await expect(sheet(page).locator('.dl-th')).toContainText('Is it dawn already?');
  await sheet(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  // It lies in the shared doc's window, over its header (what's under the
  // sheet's top is the sheet).
  expect(await sheet(page).evaluate((el) => el.parentElement?.classList.contains('dsv'))).toBe(true);
  const box = await sheet(page).boundingBox();
  const hit = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.dl-panel'), { x: box.x + box.width / 2, y: box.y + 12 });
  expect(hit).toBe(true);
  // A tap on the dimmed doc puts it away.
  await page.mouse.click(box.x + box.width / 2, Math.max(4, box.y - 40));
  await expect(sheet(page)).toHaveCount(0);
});

test('to read: View only on the title’s line, and ⋯ has Find and the zoom but no Comments or Export', async ({ page }) => {
  await open(page, 'doc-view');
  await expect(head(page).locator('.dl-psub')).toHaveText('View only');
  await more(page).tap();
  await expect(menu(page).getByRole('menuitem', { name: 'Find' })).toBeVisible();
  await expect(menu(page).getByRole('group', { name: 'Zoom' })).toBeVisible();
  await expect(menu(page).getByRole('menuitem', { name: /^Comments/ })).toHaveCount(0);
  await expect(menu(page).getByRole('menuitem', { name: 'Export' })).toHaveCount(0);
});
