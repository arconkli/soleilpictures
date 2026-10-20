// What the Files sidebar logs, driven through its QA harness (?sidebarqa=1):
// the real ClusterSidebar, whose analytics rows are caught on their way to the
// table. Each row says what was done and how it went, never a file's name or a
// search's words (EV.FILES_* in lib/analyticsEvents.js). Tab and cluster
// switches are counters on the session's summary, not rows of their own.
import { expect, test } from '@playwright/test';

async function open(page) {
  const rows = [];
  await page.route('**/rest/v1/analytics_events*', async (route) => {
    try {
      const body = route.request().postDataJSON();
      for (const r of Array.isArray(body) ? body : [body]) rows.push(r);
    } catch { /* non-JSON */ }
    await route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });
  await page.goto('/?sidebarqa=1');
  await page.waitForSelector('[data-sidebarqa-ready]');
  await expect(page.locator('.sbf-block').first()).toBeVisible();
  return rows;
}
// Hiding the tab sends the queue at once, with the session's summary.
const hide = (page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
const props = (rows, name) => rows.filter((r) => r.event === name).map((r) => r.props || {});
const pick = (keys) => (list) => list.map((p) => Object.fromEntries(keys.map((k) => [k, p[k]])));
const filesRowsText = (rows) => JSON.stringify(rows.filter((r) => String(r.event).startsWith('files_')));
const FLUSH = { timeout: 15_000 };

const files = (page) => page.locator('.sbf-files');
const row = (page, name) => page.locator('.sb-tree-row', { hasText: name }).first();
const photoRows = (page, b = 'film') => files(page).locator(`[data-sb-item^="${b}:${b}-img-"]`);
const tab = (page, name) => files(page).getByRole('tab', { name, exact: true });
const toast = (page) => page.getByTestId('sbqa-toast');

test('opening a file logs how it opened and its kind, never its name; the rows are labelled as the harness\'s', async ({ page }) => {
  const rows = await open(page);
  await files(page).locator('.sbf-file', { hasText: 'film-take-1.mov' }).click();
  await expect(page.getByRole('dialog', { name: /Quick look: film-take-1\.mov/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await files(page).locator('.sbf-file', { hasText: 'film-selects.zip' }).dblclick();
  await expect(page.getByTestId('sbqa-log')).toContainText('show film/film-file-0 stored');
  await expect.poll(() => pick(['how', 'kind', 'view', 'searching'])(props(rows, 'files_open')), FLUSH).toEqual([
    { how: 'quick', kind: 'video', view: 'cluster', searching: false },
    { how: 'show', kind: 'file', view: 'cluster', searching: false },
  ]);
  expect(filesRowsText(rows)).not.toMatch(/film-take|film-selects/);
  // ?sidebarqa is a harness: its rows must never read as a person's.
  expect(props(rows, 'files_open').every((p) => p.synthetic === true)).toBe(true);
});

test('a search is logged once, as it ends, by its length and its matches, never its words', async ({ page }) => {
  const rows = await open(page);
  await page.evaluate(() => window.__sidebarQa.setActive('loc'));
  const input = files(page).locator('.sbf-search input');
  await input.fill('permit');
  await expect(files(page).locator('.sbf-file', { hasText: 'loc-permit-1.pdf' })).toBeVisible();
  await files(page).locator('.sbf-search-clear').click();
  await input.fill('zzz nothing');
  await expect(files(page).locator('.sbf-files-empty')).toContainText('Nothing in Locations matches');
  await input.press('Enter');
  await expect(page.getByTestId('sbqa-log')).toContainText('palette "zzz nothing"');
  await expect.poll(() => pick(['q_len', 'ended', 'view'])(props(rows, 'files_search')), FLUSH).toEqual([
    { q_len: 6, ended: 'cleared', view: 'cluster' },
    { q_len: 11, ended: 'palette', view: 'cluster' },
  ]);
  const [found, none] = props(rows, 'files_search');
  expect(found.results_n).toBeGreaterThan(0);
  expect(none.results_n).toBe(0);
  expect(filesRowsText(rows)).not.toMatch(/permit|zzz/);
});

test('a file opened from a search ends the search as opened, and says it came from one', async ({ page }) => {
  const rows = await open(page);
  await page.evaluate(() => window.__sidebarQa.setActive('loc'));
  await files(page).locator('.sbf-search input').fill('permit');
  const hit = files(page).locator('.sbf-file', { hasText: 'loc-permit-1.pdf' });
  await expect(hit).toBeVisible();
  await hit.dblclick();
  await expect.poll(() => pick(['ended'])(props(rows, 'files_search')), FLUSH).toEqual([{ ended: 'opened' }]);
  expect(pick(['how', 'searching'])(props(rows, 'files_open'))).toEqual([{ how: 'show', searching: true }]);
});

test('starring logs whether it went on, for a file and for a cluster', async ({ page }) => {
  const rows = await open(page);
  const file = files(page).locator('.sbf-file', { hasText: 'film-take-2.mov' }).first();
  await file.click({ button: 'right' });
  await page.locator('.ctx-menu').last().getByText('Star', { exact: true }).click();
  await expect(file.locator('.sbf-star-mark')).toBeVisible();
  await file.click({ button: 'right' });
  await page.locator('.ctx-menu').last().getByText('Unstar', { exact: true }).click();
  await expect(file.locator('.sbf-star-mark')).toHaveCount(0);
  // The fixture's Moodboards is starred already.
  await row(page, 'Moodboards').click({ button: 'right' });
  await page.locator('.ctx-menu').last().getByText('Unstar', { exact: true }).click();
  await expect.poll(() => pick(['on', 'what'])(props(rows, 'files_star')), FLUSH).toEqual([
    { on: true, what: 'file' }, { on: false, what: 'file' }, { on: false, what: 'cluster' },
  ]);
});

test('a move logs how it was asked for and what it did, and its Undo too', async ({ page }) => {
  const rows = await open(page);
  const photos = photoRows(page);
  await photos.nth(0).click({ modifiers: ['ControlOrMeta'] });
  await photos.nth(1).click({ modifiers: ['ControlOrMeta'] });
  await page.locator('.sbf-bulk-btn', { hasText: 'Move…' }).click();
  await expect(toast(page)).toContainText('Moved 2 photos to Moodboards');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => pick(['via', 'copy', 'n', 'done', 'outcome'])(props(rows, 'files_move')), FLUSH).toEqual([
    { via: 'bar', copy: false, n: 2, done: 2, outcome: 'ok' },
    { via: 'undo', copy: false, n: 2, done: undefined, outcome: 'ok' },
  ]);
});

test('a file dragged onto another cluster logs a drag; let go on its own cluster, that the rules refused it', async ({ page }) => {
  const rows = await open(page);
  await photoRows(page).first().dragTo(row(page, 'Moodboards'));
  await expect(toast(page)).toContainText('Moodboards');
  await photoRows(page).nth(1).dragTo(row(page, 'Feature film'));
  await expect.poll(() => pick(['via', 'n', 'outcome', 'reason', 'at'])(props(rows, 'files_move')), FLUSH).toEqual([
    { via: 'drag', n: 1, outcome: 'ok', reason: undefined, at: undefined },
    { via: 'drag', n: 1, outcome: 'refused', reason: 'same', at: 'tree' },
  ]);
});

test('a delete logs where it was asked from and how it went, and its Undo', async ({ page }) => {
  const rows = await open(page);
  await page.evaluate(() => { window.__sidebarQa.setLive(false); window.__sidebarQa.setActive('loc'); });
  await photoRows(page, 'loc').first().click({ modifiers: ['ControlOrMeta'] });
  await photoRows(page, 'loc').first().press('Delete');
  await expect(toast(page)).toContainText('Deleted 1 file from Locations');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => pick(['from', 'n', 'done', 'outcome', 'live', 'undo', 'ok'])(props(rows, 'files_delete')), FLUSH).toEqual([
    { from: 'key', n: 1, done: 1, outcome: 'ok', live: false, undo: undefined, ok: undefined },
    { from: undefined, n: undefined, done: undefined, outcome: undefined, live: undefined, undo: true, ok: true },
  ]);
});

test('tab switches and presses are counted on the session\'s summary, not logged one by one', async ({ page }) => {
  const rows = await open(page);
  await tab(page, 'Recent').click();
  await tab(page, 'Starred').click();
  await tab(page, 'Feature film').click();
  // A row of the session's own, so it has a summary to send.
  await files(page).locator('.sbf-file', { hasText: 'film-take-1.mov' }).click();
  await expect(page.getByRole('dialog', { name: /Quick look/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await hide(page);
  await expect.poll(() => props(rows, 'session_summary').length, FLUSH).toBeGreaterThan(0);
  const { counters } = props(rows, 'session_summary').at(-1);
  expect(counters).toMatchObject({ 'files.tab_recent': 1, 'files.tab_starred': 1, 'files.tab_cluster': 1 });
  expect(counters['input.mouse']).toBeGreaterThanOrEqual(4);
  expect(rows.some((r) => /^files_tab|^files_switch/.test(r.event))).toBe(false);
});
