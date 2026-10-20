// The sidebar's Files bar puts files waiting in Files on their cluster's board
// (ClusterSidebar putSelection → App putFilesOnBoard), driven through the
// sidebar's QA harness (?sidebarqa=1), whose onPutOnBoard records the call.
// The bar is two lines, as the bulk-import mockup drew it: how many and ✕,
// then one row of what to do with them.
import { expect, test } from '@playwright/test';

async function open(page, query = '') {
  await page.goto(`/?sidebarqa=1${query}`);
  await page.waitForSelector('[data-sidebarqa-ready]');
  await expect(page.locator('.sbf-block').first()).toBeVisible();
}
const calls = (page, fn) => page.evaluate((f) => window.__sidebarQa.calls.filter((c) => c.fn === f), fn);
const item = (page, key) => page.locator(`.sbf-files [data-sb-item="${key}"]`);
const bar = (page) => page.locator('.sbf-bulk');
const put = (page) => bar(page).getByRole('button', { name: 'Put on board' });

test('Put on board takes the selected files waiting in Files to their cluster, and lets go of the selection', async ({ page }) => {
  await open(page);
  // film-file-0 waits in Files; film-img-0 is on the board already.
  await item(page, 'film:film-file-0').click({ modifiers: ['ControlOrMeta'] });
  await item(page, 'film:film-img-0').click({ modifiers: ['ControlOrMeta'] });
  await expect(bar(page).locator('.sbf-bulk-count')).toHaveText('2 selected');
  await put(page).click();
  await expect.poll(async () => (await calls(page, 'putOnBoard')).length).toBe(1);
  const [call] = await calls(page, 'putOnBoard');
  expect(call.params).toEqual({ boardId: 'film', cardIds: ['film-file-0'] });
  await expect(bar(page)).toHaveCount(0);
});

test('nothing waiting in Files, no Put on board', async ({ page }) => {
  await open(page);
  await item(page, 'film:film-img-0').click({ modifiers: ['ControlOrMeta'] });
  await item(page, 'film:film-img-1').click({ modifiers: ['ControlOrMeta'] });
  await expect(bar(page).locator('.sbf-bulk-count')).toHaveText('2 selected');
  await expect(bar(page).getByRole('button', { name: 'Move…' })).toBeVisible();
  await expect(put(page)).toHaveCount(0);
  await bar(page).getByRole('button', { name: 'Clear selection' }).click();
  await expect(bar(page)).toHaveCount(0);
});

test('a cluster you can only view keeps its files in Files: no Put on board, as no Move…', async ({ page }) => {
  await open(page, '&viewonly=film');
  await item(page, 'film:film-file-0').click({ modifiers: ['ControlOrMeta'] });
  await expect(bar(page).locator('.sbf-bulk-count')).toHaveText('1 selected');
  await expect(bar(page).getByRole('button', { name: 'Copy…' })).toBeVisible();
  await expect(bar(page).getByRole('button', { name: 'Move…' })).toHaveCount(0);
  await expect(put(page)).toHaveCount(0);
});

test('when the put is refused, the selection stays and the bar says why', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__sidebarQa.putFails = 'Feature film is view-only for you.'; });
  await item(page, 'film:film-file-0').click({ modifiers: ['ControlOrMeta'] });
  await put(page).click();
  await expect(page.getByTestId('sbqa-toast')).toContainText('Feature film is view-only for you.');
  await expect(bar(page).locator('.sbf-bulk-count')).toHaveText('1 selected');
});

test('two lines: the count and ✕, then the actions in one row inside the card', async ({ page }) => {
  await open(page);
  await item(page, 'film:film-file-0').click({ modifiers: ['ControlOrMeta'] });
  const box = (loc) => loc.evaluate((el) => el.getBoundingClientRect().toJSON());
  const count = await box(bar(page).locator('.sbf-bulk-count'));
  const clear = await box(bar(page).getByRole('button', { name: 'Clear selection' }));
  const acts = await bar(page).locator('.sbf-bulk-acts .sbf-bulk-btn').evaluateAll((els) => els.map((el) => ({
    text: el.textContent, ...el.getBoundingClientRect().toJSON(),
  })));
  const card = await box(bar(page));
  expect(Math.abs((count.top + count.bottom) / 2 - (clear.top + clear.bottom) / 2)).toBeLessThan(2);
  expect(acts.map((a) => a.text)).toEqual(['Put on board', 'Move…', 'Copy…', 'Delete']);
  for (const a of acts) {
    expect(a.top).toBeGreaterThan(clear.bottom);
    expect(Math.abs(a.top - acts[0].top)).toBeLessThan(1);
    expect(a.left).toBeGreaterThanOrEqual(card.left);
    expect(a.right).toBeLessThanOrEqual(card.right);
  }

  // At the narrowest the files card goes, the row wraps inside it.
  await page.evaluate(() => window.__sidebarQa.setWidth(232));
  await expect.poll(async () => (await box(bar(page))).width).toBeLessThan(card.width);
  const narrow = await box(bar(page));
  const wrapped = await bar(page).locator('.sbf-bulk-acts .sbf-bulk-btn').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  for (const a of wrapped) {
    expect(a.left).toBeGreaterThanOrEqual(narrow.left);
    expect(a.right).toBeLessThanOrEqual(narrow.right);
  }
});
