// The board's ground drawn on a canvas in step with the camera, and a mouse
// wheel's zoom that glides (lib/canvasGround.js, CanvasSurface drawGround and
// glideFrame). Held: on for the preview deploy, on dev only behind
// localStorage soleil.dev.boardGround = '1', which these tests set. Runs on the
// ?local=1 harness, which mounts the real CanvasSurface.
import { expect, test } from '@playwright/test';

const FLAG = 'soleil.dev.boardGround';

async function boot(page, { ground = true, blank = false } = {}) {
  await page.addInitScript(([k, on]) => {
    try { if (on) localStorage.setItem(k, '1'); else localStorage.removeItem(k); } catch (_) { /* storage off */ }
  }, [FLAG, ground]);
  await page.goto(`/?local=1&reset=1${blank ? '&blank=1' : ''}`);
  await page.waitForSelector('.canvas-wrap');
  if (!blank) await page.waitForSelector('.canvas-wrap .card');
  await page.waitForTimeout(600);
}

// The camera as the cards show it (the .canvas transform) and as the ground was
// last drawn (data-camera, written in dev builds).
const cameras = (page) => page.evaluate(() => {
  const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(document.querySelector('.canvas')).transform || '');
  const p = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
  const g = (document.querySelector('.cnv-ground')?.dataset.camera || '').split(',').map(Number);
  return { cards: { x: p[4], y: p[5], z: p[0] }, ground: { x: g[0], y: g[1], z: g[2] } };
});
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test('the ground is a canvas under everything, and the box paints only its colour', async ({ page }) => {
  await boot(page);
  const wrap = page.locator('.canvas-wrap');
  await expect(wrap).toHaveClass(/has-ground/);
  expect(await wrap.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
  const ground = wrap.locator('> canvas.cnv-ground');
  await expect(ground).toHaveCount(1);
  expect(await ground.evaluate((el) => el === el.parentElement.firstElementChild)).toBe(true);
  expect(await ground.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  // Sized to the canvas at the screen's density, and actually drawn.
  const size = await ground.evaluate((el) => [el.width, el.height, el.parentElement.clientWidth, el.parentElement.clientHeight, devicePixelRatio]);
  expect(size[0]).toBe(Math.round(size[2] * size[4]));
  expect(size[1]).toBe(Math.round(size[3] * size[4]));
  const inked = await ground.evaluate((el) => {
    const d = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n += 1;
    return n;
  });
  expect(inked).toBeGreaterThan(1000);
});

test('a wheel pan moves the ground in the same frame as the cards, before the camera is saved', async ({ page }) => {
  await boot(page);
  const box = await page.locator('.canvas-wrap').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await cameras(page);
  await page.mouse.wheel(37, 23);
  await nextFrame(page);
  const after = await cameras(page);
  expect(after.cards.x).not.toBe(before.cards.x);
  expect(after.ground.x).toBeCloseTo(after.cards.x, 3);
  expect(after.ground.y).toBeCloseTo(after.cards.y, 3);
  expect(after.ground.z).toBeCloseTo(after.cards.z, 5);
});

test("a mouse wheel's click glides to its zoom and lands on it; the ground rides along", async ({ page }) => {
  await boot(page);
  const box = await page.locator('.canvas-wrap').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const a = await cameras(page);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  await nextFrame(page);
  const mid = await cameras(page);
  const target = a.cards.z * Math.exp(-100 * 0.0025);
  // Part of the way after a frame or two: not still, not already there.
  expect(mid.cards.z).toBeLessThan(a.cards.z);
  expect(mid.cards.z).toBeGreaterThan(target + 1e-4);
  expect(mid.ground.z).toBeCloseTo(mid.cards.z, 4);
  await page.waitForTimeout(400);
  const end = await cameras(page);
  expect(end.cards.z).toBeCloseTo(target, 4);
  expect(end.ground.z).toBeCloseTo(end.cards.z, 5);
  // The point under the pointer stayed under it.
  const cx = box.width / 2, cy = box.height / 2;
  const wx = (cx - a.cards.x) / a.cards.z, wy = (cy - a.cards.y) / a.cards.z;
  expect(end.cards.x + wx * end.cards.z).toBeCloseTo(cx, 0);
  expect(end.cards.y + wy * end.cards.z).toBeCloseTo(cy, 0);
});

test('a trackpad pinch (small fractional steps) zooms at once, without a glide', async ({ page }) => {
  await boot(page);
  const box = await page.locator('.canvas-wrap').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const a = await cameras(page);
  await page.evaluate(([x, y]) => {
    document.querySelector('.canvas-wrap').dispatchEvent(new WheelEvent('wheel', {
      deltaY: 6.5, ctrlKey: true, bubbles: true, cancelable: true, clientX: x, clientY: y,
    }));
  }, [box.x + box.width / 2, box.y + box.height / 2]);
  const b = await cameras(page);
  expect(b.cards.z).toBeCloseTo(a.cards.z * Math.exp(-6.5 * 0.0025), 5);
});

test('an eased zoom (⌘=) carries the ground along mid-transition', async ({ page }) => {
  await boot(page);
  const a = await cameras(page);
  await page.keyboard.press('ControlOrMeta+Equal');
  await page.waitForTimeout(80);
  const mid = await cameras(page);
  expect(mid.cards.z).toBeGreaterThan(a.cards.z + 1e-3);
  expect(mid.cards.z).toBeLessThan(a.cards.z * 1.25 - 1e-3);
  expect(mid.ground.z).toBeCloseTo(mid.cards.z, 2);
  await page.waitForTimeout(400);
  const end = await cameras(page);
  expect(end.cards.z).toBeCloseTo(a.cards.z * 1.25, 3);
  expect(end.ground.z).toBeCloseTo(end.cards.z, 5);
});

test('the ground stays drawn through every frame of a resize (the sidebar dragged, the window resized)', async ({ page }) => {
  await boot(page);
  const frames = await page.evaluate(() => new Promise((done) => {
    const wrap = document.querySelector('.canvas-wrap');
    const cv = document.querySelector('.cnv-ground');
    const g = cv.getContext('2d');
    const w0 = wrap.getBoundingClientRect().width;
    const out = [];
    // After each frame's paint (a task queued from rAF runs after it): is the ground still there?
    const mc = new MessageChannel();
    mc.port1.onmessage = () => {
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 3; i < d.length && n <= 50; i += 4) if (d[i]) n += 1;
      out.push(n > 50);
    };
    let i = 0;
    const step = () => {
      if (i < 20) wrap.style.width = `${w0 - 4 * (++i)}px`;
      mc.port2.postMessage(0);
      if (out.length < 24) requestAnimationFrame(step); else { wrap.style.width = ''; done(out); }
    };
    requestAnimationFrame(step);
  }));
  expect(frames.filter((drawn) => !drawn)).toHaveLength(0);
});

test('a zoom you ask for mid-glide (⌘0, the zoom buttons) wins over the glide', async ({ page }) => {
  await boot(page);
  const box = await page.locator('.canvas-wrap').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  await page.waitForTimeout(30);
  await page.keyboard.press('ControlOrMeta+0');
  await page.waitForTimeout(600);
  expect((await cameras(page)).cards.z).toBeCloseTo(1, 4);
});

test("small zoom steps that arrive mid-glide join it instead of fighting it", async ({ page }) => {
  await boot(page);
  const box = await page.locator('.canvas-wrap').boundingBox();
  const at = [box.x + box.width / 2, box.y + box.height / 2];
  const a = await cameras(page);
  const zooms = await page.evaluate(([x, y]) => new Promise((done) => {
    const wrap = document.querySelector('.canvas-wrap');
    const fire = (dy) => wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true, clientX: x, clientY: y }));
    const read = () => Number(/matrix\(([^)]+)\)/.exec(getComputedStyle(document.querySelector('.canvas')).transform)[1].split(',')[0]);
    const seen = [];
    fire(-100);
    let n = 0;
    const tick = () => {
      seen.push(read());
      if (n < 6) fire(-13.5);
      n += 1;
      if (n < 30) requestAnimationFrame(tick); else done(seen);
    };
    requestAnimationFrame(tick);
  }), at);
  // Every step in, never back out, and all of it counted.
  for (let i = 1; i < zooms.length; i++) expect(zooms[i]).toBeGreaterThanOrEqual(zooms[i - 1] - 1e-9);
  await page.waitForTimeout(300);
  expect((await cameras(page)).cards.z).toBeCloseTo(a.cards.z * Math.exp((100 + 6 * 13.5) * 0.0025), 3);
});

test("an empty board's ground stays put under its panel", async ({ page }) => {
  await boot(page, { blank: true });
  const g = await cameras(page);
  expect([g.ground.x, g.ground.y, g.ground.z]).toEqual([0, 0, 1]);
});

test('held off, the board keeps the CSS ground and the instant wheel zoom', async ({ page }) => {
  await boot(page, { ground: false });
  const wrap = page.locator('.canvas-wrap');
  await expect(wrap).not.toHaveClass(/has-ground/);
  await expect(wrap.locator('> canvas.cnv-ground')).toHaveCount(0);
  expect(await wrap.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('radial-gradient');
  const box = await wrap.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const a = await cameras(page);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  const b = await cameras(page);
  expect(b.cards.z).toBeCloseTo(a.cards.z * Math.exp(-100 * 0.0025), 4);
});
