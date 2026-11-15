// A photo's Download on an iPhone or iPad opens the share sheet, where Save
// Image puts it in Photos (lib/photoSave.js); <a download> there only reaches
// Files > Downloads. Android keeps the download. When the share is refused
// because the tap's permission ran out while the photo was fetched, a toast
// offers Save, and that tap shares the same file.
import { expect, test } from '@playwright/test';

const IOS = ['mobile-safari', 'tablet'];
const iosOnly = (testInfo) => test.skip(!IOS.includes(testInfo.project.name), 'iPhone and iPad only');

const menu = (page) => page.locator('.ctx-menu');

// navigator.share / canShare replaced by a recorder. `refuseFirst`: the first
// share is refused the way iOS refuses one made outside a tap.
async function stubShare(page, { refuseFirst = false } = {}) {
  await page.addInitScript((refuse) => {
    window.__shares = [];
    let refuseNext = refuse;
    const share = (data) => {
      window.__shares.push((data?.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })));
      if (refuseNext) { refuseNext = false; return Promise.reject(new DOMException('x', 'NotAllowedError')); }
      return Promise.resolve();
    };
    const canShare = (data) => !!data?.files?.length;
    Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: canShare });
  }, refuseFirst);
}

async function openPhoto(page) {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('[data-card-id="home-image"]')).toBeVisible({ timeout: 30000 });
  // What only the dev harness draws, over the corner a menu opens in.
  await page.addStyleTag({ content: '.twk-gear { display: none !important; }' });
  await page.waitForTimeout(600);
  const b = await page.locator('[data-card-id="home-image"]').boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height - 6);
  await page.locator('.sel-menu .card-menu-btn').tap();
  await menu(page).getByRole('menuitem', { name: 'View full size', exact: true }).tap();
  await expect(page.locator('.lightbox-img')).toBeVisible();
}

// What lib/device.js reads to call a device iOS: an iPhone or iPad user
// agent, or a Mac one with a touch screen (an iPad asking for desktop sites).
const isIOS = (page) => page.evaluate(() => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

const shares = (page) => page.evaluate(() => window.__shares);

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'phones and touch tablets');
});

test('on an iPhone or iPad, Download shares the photo as a file and downloads nothing', async ({ page }, testInfo) => {
  iosOnly(testInfo);
  await stubShare(page);
  await openPhoto(page);
  expect(await isIOS(page)).toBe(true);
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await page.locator('.lightbox-download').tap();
  await expect.poll(() => shares(page).then((s) => s.length)).toBe(1);
  const [files] = await shares(page);
  expect(files).toHaveLength(1);
  expect(files[0].type).toMatch(/^image\//);
  expect(files[0].size).toBeGreaterThan(0);
  expect(files[0].name).toMatch(/\.[a-z0-9]{2,5}$/i);
  await page.waitForTimeout(800);
  expect(await shares(page)).toHaveLength(1);
  expect(downloads).toBe(0);
  await expect(page.locator('.toast')).toHaveCount(0);
});

test('a share iOS refuses offers Save, and Save shares the same file', async ({ page }, testInfo) => {
  iosOnly(testInfo);
  await stubShare(page, { refuseFirst: true });
  await openPhoto(page);
  expect(await isIOS(page)).toBe(true);
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await page.locator('.lightbox-download').tap();
  const toast = page.locator('.toast', { hasText: 'Your photo is ready to save.' });
  await expect(toast).toBeVisible();
  expect(await shares(page)).toHaveLength(1);
  const save = toast.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeVisible();
  await save.tap();
  await expect.poll(() => shares(page).then((s) => s.length)).toBe(2);
  const [first, second] = await shares(page);
  expect(second).toEqual(first);
  expect(second).toHaveLength(1);
  expect(second[0].size).toBeGreaterThan(0);
  await page.waitForTimeout(600);
  expect(downloads).toBe(0);
});

test('on Android, Download downloads the photo and never shares', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome', 'Android only');
  await stubShare(page);
  await openPhoto(page);
  expect(await isIOS(page)).toBe(false);
  const download = page.waitForEvent('download');
  await page.locator('.lightbox-download').tap();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.[a-z0-9]{2,5}$/i);
  expect(await shares(page)).toHaveLength(0);
});
