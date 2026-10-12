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

// The colour a token resolves to here, through a probe element.
async function tokenColor(page, token) {
  return page.evaluate((t) => {
    const probe = document.createElement('i');
    probe.style.color = `var(${t})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, token);
}

// A blank board with three loops on it: the whole cluster is an audio pack.
async function audioPack(page, opts = {}) {
  await go(page, { blank: true, ...opts });
  await page.waitForFunction(() => !!window.__soleilAudioLive);
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.__soleilAudioLive.addAudio({ x: 900 + i * 40, y: 500 + i * 40 });
  });
}

test('VS-FILES-03: the audio list Format column is set in --ink-2, like Time', async ({ page }) => {
  await audioPack(page);
  await openFullFiles(page);
  await page.getByRole('button', { name: 'List layout' }).click();
  const fmt = full(page).locator('.ct-row .ct-cell.ct-c-fmt').first();
  await expect(fmt).toBeVisible();
  const ink2 = await tokenColor(page, '--ink-2');
  expect(await fmt.evaluate((el) => getComputedStyle(el).color)).toBe(ink2);
});

test('VS-FILES-04: the focused Grid/List button shows a ring, and Tab reaches the folders and the files', async ({ page }) => {
  await go(page);
  await openFullFiles(page);
  const grid = full(page).getByRole('button', { name: 'Grid layout' });
  await expect(grid).toHaveClass(/\bon\b/);
  // Into the toolbar from the search field, then Tab to the on segment.
  await full(page).getByLabel('Search files in this cluster').focus();
  for (let i = 0; i < 6; i++) {
    if (await grid.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(grid).toBeFocused();
  expect(await grid.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');

  // Tab on: every folder is a stop, then exactly one file.
  const folders = await full(page).locator('[data-folder-id]').count();
  expect(folders).toBeGreaterThan(0);
  const seen = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const at = await page.evaluate(() => {
      const a = document.activeElement;
      return a?.dataset?.folderId ? 'folder' : a?.dataset?.itemId ? 'file' : null;
    });
    if (at) seen.push(at);
    if (at === 'file') break;
  }
  expect(seen.filter((s) => s === 'folder').length).toBe(folders);
  expect(seen.at(-1)).toBe('file');
  // Tabbing onto it puts the keyboard cursor there; ← → move focus with it.
  const first = full(page).locator('[data-item-id]:focus');
  await expect(first).toHaveClass(/is-active/);
  const id = await first.getAttribute('data-item-id');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => document.activeElement?.dataset?.itemId)).not.toBe(id);
  await expect(full(page).locator('[data-item-id]:focus')).toHaveClass(/is-active/);
  await expect(full(page).locator('[data-item-id][tabindex="0"]')).toHaveCount(1);
  // Space is still Quick look on the focused file.
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog', { name: /^Quick look/ })).toBeVisible();
});

test('VS-FILES-04: Enter on a focused folder opens it', async ({ page }) => {
  await go(page);
  await openFullFiles(page);
  const folder = full(page).locator('[data-folder-id]').first();
  const name = (await folder.locator('.ft-name').textContent()).trim();
  await folder.focus();
  await page.keyboard.press('Enter');
  await expect(full(page).getByRole('heading', { level: 1, name })).toBeVisible();
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
