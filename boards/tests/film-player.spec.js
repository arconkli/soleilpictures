// The film player (components/film/): compact controls on a video card, and
// the review player behind ⤢. Frame accuracy is checked against the picture
// itself — tests/fixtures/media/frames-vp9.mp4 paints frame N at luma 16+3N —
// so "frame 5" means the fifth frame is what's on screen, not just what the
// counter says. Driven through the ?local=1 harness.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = (name) => readFileSync(new URL(`./fixtures/media/${name}`, import.meta.url)).toString('base64');

async function go(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => {
    try { localStorage.removeItem('soleil.files.dock'); localStorage.setItem('soleil.files.dockHint', '1'); localStorage.removeItem('soleil.player.tcMode'); } catch (_) {}
    window.history.replaceState(null, '', '/?local=1');
  });
  await page.reload();
  await expect(page.locator('.rail-brand')).toBeVisible();
  await expect(page.locator('[data-card-id="home-note"]')).toBeVisible();
}

// A clip on the board. Without `media` it's a clip from before anything read
// its frame rate — the player reads it on first use.
async function addClip(page, id, media = null) {
  await page.evaluate(({ data, id, media }) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    window.__soleilVideoLive.addVideo({ id, src: url, fileName: 'frames.mp4', x: 700, y: 500, w: 480, h: 270, ...(media ? { media } : {}) });
  }, { data: fixture('frames-vp9.mp4'), id, media });
  await expect(page.locator(`[data-card-id="${id}"] .film--compact video`)).toHaveCount(1);
}

// Which fixture frame a <video> is showing, from its luma.
async function frameOnScreen(page, videoSel) {
  return page.locator(videoSel).first().evaluate((v) => {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0, 8, 8);
    const [r, g, b] = ctx.getImageData(4, 4, 1, 1).data;
    // BT.601 limited range back to Y′.
    const y = 16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255;
    return Math.round((y - 16) / 3);
  });
}

const MEDIA = { fps: [24, 1], frames: 48, dur: 2, w: 64, h: 36, probed: 1 };

test('a video card has frame controls instead of the browser’s', async ({ page }) => {
  await go(page);
  await addClip(page, 'vid-1', MEDIA);
  const card = page.locator('[data-card-id="vid-1"]');
  await expect(card.locator('video[controls]')).toHaveCount(0);
  await card.hover();
  const fwd = card.getByRole('button', { name: 'Forward one frame' });
  await expect(fwd).toBeVisible();
  for (let i = 0; i < 3; i++) await fwd.click();
  await expect(card.locator('.film-tc')).toHaveText('00:00:00:03');
  await expect.poll(() => frameOnScreen(page, '[data-card-id="vid-1"] video')).toBe(3);
  await card.getByRole('button', { name: 'Back one frame' }).click();
  await expect(card.locator('.film-tc')).toHaveText('00:00:00:02');
  // The buttons don't take focus from the board.
  await expect(card.getByRole('button', { name: 'Back one frame' })).not.toBeFocused();
});

test('a clip nobody has read yet learns its frame rate on first use', async ({ page }) => {
  await go(page);
  await addClip(page, 'vid-2');
  const card = page.locator('[data-card-id="vid-2"]');
  await card.hover();
  const fwd = card.getByRole('button', { name: 'Forward one frame' });
  await fwd.click();
  // Once the probe lands the counter is timecode at the clip's own rate.
  await expect(card.locator('.film-tc')).toHaveText(/^00:00:00:0\d$/);
  await fwd.click(); await fwd.click();
  await expect.poll(async () => {
    const tc = await card.locator('.film-tc').textContent();
    return Number(tc.split(':').pop()) === await frameOnScreen(page, '[data-card-id="vid-2"] video');
  }).toBe(true);
});

test('the review player steps frames, jumps to a typed timecode, and closes on Esc', async ({ page }) => {
  await go(page);
  await addClip(page, 'vid-3', MEDIA);
  const card = page.locator('[data-card-id="vid-3"]');
  await card.hover();
  await card.getByRole('button', { name: 'Open in the review player' }).click();
  const review = page.locator('.frv');
  await expect(review).toBeVisible();
  const tc = review.locator('.film-tc');
  // It opens playing; K stops, Home goes to the top.
  await page.keyboard.press('k');
  await page.keyboard.press('Home');
  await expect(tc).toHaveText('00:00:00:00');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(tc).toHaveText('00:00:00:05');
  await expect.poll(() => frameOnScreen(page, '.frv video.film-video')).toBe(5);
  await page.keyboard.press('Shift+ArrowRight');
  await expect(tc).toHaveText('00:00:01:05');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(tc).toHaveText('00:00:00:04');

  // Type a frame to jump to it.
  await tc.click();
  const input = review.locator('.film-tc-input');
  await input.fill('20');
  await input.press('Enter');
  await expect(review.locator('.film-tc')).toHaveText('00:00:00:20');
  await expect.poll(() => frameOnScreen(page, '.frv video.film-video')).toBe(20);

  // In and out.
  await page.keyboard.press('i');
  await expect(review.getByRole('button', { name: 'Set in point' })).toHaveClass(/is-set/);
  await page.keyboard.press('End');
  await expect(review.locator('.film-tc')).toHaveText('00:00:01:23');

  // Keys stay in the player: an arrow didn't nudge the card behind it.
  const before = await card.boundingBox();
  await page.keyboard.press('ArrowRight');
  expect(await card.boundingBox()).toEqual(before);

  await page.keyboard.press('Escape');
  await expect(review).toHaveCount(0);
});

test('Open in player is in the video’s right-click menu', async ({ page }) => {
  await go(page);
  await addClip(page, 'vid-4', MEDIA);
  await page.locator('[data-card-id="vid-4"]').click({ button: 'right', position: { x: 40, y: 40 } });
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Open in player' }).click();
  await expect(page.locator('.frv')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.frv')).toHaveCount(0);
});
