// Files: defects from the 2026-10 platform audit (FILES-LIST-*), each pinned
// where only a real layout or a real event shows it. Driven through the
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

// Full Files at any width: on a phone the topbar's Files button carries a
// count in its name, and there's no room for the panel, so it opens full.
async function openFull(page) {
  if (page.viewportSize().width > 700) { await openFullFiles(page); return; }
  await page.getByRole('button', { name: /^Files/ }).click();
  await expect(full(page)).toBeVisible();
}

async function openPanel(page) {
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: 300 } });
  await page.keyboard.press('f');
  await expect(panel(page)).toBeVisible();
}

const panel = (page) => page.locator('.list-wrap.is-panel');
const full = (page) => page.locator('.list-wrap:not(.is-panel)');

// A 1×1 PNG, enough for the harness (it never uploads).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const pngs = (...names) => names.map((name) => ({ name, mimeType: 'image/png', buffer: PNG }));

// The bar fits when nothing in it spills: no sideways overflow in the pill, and
// its last button (×) ends inside the box it sits in.
async function expectSelbarFits(page, wrap, box) {
  const bar = wrap.locator('.list-selbar');
  await expect(bar).toBeVisible();
  expect(await bar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  expect(await wrap.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const clear = await bar.getByRole('button', { name: 'Clear selection' }).boundingBox();
  const pill = await bar.boundingBox();
  expect(clear.x + clear.width).toBeLessThanOrEqual(pill.x + pill.width + 0.5);
  expect(pill.x + pill.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
}

test('FILES-LIST-01: the selection bar fits the panel at its default width, Put on board included', async ({ page }) => {
  await go(page);
  await openPanel(page);
  // A dropped file waits off the board, so the bar offers Put on board too.
  await panel(page).locator('input[type="file"][multiple]').setInputFiles(pngs('waiting.png'));
  const tile = panel(page).locator('.ct-tile-name[title="waiting.png"]');
  await expect(tile).toBeVisible();
  await tile.click();
  const bar = panel(page).locator('.list-selbar');
  await expect(bar.getByRole('button', { name: 'Put on board' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Delete' })).toBeVisible();
  await expectSelbarFits(page, panel(page), await page.locator('.fdl-files').boundingBox());
});

test('FILES-LIST-01: full Files at phone width keeps the whole selection bar on screen', async ({ page }) => {
  await go(page, { width: 390, height: 844 });
  await openFull(page);
  await full(page).locator('input[type="file"][multiple]').setInputFiles(pngs('waiting.png'));
  const tile = full(page).locator('.ct-tile-name[title="waiting.png"]');
  await expect(tile).toBeVisible();
  await tile.click();
  const bar = full(page).locator('.list-selbar');
  await expect(bar.getByRole('button', { name: 'Put on board' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Delete' })).toBeVisible();
  await expectSelbarFits(page, full(page), { x: 0, width: 390 });
});

test('FILES-LIST-02: opening a folder stops the loop that was playing', async ({ page }) => {
  await go(page);
  await page.waitForFunction(() => !!window.__soleilAudioLive);
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.__soleilAudioLive.addAudio({ x: 900 + i * 40, y: 500 + i * 40 });
  });
  await openFullFiles(page);
  await page.getByRole('button', { name: 'List layout' }).click();
  await full(page).locator('.ct-play').first().click();
  await expect(full(page).locator('.ct-row.is-playing')).toHaveCount(1);
  await page.waitForFunction(() => {
    const el = document.querySelector('audio[data-list-audio]');
    return el && !el.paused;
  });
  // The fixture is two seconds long: loop it, so only the move can stop it.
  await page.evaluate(() => { document.querySelector('audio[data-list-audio]').loop = true; });
  await full(page).locator('[data-folder-id]').first().dblclick();
  await expect(full(page).locator('.ct-play')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const el = document.querySelector('audio[data-list-audio]');
    return !el || el.paused;
  })).toBe(true);
});

test('FILES-LIST-03: a search that matches nothing does not wipe the Tempo sort', async ({ page }) => {
  // A blank board, so the three loops are the whole cluster: an audio pack.
  await go(page, { blank: true });
  await page.waitForFunction(() => !!window.__soleilAudioLive);
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.__soleilAudioLive.addAudio({ x: 900 + i * 40, y: 500 + i * 40 });
  });
  await openFullFiles(page);
  await page.getByRole('button', { name: 'List layout' }).click();
  const tempo = full(page).getByRole('columnheader').filter({ has: page.getByRole('button', { name: 'BPM' }) });
  await tempo.getByRole('button').click();
  await expect(tempo).not.toHaveAttribute('aria-sort', 'none');
  const search = full(page).getByRole('searchbox', { name: 'Search files in this cluster' })
    .or(full(page).getByLabel('Search files in this cluster'));
  await search.fill('zzzz-nothing-matches');
  await expect(full(page).locator('.ct-play')).toHaveCount(0);
  await search.fill('');
  await expect(full(page).locator('.ct-play')).toHaveCount(3);
  await expect(tempo).not.toHaveAttribute('aria-sort', 'none');
});

test('FILES-LIST-04: a file deleted on the board leaves the Files selection', async ({ page }) => {
  await go(page);
  await openPanel(page);
  // Clicking a file beside the board flies the board to it and selects it there.
  const tile = panel(page).locator('.ct-tile:not(.is-unplaced)').first();
  await tile.click();
  const bar = panel(page).locator('.list-selbar');
  await expect(bar.locator('.list-selbar-count')).toHaveText('1 selected');
  const before = await panel(page).locator('.ct-tile').count();
  // The pointer over the canvas hands it the keyboard: Delete removes it there.
  const wrap = await page.locator('.canvas-wrap').boundingBox();
  await page.mouse.move(wrap.x + 40, wrap.y + wrap.height / 2);
  await page.keyboard.press('Delete');
  await expect(panel(page).locator('.ct-tile')).toHaveCount(before - 1);
  await expect(bar).toHaveCount(0);
});

// Parks a tile just behind the sticky toolbar, then asks for it the way the
// keyboard cursor and a reveal do (scrollIntoView, block: 'nearest'), and
// returns how far its top sits below the toolbar's bottom.
async function tileClearOfHead(wrap) {
  return wrap.evaluate((el) => {
    const head = el.querySelector('.lp-head, .cb-head');
    const tiles = [...el.querySelectorAll('.ct-tile')];
    const tile = tiles[Math.floor(tiles.length / 2)];
    const wrapTop = el.getBoundingClientRect().top;
    el.scrollTop += tile.getBoundingClientRect().top - wrapTop - 10;
    tile.scrollIntoView({ block: 'nearest' });
    return tile.getBoundingClientRect().top - head.getBoundingClientRect().bottom;
  });
}

test('FILES-LIST-05: the keyboard cursor never parks a tile under the sticky toolbar', async ({ page }) => {
  await go(page, { width: 1280, height: 640, blank: true });
  await openFullFiles(page);
  await full(page).locator('input[type="file"][multiple]').setInputFiles(
    pngs(...Array.from({ length: 40 }, (_, i) => `shot-${i}.png`)));
  await expect(full(page).locator('.ct-tile')).toHaveCount(40);
  expect(await tileClearOfHead(full(page))).toBeGreaterThanOrEqual(0);
  // And at the bottom, under the selection bar a selection brings up.
  await full(page).locator('.ct-tile').first().click();
  await expect(full(page).locator('.list-selbar')).toBeVisible();
  const clear = await full(page).evaluate((el) => {
    const bar = el.querySelector('.list-selbar');
    const tiles = [...el.querySelectorAll('.ct-tile')];
    const tile = tiles[Math.floor(tiles.length / 2)];
    el.scrollTop += tile.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom + 10;
    tile.scrollIntoView({ block: 'nearest' });
    return bar.getBoundingClientRect().top - tile.getBoundingClientRect().bottom;
  });
  expect(clear).toBeGreaterThanOrEqual(0);
});

test('FILES-LIST-X1: the phone bottom-nav + adds files in full Files, where no board is mounted', async ({ page }) => {
  await go(page, { width: 390, height: 844 });
  await openFull(page);
  await expect(page.locator('.canvas-wrap')).toHaveCount(0);
  // The harness hides its puck outside the canvas; the app's shows it on any
  // editable cluster and sends this event, which only the board answered.
  const chooser = page.waitForEvent('filechooser', { timeout: 4000 });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('soleil-mobile-add-card', { detail: { boardId: 'root' } })));
  const fc = await chooser;
  await fc.setFiles(pngs('from-plus.png'));
  await expect(full(page).locator('.ct-tile-name[title="from-plus.png"]')).toBeVisible();
});
