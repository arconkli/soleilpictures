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

// ── The rebuilt review player ──────────────────────────────────────────────
async function openReview(page, id, extra = {}) {
  await page.evaluate(({ data, id, extra }) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    const media = { fps: [24, 1], frames: 48, dur: 2, w: 64, h: 36, probed: 1, ...(extra.audio ? { audio: { codec: 'mp4a', rate: 48000, ch: 2 } } : {}) };
    const versions = extra.versions ? {
      versions: [{ src: url, id: 'v1', n: 1, media }, { src: url, id: 'v2', n: 2, media, label: 'Cut 2' }], verId: 'v2',
    } : {};
    window.__soleilVideoLive.addVideo({ id, src: url, fileName: 'frames.mp4', x: 700, y: 500, w: 480, h: 270, media, ...versions });
  }, { data: fixture('frames-vp9.mp4'), id, extra });
  const card = page.locator(`[data-card-id="${id}"]`);
  await expect(card.locator('.film--compact video')).toHaveCount(1);
  await card.hover();
  await card.getByRole('button', { name: 'Open in the review player' }).click();
  await expect(page.locator('.frv')).toBeVisible();
  await page.keyboard.press('k');
  await page.keyboard.press('Home');
  await expect(page.locator('.frv .film-tc')).toHaveText('00:00:00:00');
  return page.locator('.frv');
}
const shown = '.frv video.film-video:not(.is-hidden)';

test('a click on the picture plays and pauses, with a flash', async ({ page }) => {
  await go(page);
  const review = await openReview(page, 'p-click');
  await review.locator('.film-stage').click({ position: { x: 200, y: 150 } });
  await expect(review.locator('.film-flash')).toHaveCount(1);
  await expect(review.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.waitForTimeout(600);
  await review.locator('.film-stage').click({ position: { x: 200, y: 150 } });
  await expect(review.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('J/K/L shows the shuttle speed, and K after J really stops', async ({ page }) => {
  await go(page);
  const review = await openReview(page, 'p-jkl');
  await page.keyboard.press('l'); await page.keyboard.press('l'); await page.keyboard.press('l');
  await expect(review.locator('.film-hud')).toHaveText('▶▶ 4×');
  await page.keyboard.press('k');
  await expect(review.locator('.film-hud')).toHaveCount(0);
  await page.keyboard.press('End');
  await page.keyboard.press('j');
  await expect(review.locator('.film-hud')).toHaveText('◀ 1×');
  await page.waitForTimeout(300);
  await page.keyboard.press('k');
  await expect(review.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(review.locator('.film')).not.toHaveClass(/is-playing/);
});

test('a held L doesn’t run the shuttle up to 8×', async ({ page }) => {
  await go(page);
  const review = await openReview(page, 'p-repeat');
  await page.keyboard.down('l');
  for (let i = 0; i < 6; i++) await page.keyboard.down('l');
  await page.keyboard.up('l');
  expect(await page.locator(shown).evaluate((v) => v.playbackRate)).toBe(1);
  await page.keyboard.press('k');
});

test('the speed menu: arrows move the menu not the frame, Esc closes only the menu, the speed sticks', async ({ page }) => {
  await go(page);
  const review = await openReview(page, 'p-speed');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(review.locator('.film-tc')).toHaveText('00:00:00:04');
  await review.getByRole('button', { name: /^Speed/ }).click();
  const menu = page.locator('.film-menu[role="menu"]');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(review.locator('.film-tc')).toHaveText('00:00:00:04');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: /^Speed/ }).click();
  await menu.getByRole('menuitemradio', { name: '0.5×' }).click();
  await page.keyboard.press('Space');
  await expect.poll(() => page.locator(shown).evaluate((v) => v.playbackRate)).toBe(0.5);
  await page.keyboard.press('k');
});

test('typing digits jumps to that frame', async ({ page }) => {
  await go(page);
  const review = await openReview(page, 'p-type');
  await page.keyboard.press('1');
  await expect(review.locator('.film-tc-input')).toBeFocused();
  await page.keyboard.press('2');
  await page.keyboard.press('Enter');
  await expect(review.locator('.film-tc')).toHaveText('00:00:00:12');
  await expect.poll(() => frameOnScreen(page, shown)).toBe(12);
  // Nonsense stays open and says what works.
  await page.keyboard.press('9');
  await page.keyboard.type('x');
  await page.keyboard.press('Enter');
  await expect(review.locator('.film-tc-input')).toHaveClass(/is-invalid/);
  await expect(review.locator('.film-tc-hint')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(review.locator('.film-tc-input')).toHaveCount(0);
  await expect(review).toBeVisible();
});

test('a range loop never runs past its out frame', async ({ page }) => {
  await go(page);
  const review = await openReview(page, 'p-loop');
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('i');
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('o');
  await expect(review.locator('.film-inout')).toContainText('11 fr');
  await page.keyboard.press('Alt+KeyL');
  await expect(review.getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  const seen = await page.evaluate(async (sel) => {
    const v = document.querySelector(sel);
    const c = document.createElement('canvas'); c.width = 8; c.height = 8;
    const ctx = c.getContext('2d');
    const out = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 2500) {
      await new Promise((r) => requestAnimationFrame(r));
      // Mid-seek there may be no decoded frame to draw (readyState 1): the
      // screen keeps the last picture, but drawImage reads nothing.
      if (v.seeking || v.readyState < 2) continue;
      ctx.drawImage(v, 0, 0, 8, 8);
      const [r, g, b] = ctx.getImageData(4, 4, 1, 1).data;
      out.push(Math.round(((16 + (65.481 * r + 128.553 * g + 24.966 * b) / 255) - 16) / 3));
    }
    return out;
  }, shown);
  await page.keyboard.press('k');
  expect(Math.max(...seen)).toBeLessThanOrEqual(21);
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(10);
  expect(new Set(seen).size).toBeGreaterThan(5);
});

test('⤢ from a card opens the review on the card’s frame, paused', async ({ page }) => {
  await go(page);
  await addClip(page, 'p-expand', MEDIA);
  const card = page.locator('[data-card-id="p-expand"]');
  await card.hover();
  const fwd = card.getByRole('button', { name: 'Forward one frame' });
  for (let i = 0; i < 9; i++) await fwd.click();
  await expect(card.locator('.film-tc')).toHaveText('00:00:00:09');
  await card.getByRole('button', { name: 'Open in the review player' }).click();
  const review = page.locator('.frv');
  await expect(review.locator('.film-tc')).toHaveText('00:00:00:09');
  await expect.poll(() => frameOnScreen(page, shown)).toBe(9);
  await expect(review.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('compare: \\ shows the other version on the same frame, and it plays', async ({ page }) => {
  await go(page);
  const review = await openReview(page, 'p-ab', { versions: true });
  await review.getByRole('button', { name: /Compare with another version/ }).click();
  await page.locator('.film-menu').getByRole('menuitemradio').first().click();
  await expect(review.locator('.film-ab')).toBeVisible();
  for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowRight');
  await expect(review.locator('.film-tc')).toHaveText('00:00:01:01');
  await page.keyboard.press('\\');
  await expect(review.locator('.film')).toHaveAttribute('data-side', 'B');
  await expect(review.locator('.film-side-badge')).toContainText('B');
  await expect.poll(() => frameOnScreen(page, shown)).toBe(25);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => frameOnScreen(page, shown)).toBe(26);
  await page.keyboard.press('\\');
  await expect(review.locator('.film')).toHaveAttribute('data-side', 'A');
  await expect.poll(() => frameOnScreen(page, shown)).toBe(26);
});

test('guides, the shortcut sheet, and a lazy hover preview', async ({ page }) => {
  await go(page);
  const review = await openReview(page, 'p-misc');
  await page.keyboard.press('g');
  await expect(review.locator('.film-guide')).toHaveCount(1);
  await expect(review.locator('.film-guide-label')).toHaveText('2.39:1');
  await page.keyboard.press('?');
  await expect(review.locator('.film-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(review.locator('.film-sheet')).toHaveCount(0);
  await expect(review).toBeVisible();
  await expect(review.locator('.ft-hover video')).toHaveCount(0);
  const track = review.locator('.ft--full .ft-track');
  const tb = await track.boundingBox();
  await page.mouse.move(tb.x + tb.width * 0.5, tb.y + tb.height / 2);
  await expect(review.locator('.ft-hover video')).toHaveCount(1);
  await expect(review.locator('.ft-hover')).toHaveClass(/is-on/);
});

test('a file that can’t be played says so', async ({ page }) => {
  await go(page);
  await page.evaluate(() => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(4096).fill(7)], { type: 'video/mp4' }));
    window.__soleilVideoLive.addVideo({ id: 'p-bad', src: url, fileName: 'broken.mov', x: 700, y: 500, w: 480, h: 270, media: { codec: 'apch', probed: 1 } });
  });
  const card = page.locator('[data-card-id="p-bad"]');
  await expect(card.locator('.film-error')).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('soleil-open-player', { detail: { boardId: document.querySelector('[data-board-id]')?.getAttribute('data-board-id'), cardId: 'p-bad' } })));
});

// ── The board card, Quick look, picture zoom, frame links ──────────────────
async function addPosteredClip(page, id) {
  await page.evaluate(({ data, id }) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    const c = document.createElement('canvas'); c.width = 64; c.height = 36;
    const g = c.getContext('2d'); g.fillStyle = '#334'; g.fillRect(0, 0, 64, 36);
    window.__soleilVideoLive.addVideo({ id, src: url, poster: c.toDataURL('image/png'), fileName: 'frames.mp4', x: 700, y: 500, w: 480, h: 270,
      media: { fps: [24, 1], frames: 48, dur: 2, w: 64, h: 36, probed: 1 } });
  }, { data: fixture('frames-vp9.mp4'), id });
  await expect(page.locator(`[data-card-id="${id}"] .vc-poster`)).toBeVisible();
}

test('a clip at rest is its poster and length — the player comes in on hover', async ({ page }) => {
  await go(page);
  await addPosteredClip(page, 'c-rest');
  const card = page.locator('[data-card-id="c-rest"]');
  await expect(card.locator('video')).toHaveCount(0);
  await expect(card.locator('.vc-dur')).toHaveText('0:02');
  await card.hover();
  await expect(card.locator('.film--compact video')).toHaveCount(1);
});

test('the first click selects a clip; the next one plays it; a double-click opens the review there', async ({ page }) => {
  await go(page);
  await addPosteredClip(page, 'c-click');
  const card = page.locator('[data-card-id="c-click"]');
  await card.hover();
  await expect(card.locator('.film--compact video')).toHaveCount(1);
  await card.click({ position: { x: 120, y: 80 } });
  await expect(card).toHaveClass(/is-selected/);
  expect(await card.locator('video').evaluate((v) => v.paused)).toBe(true);
  await page.waitForTimeout(400);
  await card.click({ position: { x: 120, y: 80 } });
  await expect.poll(() => card.locator('video').evaluate((v) => !v.paused)).toBe(true);
  await card.click({ position: { x: 120, y: 80 } });
  await expect.poll(() => card.locator('video').evaluate((v) => v.paused)).toBe(true);
  // Double-click: the review opens; no title editor on the card.
  await card.dblclick({ position: { x: 120, y: 80 } });
  await expect(page.locator('.frv')).toBeVisible();
  await expect(card.locator('.vc-title.editable [contenteditable="true"], .vc-title input')).toHaveCount(0);
});

test('closing the review leaves the card on the frame it left', async ({ page }) => {
  await go(page);
  const review = await openReview(page, 'c-sync');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  await expect(review.locator('.film-tc')).toHaveText('00:00:00:07');
  await page.keyboard.press('Escape');
  await expect(page.locator('.frv')).toHaveCount(0);
  const card = page.locator('[data-card-id="c-sync"]');
  await card.hover();
  await expect(card.locator('.film-tc')).toHaveText('00:00:00:07');
});

test('Z zooms the picture to 100%, Z again fits', async ({ page }) => {
  await go(page);
  const review = await openReview(page, 'c-zoom');
  await page.keyboard.press('z');
  await expect(review.locator('.film')).toHaveAttribute('data-zoom', /%$/);
  await expect(review.locator('.film-zoomwrap')).toHaveAttribute('style', /scale/);
  for (let i = 0; i < 3; i++) {
    if ((await review.locator('.film').getAttribute('data-zoom')) === 'fit') break;
    await page.keyboard.press('z');
  }
  await expect(review.locator('.film')).toHaveAttribute('data-zoom', 'fit');
});

test('copy a link to this frame', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await go(page);
  const review = await openReview(page, 'c-link');
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
  await expect(review.locator('.film-tc')).toHaveText('00:00:00:12');
  await page.keyboard.press('ControlOrMeta+Shift+KeyC');
  await expect(review.locator('.film-hud')).toContainText('Link to 00:00:00:12 copied');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/[?&]card=c-link/);
  expect(text).toMatch(/&t=0\.52[0-9]/);
});

test('Quick look plays a clip under its own bar; , steps; ← → still change files', async ({ page }) => {
  await go(page);
  await addClip(page, 'q-1', MEDIA);
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: 300 } });
  await page.keyboard.press('f');
  const tile = page.locator('.list-wrap.is-panel [data-item-id="q-1"]');
  await expect(tile).toBeVisible();
  await tile.click();
  await page.keyboard.press('Space');
  const ql = page.locator('.ql');
  await expect(ql.locator('.film--preview')).toBeVisible();
  await ql.locator('.film-pbar').hover();
  await page.keyboard.press('k');
  await expect(ql.locator('.film')).not.toHaveClass(/is-playing/);
  const before = await ql.locator('.film-pbar-tc span').first().textContent();
  await page.keyboard.press('.');
  await expect(ql.locator('.film-pbar-tc span').first()).not.toHaveText(before);
  const label = await ql.locator('.ql-meta').textContent();
  await page.keyboard.press('ArrowRight');
  await expect(ql.locator('.ql-meta')).not.toHaveText(label);
});

// ── Review fixes ───────────────────────────────────────────────────────────
test('a zoomed timeline you scroll while paused stays where you put it', async ({ page }) => {
  await go(page);
  const review = await openReview(page, 'r-pan');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Alt+Equal');
  const win = review.locator('.ft-ov-window');
  await expect(win).toBeVisible();
  const before = await win.getAttribute('style');
  const track = review.locator('.ft--full .ft-track');
  const tb = await track.boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  const after = await win.getAttribute('style');
  expect(after).not.toEqual(before);
  await page.waitForTimeout(500);
  expect(await win.getAttribute('style')).toEqual(after);
});

test('K while a range loops stays stopped', async ({ page }) => {
  await go(page);
  const review = await openReview(page, 'r-loopk');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('i');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('o');
  await page.keyboard.press('Alt+KeyL');
  await page.keyboard.press('Space');
  await page.waitForTimeout(900);
  await page.keyboard.press('k');
  await page.waitForTimeout(800);
  await expect(review.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  expect(await page.locator(shown).evaluate((v) => v.paused)).toBe(true);
});

test('stop comparing while showing B: A takes over on the same frame', async ({ page }) => {
  await go(page);
  const review = await openReview(page, 'r-ab', { versions: true });
  await review.getByRole('button', { name: /Compare with another version/ }).click();
  await page.locator('.film-menu').getByRole('menuitemradio').first().click();
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('\\');
  await expect(review.locator('.film')).toHaveAttribute('data-side', 'B');
  await review.getByRole('button', { name: /Comparing with/ }).click();
  await page.locator('.film-menu').getByRole('menuitem', { name: 'Stop comparing' }).click();
  await expect(review.locator('.film')).toHaveAttribute('data-side', 'A');
  await expect(review.locator('.film-ab')).toHaveCount(0);
  await expect.poll(() => frameOnScreen(page, shown)).toBe(15);
  await expect(review.locator('.film-tc')).toHaveText('00:00:00:15');
});

// ── UI and integration review fixes ────────────────────────────────────────
test('Quick look: its picture menu takes Esc and arrows; Space closes Quick look on a clip', async ({ page }) => {
  await go(page);
  await addClip(page, 'q-2', MEDIA);
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: 300 } });
  await page.keyboard.press('f');
  const tile = page.locator('.list-wrap.is-panel [data-item-id="q-2"]');
  await expect(tile).toBeVisible();
  await tile.click();
  await page.keyboard.press('Space');
  const ql = page.locator('.ql');
  await expect(ql.locator('.film--preview')).toBeVisible();
  const label = await ql.locator('.ql-meta').textContent();
  await ql.locator('.film-stage').click({ button: 'right', position: { x: 120, y: 80 } });
  const menu = page.locator('.film-menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect(ql.locator('.ql-meta')).toHaveText(label);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(ql).toBeVisible();
  // The clip autoplays; Space is still Quick look's.
  await page.keyboard.press('Space');
  await expect(page.locator('.ql')).toHaveCount(0);
});

test('switching versions while playing carries on from where it was', async ({ page }) => {
  await go(page);
  const review = await openReview(page, 'r-verplay', { versions: true });
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
  await review.getByRole('radio', { name: 'v1' }).click();
  await expect(review.getByRole('radio', { name: 'v1' })).toHaveAttribute('aria-checked', 'true');
  await expect(review.locator('.film')).toHaveClass(/is-playing/);
  await page.keyboard.press('k');
  await expect.poll(async () => Number((await review.locator('.film-tc').textContent()).split(':').pop())).toBeGreaterThan(6);
});

test('Open in player from the right-click menu starts where the card is', async ({ page }) => {
  await go(page);
  await addClip(page, 'c-ctx', MEDIA);
  const card = page.locator('[data-card-id="c-ctx"]');
  await card.hover();
  const fwd = card.getByRole('button', { name: 'Forward one frame' });
  for (let i = 0; i < 5; i++) await fwd.click();
  await expect(card.locator('.film-tc')).toHaveText('00:00:00:05');
  await card.click({ button: 'right', position: { x: 120, y: 60 } });
  await page.getByRole('menuitem', { name: 'Open in player' }).click();
  const review = page.locator('.frv');
  await expect(review).toBeVisible();
  await expect(review.locator('.film-tc')).toHaveText('00:00:00:05');
  await expect(review.locator('.film')).not.toHaveClass(/is-playing/);
});

test('a card resting on its poster follows the review it opened from Quick look, and keeps the frame', async ({ page }) => {
  await go(page);
  await addPosteredClip(page, 'c-follow');
  await page.mouse.move(5, 400);
  await page.keyboard.press('f');
  const tile = page.locator('.list-wrap.is-panel [data-item-id="c-follow"]');
  await expect(tile).toBeVisible();
  await tile.click();
  await page.keyboard.press('Space');
  const ql = page.locator('.ql');
  await expect(ql.locator('.film--preview')).toBeVisible();
  await ql.getByRole('button', { name: 'Player', exact: true }).click();
  const review = page.locator('.frv');
  await expect(review).toBeVisible();
  await page.keyboard.press('k');
  await page.keyboard.press('Home');
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
  await expect(review.locator('.film-tc')).toHaveText('00:00:00:09');
  await page.keyboard.press('Escape');
  await expect(review).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(ql).toHaveCount(0);
  const card = page.locator('[data-card-id="c-follow"]');
  await expect(card.locator('.film--compact .film-tc')).toHaveText('00:00:00:09');
  await page.waitForTimeout(5600);
  await expect(card.locator('.film--compact video')).toHaveCount(1);
  await expect(card.locator('.film-tc')).toHaveText('00:00:00:09');
});

test('menus close on a second press and keep their ticks live; the timecode field and volume give the keys back', async ({ page }) => {
  await go(page);
  const review = await openReview(page, 'r-ui', { audio: true });
  const speed = review.getByRole('button', { name: /^Speed/ });
  await speed.click();
  await expect(page.locator('.film-menu')).toBeVisible();
  await speed.click();
  await expect(page.locator('.film-menu')).toHaveCount(0);
  await review.getByRole('button', { name: 'Framing guides' }).click();
  const thirds = page.locator('.film-menu').getByRole('menuitemcheckbox', { name: 'Thirds' });
  await thirds.click();
  await expect(thirds).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('.film-menu')).toHaveCount(0);
  await expect(review).toBeVisible();
  // A jump that isn't one, then Esc: the field goes, the keys come back, and
  // the next jump starts without the old error.
  await page.keyboard.press('1');
  await expect(review.locator('.film-tc-input')).toBeFocused();
  await page.keyboard.type('x:y');
  await page.keyboard.press('Enter');
  await expect(review.locator('.film-tc-hint')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(review.locator('.film-tc-input')).toHaveCount(0);
  await expect(review).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(review.locator('.film-tc')).toHaveText('00:00:00:01');
  await page.keyboard.press('2');
  await expect(review.locator('.film-tc-input')).toBeVisible();
  await expect(review.locator('.film-tc-hint')).toHaveCount(0);
  // A transport button closes the field.
  await review.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(review.locator('.film-tc-input')).toHaveCount(0);
  await page.keyboard.press('k');
  await expect(review.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  // The volume slider doesn't keep the focus after a click.
  const slider = review.getByRole('slider', { name: 'Volume' });
  await slider.click();
  await expect(slider).not.toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(review.locator('.film-tc')).toHaveText('00:00:00:01');
});

