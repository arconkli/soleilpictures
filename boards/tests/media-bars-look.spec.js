// The bars over pictures, PDFs and clips in the toolbar look (the owner's
// pick "A · Islands"), shipped 2026-10-25 (lib/appHost.js): an image card's
// actions are the look's island over the picture, with its icons and glass
// tooltip; the PDF viewer's page and zoom are small islands of the look's
// icons, with the keys in their tooltips; the film's "on" is the look's gold
// tint and ring. Today's look keeps today's.
//
// On the real canvas, through ?local=1.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const look = (page, on) => page.addInitScript((v) => {
  try { window.localStorage.setItem('soleil.dev.toolbarLook', v); } catch (_) {}
}, on ? '1' : '0');
const SAMPLE_PDF = resolve(dirname(fileURLToPath(import.meta.url)), '../public/sample.pdf');
const clip = () => readFileSync(new URL('./fixtures/media/frames-vp9.mp4', import.meta.url)).toString('base64');

async function home(page, on) {
  await look(page, on);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('[data-card-id="home-image"]')).toBeVisible({ timeout: 30000 });
}

test('an image card\'s actions are the look\'s island: its icons, its corners, its tooltip', async ({ page }) => {
  await home(page, true);
  const card = page.locator('.canvas-wrap .card[data-card-id="home-image"]');
  await card.hover();
  const strip = card.locator('.ic-actions');
  await expect(strip).toHaveCSS('opacity', '1');
  await expect(strip).toHaveCSS('border-radius', '10px');
  const dl = strip.getByRole('button', { name: 'Download', exact: true });
  await expect(dl).not.toHaveAttribute('title', /.*/);
  // The look's icon (a Phosphor drawing, 256 wide), not the old 14-wide one.
  await expect(dl.locator('svg')).toHaveAttribute('viewBox', '0 0 256 256');
  // 26px on the card, which scales with the canvas's zoom.
  expect(await dl.evaluate((el) => [el.offsetWidth, el.offsetHeight])).toEqual([26, 26]);
  await dl.hover();
  await expect(page.locator('.tl-tip')).toContainText('Download');
});

test('today\'s look keeps today\'s image actions', async ({ page }) => {
  await home(page, false);
  const strip = page.locator('.canvas-wrap .card[data-card-id="home-image"] .ic-actions');
  const titles = await strip.getByRole('button').evaluateAll((els) => els.map((el) => el.title));
  expect(titles).toEqual(['Edit photo', 'Download', 'View full size']);
  await expect(strip.getByRole('button', { name: 'Download' }).locator('svg')).toHaveAttribute('viewBox', '0 0 14 14');
});

async function pdfViewer(page) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    (async () => {
      await page.getByRole('button', { name: 'Add menu', exact: true }).click();
      await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    })(),
  ]);
  await chooser.setFiles(SAMPLE_PDF);
  await expect(page.locator('.pdfc').first()).toBeVisible({ timeout: 15000 });
  await page.locator('.pdfc .ic-expand').first().click();
  const viewer = page.locator('.pdfv[role="dialog"]');
  await expect(viewer.locator('.pdfv-page canvas').first()).toBeVisible({ timeout: 15000 });
  return viewer;
}

test('the PDF viewer\'s page and zoom are islands of the look\'s icons, the keys in their tooltips', async ({ page }) => {
  await home(page, true);
  const viewer = await pdfViewer(page);
  for (const name of ['Previous page', 'Next page', 'Zoom out', 'Zoom in', 'Close']) {
    const b = viewer.getByRole('button', { name, exact: true });
    await expect(b.locator('svg'), name).toHaveCount(1);
    await expect(b, name).toHaveText('');
  }
  await expect(viewer.locator('.pdfv-zoom')).toHaveCSS('border-radius', '10px');
  const next = viewer.getByRole('button', { name: 'Next page', exact: true });
  await expect(next).toHaveAttribute('aria-keyshortcuts', 'ArrowDown');
  await next.hover();
  await expect(page.locator('.tl-tip')).toContainText('Next page');
  await expect(page.locator('.tl-tip .tl-keys')).toHaveText('↓');
  // It still pages, and Close still closes.
  await expect(viewer.locator('.pdfv-pageind')).toHaveText(/^1 \//);
  await next.click();
  await expect(viewer.locator('.pdfv-pageind')).toHaveText(/^2 \//);
  await viewer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(viewer).toHaveCount(0);
});

test('today\'s look keeps the PDF bar\'s glyphs and titles', async ({ page }) => {
  await home(page, false);
  const viewer = await pdfViewer(page);
  await expect(viewer.getByRole('button', { name: 'Next page', exact: true })).toHaveText('↓');
  await expect(viewer.getByRole('button', { name: 'Zoom in', exact: true })).toHaveAttribute('title', 'Zoom in');
  await expect(viewer.getByRole('button', { name: 'Close', exact: true })).toHaveText('×');
});

test('the review player\'s Loop, on, wears the look\'s gold tint and ring', async ({ page }) => {
  await home(page, true);
  await page.evaluate((data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    const media = { fps: [24, 1], frames: 48, dur: 2, w: 64, h: 36, probed: 1 };
    window.__soleilVideoLive.addVideo({ id: 'v-look', src: url, fileName: 'frames.mp4', x: 700, y: 500, w: 480, h: 270, media });
  }, clip());
  const card = page.locator('[data-card-id="v-look"]');
  await expect(card.locator('.film--compact video')).toHaveCount(1);
  await card.hover();
  await card.getByRole('button', { name: 'Open in the review player' }).click();
  const review = page.locator('.frv');
  await expect(review).toBeVisible();
  const loop = review.getByRole('button', { name: 'Loop' });
  await loop.click();
  await expect(loop).toHaveAttribute('aria-pressed', 'true');
  // Once its transition has run.
  await expect.poll(() => loop.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(255, 165, 0, 0.14)');
  await expect.poll(() => loop.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(245, 245, 247)');
  expect(await loop.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('rgba(255, 165, 0, 0.34)');
});
