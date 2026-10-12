// A video's own facts in Info — frame rate, codec, resolution, length, start
// timecode, audio — read from its container (lib/mediaProbe.js): at upload,
// and later for a clip that was uploaded before anything read them. Driven
// through the ?local=1 harness with the fixtures in tests/fixtures/media.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = (name) => readFileSync(new URL(`./fixtures/media/${name}`, import.meta.url));

async function go(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => {
    try { localStorage.removeItem('soleil.files.dock'); localStorage.setItem('soleil.files.dockHint', '1'); } catch (_) {}
    window.history.replaceState(null, '', '/?local=1');
  });
  await page.reload();
  await expect(page.locator('.rail-brand')).toBeVisible();
  await expect(page.locator('[data-card-id="home-note"]')).toBeVisible();
}

const drawer = (page) => page.locator('.cb-detail.is-drawer');
const row = (page, k) => drawer(page).locator('.cbd-meta-row', { has: page.locator('.cbd-meta-k', { hasText: new RegExp(`^${k}$`) }) });

test('a video added in Files knows its frame rate, codec, resolution and length', async ({ page }) => {
  await go(page);
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: 300 } });
  await page.keyboard.press('f');
  const panel = page.locator('.list-wrap.is-panel');
  await expect(panel).toBeVisible();
  await panel.locator('input[type="file"][multiple]').setInputFiles([
    { name: 'frames.mp4', mimeType: 'video/mp4', buffer: fixture('frames-vp9.mp4') },
  ]);
  const tile = panel.locator('.ct-jg [data-item-id]', { hasText: 'frames' });
  await expect(tile).toBeVisible();
  await tile.click({ button: 'right' });
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Get info' }).click();
  await expect(row(page, 'Frame rate').locator('.cbd-meta-v')).toHaveText('24 fps');
  await expect(row(page, 'Codec').locator('.cbd-meta-v')).toHaveText('VP9');
  await expect(row(page, 'Resolution').locator('.cbd-meta-v')).toHaveText('64 × 36');
  await expect(row(page, 'Duration').locator('.cbd-meta-v')).toHaveText('0:02');
  await expect(row(page, 'Size').locator('.cbd-meta-v')).toHaveText('2.3 KB');
  await expect(row(page, 'Audio').locator('.cbd-meta-v')).toHaveText('None');
});

test('a clip from before is read when Info opens — and that is not an edit', async ({ page }) => {
  await go(page);
  const b64 = fixture('df2997-tc.mov').toString('base64');
  await page.evaluate((data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/quicktime' }));
    window.__soleilVideoLive.addVideo({ id: 'vid-old', src: url, fileName: 'A001_C003.mov', x: 900, y: 650 });
  }, b64);
  const card = page.locator('[data-card-id="vid-old"]');
  await expect(card).toBeVisible();
  await card.click({ button: 'right' });
  await page.locator('.ctx-menu .ctx-item', { hasText: /^Info/ }).click();
  await expect(row(page, 'Frame rate').locator('.cbd-meta-v')).toHaveText('29.97 fps');
  await expect(row(page, 'Codec').locator('.cbd-meta-v')).toHaveText('ProRes 422 HQ');
  await expect(row(page, 'Start timecode').locator('.cbd-meta-v')).toHaveText('01:00:00;00');
  await expect(row(page, 'Audio').locator('.cbd-meta-v')).toHaveText('PCM · 48 kHz · Mono');
  await expect(row(page, 'Resolution').locator('.cbd-meta-v')).toHaveText('32 × 18');
  // Reading the file wrote its facts onto the card without making anyone its modifier.
  await expect(drawer(page).locator('.cbd-person', { hasText: 'Modified' })).toHaveCount(0);
  // Close and reopen: the facts stayed on the card.
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toHaveCount(0);
  await card.click();
  await page.keyboard.press('ControlOrMeta+i');
  await expect(row(page, 'Frame rate').locator('.cbd-meta-v')).toHaveText('29.97 fps');
});
