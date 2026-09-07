// Capture Mode — camera moves and takes.
//
// The unit tests own the vocabulary and the arithmetic. What can only be
// checked in a browser is that a SEQUENCE actually sequences: that each move
// resolves against the camera as it is when that move starts, that a take runs
// to its end without a later move stomping an earlier one, and that starting
// something new abandons what was running instead of two rAF loops fighting
// over the same transform.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const pose = (page) => page.evaluate(() => document.querySelector('.canvas')?.style.transform || '');

// Zoom, pulled out of the transform, so a move can be checked for direction
// rather than just "something changed".
const zoomOf = (t) => {
  const m = /scale\(([\d.]+)\)/.exec(t || '');
  return m ? Number(m[1]) : null;
};

async function boot(page) {
  await page.goto('/?local=1&reset=1&capture=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('html[data-capture-ready="1"]')).toHaveCount(1);
  await page.waitForTimeout(600);
}

const play = (page, detail) => page.evaluate((d) => {
  document.dispatchEvent(new CustomEvent('soleil-capture-camera', { detail: d }));
}, detail);

// Settle to a stable transform, so a later assertion isn't reading mid-tween.
async function settled(page) {
  let last = null;
  for (let i = 0; i < 40; i++) {
    const now = await pose(page);
    if (now && now === last) return now;
    last = now;
    await page.waitForTimeout(150);
  }
  return last;
}

test('a zero-duration move is a cut, not a tween', async ({ page }) => {
  await boot(page);
  const before = await pose(page);
  // Takes open with { ms: 0 } to set a starting pose. It must land immediately;
  // if it tweened, every take would begin with a slow drift from wherever the
  // camera happened to be sitting.
  await play(page, { moves: [{ type: 'zoom', by: 2, ms: 0 }] });
  await page.waitForTimeout(120);
  const after = await pose(page);
  expect(after).not.toBe(before);
  expect(zoomOf(after)).toBeGreaterThan(zoomOf(before) * 1.5);
});

test('zoom multiplies, and pan moves without changing zoom', async ({ page }) => {
  await boot(page);
  await play(page, { moves: [{ type: 'fit', ms: 0 }] });
  await page.waitForTimeout(200);
  const base = await pose(page);

  await play(page, { moves: [{ type: 'zoom', by: 1.8, ms: 300 }] });
  const zoomed = await settled(page);
  expect(zoomOf(zoomed)).toBeCloseTo(zoomOf(base) * 1.8, 1);

  await play(page, { moves: [{ type: 'pan', dx: 200, dy: 0, ms: 300 }] });
  const panned = await settled(page);
  expect(zoomOf(panned), 'a pan changed the zoom').toBeCloseTo(zoomOf(zoomed), 3);
  expect(panned).not.toBe(zoomed);
});

test('a take runs every move in order and finishes somewhere else', async ({ page }) => {
  await boot(page);
  await play(page, { moves: [{ type: 'zoom', by: 3, ms: 0 }] });
  await page.waitForTimeout(200);
  const start = await pose(page);

  // `reveal` opens tight, holds, then pulls back to fit over ~1.9s.
  await play(page, { take: 'reveal' });

  // It must still be moving partway through — a take that jumped straight to
  // its final pose would pass a naive before/after check.
  await page.waitForTimeout(1400);
  const mid = await pose(page);

  const end = await settled(page);
  expect(end).not.toBe(start);
  expect(end, 'the take never travelled — it cut to its end pose').not.toBe(mid);
  // Pulling back means ending wider than it opened.
  expect(zoomOf(end)).toBeLessThan(zoomOf(start));
});

test('a new move abandons a running take instead of fighting it', async ({ page }) => {
  await boot(page);
  await play(page, { take: 'sweep' });      // ~7s, plenty of runway
  await page.waitForTimeout(900);

  // Interrupt with a plain fit, the way pressing the HUD button would.
  await play(page, { target: 'fit', ms: 400 });
  const afterFit = await settled(page);

  // If the abandoned take were still running, the transform would keep moving
  // after the fit had settled.
  await page.waitForTimeout(1500);
  expect(await pose(page), 'the interrupted take was still driving the camera').toBe(afterFit);
});

test('the app reports a take’s own duration, so a script never hardcodes it', async ({ page }) => {
  await boot(page);
  const ms = await page.evaluate(() => window.__soleilCapture.takeMs('establish'));
  expect(ms).toBeGreaterThan(4000);
  expect(await page.evaluate(() => window.__soleilCapture.takeMs('nope'))).toBe(0);
});

test('the HUD offers takes and a record button', async ({ page }) => {
  await boot(page);
  const takeChip = page.locator('[aria-label^="Take:"]');
  await expect(takeChip).toHaveText(/None/);

  await takeChip.click();
  await expect(takeChip).not.toHaveText(/None/);

  // Chromium supports getDisplayMedia, so the button is live here. The label
  // changes once a take is armed, because the press then does more.
  const rec = page.locator('.capture-hud-rec');
  await expect(rec).toBeVisible();
  await expect(rec).toBeEnabled();
  await expect(rec).toHaveText(/Record/);
});

test('the Shot button saves a PNG, cropped to the framing guide', async ({ page, context }) => {
  await boot(page);

  // getDisplayMedia can't be granted headlessly, so stand in a stream from a
  // canvas at a known size. Everything downstream of the stream — the shutter,
  // the frame grab, the crop solve, the download — is the real path.
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 1000;
    const g = c.getContext('2d');
    g.fillStyle = '#123456'; g.fillRect(0, 0, 1600, 1000);
    // Keep it painting, or the captured stream has no frames.
    setInterval(() => { g.fillStyle = '#123456'; g.fillRect(0, 0, 1600, 1000); }, 100);
    navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(30);
  });

  await page.locator('[aria-label^="Framing guide"]').click();     // Off → 9:16
  const download = page.waitForEvent('download');
  await page.locator('.capture-hud-btn', { hasText: 'Shot' }).click();
  const file = await download;

  expect(file.suggestedFilename()).toMatch(/^soleil-shot-9x16-\d{8}-\d{6}\.png$/);

  // 1600×1000 cropped to 9:16 is height-limited: 1000 tall, 563 wide.
  const buf = readFileSync(await file.path());
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  expect(h).toBe(1000);
  expect(w).toBe(Math.round(1000 * 9 / 16));
});

test('the HUD takes itself out of the picture, and comes back', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.capture-hud')).toBeVisible();

  // The shutter attribute is what hides the tool during the grab. Assert the
  // RULE, since the grab itself is over in two frames.
  await page.evaluate(() => document.body.setAttribute('data-capture-shutter', '1'));
  await expect(page.locator('.capture-hud:visible')).toHaveCount(0);
  await expect(page.locator('.capture-mask:visible')).toHaveCount(0);

  await page.evaluate(() => document.body.removeAttribute('data-capture-shutter'));
  await expect(page.locator('.capture-hud')).toBeVisible();
});

test('an unknown take or a junk move is ignored rather than throwing', async ({ page }) => {
  await boot(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const before = await pose(page);

  await play(page, { take: 'does-not-exist' });
  await play(page, { moves: [{ type: 'nonsense' }, null, { type: 'fit', ms: 0 }] });
  await page.waitForTimeout(400);

  expect(errors).toEqual([]);
  // The one real move in that list still ran.
  expect(await pose(page)).not.toBe(before);
});
