import { test, expect } from '@playwright/test';

// Guards the 15 Nov phone pinch-zoom rewrite (src/lib/touchCamera.js + the
// native pointer listeners in CanvasSurface.jsx): the board point under the
// fingers stays under them, two fingers pan 1:1, the remaining finger keeps
// panning after one lifts, the soft wall at 10% / 500% stretches and glides
// back, and a second finger on a card belongs to the camera.
// Chromium only: the fingers are scripted through CDP Input.dispatchTouchEvent,
// which WebKit has no equivalent of.
test.use({ hasTouch: true, isMobile: true });
test.setTimeout(120000);

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP multi-touch is Chromium-only');
});

async function cdp(page) {
  if (!page.__cdp) page.__cdp = await page.context().newCDPSession(page);
  return page.__cdp;
}
const P = (p, id) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 });

function makeDriver(page) {
  const down = {};
  const send = async (type, pts) => (await cdp(page)).send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  return {
    down,
    async start(id, pos) { down[id] = { ...pos }; await send('touchStart', Object.entries(down).map(([k, v]) => P(v, +k))); },
    async move(upd) {
      for (const [k, v] of Object.entries(upd)) down[k] = { ...v };
      await send('touchMove', Object.entries(down).map(([k, v]) => P(v, +k)));
    },
    async end(id) { const v = down[id]; delete down[id]; await send('touchEnd', [P(v, +id)]); },
    async endAll() { for (const k of Object.keys(down)) delete down[k]; await send('touchEnd', []); },
  };
}

async function cam(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect();
    const l = document.querySelector('.canvas-wrap > .canvas');
    const m = new DOMMatrix(getComputedStyle(l).transform);
    return { z: m.a, px: m.e, py: m.f, wx: wrap.left, wy: wrap.top };
  });
}
const toWorld = (c, s) => ({ x: (s.x - c.wx - c.px) / c.z, y: (s.y - c.wy - c.py) / c.z });
const toScreen = (c, w) => ({ x: c.wx + c.px + w.x * c.z, y: c.wy + c.py + w.y * c.z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const r3 = (n) => Math.round(n * 1000) / 1000;
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const sleep = (page, ms) => page.waitForTimeout(ms);
const log = (id, o) => console.log('MEASURED ' + id + ' ' + JSON.stringify(o));

async function openBoard(page) {
  await page.goto('/?local=1&reset=1');
  await page.locator('[data-card-id]').first().waitFor({ state: 'visible', timeout: 60000 });
  await sleep(page, 800);
}
async function emptyPoints(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect();
    const out = [];
    for (let fy = 0.2; fy < 0.9; fy += 0.04) for (let fx = 0.1; fx < 0.95; fx += 0.04) {
      const x = wrap.left + wrap.width * fx, y = wrap.top + wrap.height * fy;
      const el = document.elementFromPoint(x, y);
      if (el && el.closest('.canvas-wrap') && !el.closest('.card, button, [role="toolbar"], nav, .zoom-widget')) out.push({ x, y });
    }
    return { wrap: { l: wrap.left, t: wrap.top, w: wrap.width, h: wrap.height }, pts: out };
  });
}
async function cardPoint(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect();
    for (const c of document.querySelectorAll('[data-card-id]')) {
      const r = c.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x > wrap.left + 10 && x < wrap.right - 10 && y > wrap.top + 40 && y < wrap.bottom - 120) {
        const el = document.elementFromPoint(x, y);
        if (el && c.contains(el)) return { x, y, id: c.getAttribute('data-card-id') };
      }
    }
    return null;
  });
}
// Card id -> "left|top" (board coordinates, from the inline style).
async function cardPositions(page) {
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.card[data-card-id]')].map((c) => [c.getAttribute('data-card-id'), c.style.left + '|' + c.style.top])));
}
const selectedIds = (page) => page.evaluate(() => [...document.querySelectorAll('.card.is-selected, .card.selected, [data-card-id][aria-selected="true"]')].map((c) => c.getAttribute('data-card-id')));
// Anything that means a card was opened: the image lightbox, PDF viewer, photo
// editor, any modal (BLOCKING_OVERLAY_SELECTOR in CanvasSurface.jsx plus
// .modal-bg / .modal-shell-bg), or a focused text editor.
const openedCount = (page) => page.evaluate(() => {
  const overlays = document.querySelectorAll('.modal-bg, .modal-shell-bg, .lightbox, .pdfv, .iem, .settings-bg, .upgrade-backdrop, .cmdk-bg, [aria-modal="true"]').length;
  const ae = document.activeElement;
  const editing = ae && (ae.isContentEditable || ae.matches?.('input, textarea, [contenteditable="true"]')) ? 1 : 0;
  return overlays + editing;
});

const pairAt = (c, g) => ({ 0: { x: c.x - g / 2, y: c.y }, 1: { x: c.x + g / 2, y: c.y } });
// Move both fingers (already down) from gap g0 to g1 with the midpoint moving by `move`, in ~16 ms frames.
async function pinchMove(page, drv, { c, g0, g1, move = { x: 0, y: 0 }, ms = 400 }) {
  const n = Math.max(2, Math.round(ms / 16));
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    const cc = { x: c.x + move.x * f, y: c.y + move.y * f };
    await drv.move(pairAt(cc, g0 + (g1 - g0) * f));
    await sleep(page, 16);
  }
}
async function land(drv, c, g) {
  const p = pairAt(c, g);
  await drv.start(0, p[0]);
  await drv.start(1, p[1]);
}
// Two fingers along the line between a and b, spread by `scale` about their midpoint.
async function spreadAlongLine(page, drv, a, b, scale = 1.5, frames = 16) {
  const m = mid(a, b);
  const g0 = dist(a, b);
  const dir = { x: (b.x - a.x) / g0, y: (b.y - a.y) / g0 };
  for (let i = 1; i <= frames; i++) {
    const g = g0 * (1 + (scale - 1) * (i / frames));
    await drv.move({ 0: { x: m.x - dir.x * g / 2, y: m.y - dir.y * g / 2 }, 1: { x: m.x + dir.x * g / 2, y: m.y + dir.y * g / 2 } });
    await sleep(page, 16);
  }
}

async function setup(page) {
  await openBoard(page);
  const drv = makeDriver(page);
  const { wrap, pts } = await emptyPoints(page);
  return { drv, wrap, pts, C: { x: wrap.l + wrap.w / 2, y: wrap.t + wrap.h * 0.45 } };
}

test('a pinch follows the hand: the board point under the midpoint stays under it', async ({ page }) => {
  const { drv, wrap } = await setup(page);
  const c0 = { x: wrap.l + wrap.w * 0.4, y: wrap.t + wrap.h * 0.4 };
  const k0 = await cam(page);
  const world = toWorld(k0, c0);
  await land(drv, c0, 120);
  await pinchMove(page, drv, { c: c0, g0: 120, g1: 180, move: { x: 120, y: 180 }, ms: 480 }); // midpoint moves 216 px
  const k1 = await cam(page);
  const finalMid = { x: c0.x + 120, y: c0.y + 180 };
  const err = dist(toScreen(k1, world), finalMid);
  log('1', { zRatio: r3(k1.z / k0.z), errPx: r3(err), midMovePx: r3(dist(c0, finalMid)) });
  await drv.endAll();
  expect(k1.z / k0.z).toBeGreaterThan(1.4);
  expect(k1.z / k0.z).toBeLessThan(1.6);
  expect(err).toBeLessThan(2);
});

test('two fingers moved together pan the board 1:1', async ({ page }) => {
  const { drv, wrap } = await setup(page);
  const c0 = { x: wrap.l + wrap.w * 0.3, y: wrap.t + wrap.h * 0.4 };
  const k0 = await cam(page);
  await land(drv, c0, 120);
  await pinchMove(page, drv, { c: c0, g0: 120, g1: 120, move: { x: 200, y: 0 }, ms: 480 });
  const k1 = await cam(page);
  await drv.endAll();
  log('2', { panDx: r3(k1.px - k0.px), panDy: r3(k1.py - k0.py), zRatio: r3(k1.z / k0.z) });
  expect(Math.abs(k1.px - k0.px - 200)).toBeLessThanOrEqual(2);
  expect(Math.abs(k1.py - k0.py)).toBeLessThanOrEqual(2);
  expect(Math.abs(k1.z / k0.z - 1)).toBeLessThan(0.005);
});

test('lift one finger and the other keeps panning, with no jump at the lift', async ({ page }) => {
  const { drv, wrap } = await setup(page);
  const c0 = { x: wrap.l + wrap.w * 0.4, y: wrap.t + wrap.h * 0.45 };
  await land(drv, c0, 100);
  await pinchMove(page, drv, { c: c0, g0: 100, g1: 160, ms: 320 });
  const kBefore = await cam(page);
  const A = { ...drv.down[0] };
  await drv.end(1);
  await sleep(page, 40);
  const kAfterLift = await cam(page);
  const n = 10;
  for (let i = 1; i <= n; i++) {
    await drv.move({ 0: { x: A.x + (150 / n) * i, y: A.y } });
    await sleep(page, 16);
  }
  const kMoved = await cam(page);
  await drv.end(0);
  const jump = dist({ x: kAfterLift.px, y: kAfterLift.py }, { x: kBefore.px, y: kBefore.py });
  const panned = kMoved.px - kAfterLift.px;
  log('3', { jumpAtLiftPx: r3(jump), panFollowedPx: r3(panned), expected: 150, zoomChangeOnLift: r3(kAfterLift.z - kBefore.z) });
  expect(jump).toBeLessThanOrEqual(2);
  expect(Math.abs(panned - 150)).toBeLessThanOrEqual(3);
  expect(Math.abs(kMoved.py - kAfterLift.py)).toBeLessThanOrEqual(3);
});

test('the 500% soft wall stretches a little, gives way at once, and settles on 5.0', async ({ page }) => {
  const { drv, C } = await setup(page);
  const MAX = 5.0;
  // Climb to the limit with big pinches; each one settles back to at most 5.0.
  let k = await cam(page);
  for (let guard = 0; k.z < MAX - 0.001 && guard < 10; guard++) {
    await land(drv, C, 60);
    await pinchMove(page, drv, { c: C, g0: 60, g1: 300, ms: 480 });
    await drv.endAll();
    await sleep(page, 400);
    k = await cam(page);
  }
  expect(k.z).toBeGreaterThan(MAX - 0.01);

  // Overshoot while holding: zoom is past the limit but within the stretch.
  await land(drv, C, 100);
  await pinchMove(page, drv, { c: C, g0: 100, g1: 300, ms: 480 });
  const kWall = await cam(page);
  // Reverse a little: the zoom must drop on the first frames (no dead zone).
  const back = [];
  let g = 300;
  for (let i = 1; i <= 6; i++) {
    g -= 4;
    await drv.move(pairAt(C, g));
    await sleep(page, 16);
    back.push((await cam(page)).z);
  }
  log('4', { zAtWall: r3(kWall.z), maxAllowed: r3(MAX * 1.12 + 0.01), zAfterReverse4px: r3(back[0]), zAfter3Frames: r3(back[2]), zAfter6Frames: r3(back[5]) });
  expect(kWall.z).toBeGreaterThan(MAX);
  expect(kWall.z).toBeLessThan(MAX * 1.12 + 0.01);
  expect(back[2]).toBeLessThan(kWall.z);
  expect(back[5]).toBeLessThan(back[2]);

  // Overshoot again and lift: it glides back to exactly the limit.
  await pinchMove(page, drv, { c: C, g0: g, g1: 300, ms: 240 });
  expect((await cam(page)).z).toBeGreaterThan(MAX);
  await drv.endAll();
  await expect.poll(async () => (await cam(page)).z, { timeout: 600, intervals: [50] }).toBeCloseTo(MAX, 3);
});

test('a second finger landing on a card belongs to the camera', async ({ page }) => {
  const { drv, pts } = await setup(page);
  const cp = await cardPoint(page);
  expect(cp).not.toBeNull();
  const A0 = pts.filter((p) => dist(p, cp) > 90 && dist(p, cp) < 220).sort((a, b) => dist(a, cp) - dist(b, cp))[0];
  expect(A0).toBeTruthy();
  const before = await cardPositions(page);
  const k0 = await cam(page);
  await drv.start(0, A0);
  await sleep(page, 30);
  await drv.start(1, cp);
  await spreadAlongLine(page, drv, A0, cp);
  const k1 = await cam(page);
  await drv.endAll();
  await sleep(page, 500);
  expect(k1.z / k0.z).toBeGreaterThan(1.3); // it really was a camera gesture
  expect(await selectedIds(page)).toEqual([]);
  expect(await cardPositions(page)).toEqual(before);
});

test('a first finger on a card plus a pinch selects and opens nothing', async ({ page }) => {
  const { drv, pts } = await setup(page);
  const cp = await cardPoint(page);
  expect(cp).not.toBeNull();
  const B0 = pts.filter((p) => dist(p, cp) > 90 && dist(p, cp) < 220).sort((a, b) => dist(a, cp) - dist(b, cp))[0];
  expect(B0).toBeTruthy();
  const before = await cardPositions(page);
  const k0 = await cam(page);
  await drv.start(0, cp);
  await sleep(page, 30);
  await drv.start(1, B0);
  await spreadAlongLine(page, drv, cp, B0);
  const k1 = await cam(page);
  await drv.endAll();
  await sleep(page, 600); // past any click-after-touch delay
  expect(k1.z / k0.z).toBeGreaterThan(1.3);
  expect(await selectedIds(page)).toEqual([]);
  expect(await openedCount(page)).toBe(0);
  expect(await cardPositions(page)).toEqual(before);
});

test('the image tier scale at settle equals the settled zoom', async ({ page }) => {
  const { drv, C } = await setup(page);
  await page.evaluate(async () => {
    const m = await import('/src/lib/canvasScale.js');
    window.__tiers = [];
    m.onCanvasSettle(() => window.__tiers.push(m.getImageTierScale()));
    window.__canvasScaleMod = m;
  });
  const k0 = await cam(page);
  await land(drv, C, 100);
  await pinchMove(page, drv, { c: C, g0: 100, g1: 230, ms: 400 });
  await drv.endAll();
  await sleep(page, 600);
  const k = await cam(page);
  const { tiers, boost } = await page.evaluate(() => ({ tiers: window.__tiers, boost: window.__canvasScaleMod.getImageTierScale() / window.__canvasScaleMod.getCanvasScale() }));
  const last = tiers[tiers.length - 1];
  log('7', { zoom: r3(k.z), lastTierScale: r3(last), settles: tiers.length, boost });
  expect(tiers.length).toBeGreaterThan(0);
  expect(k.z / k0.z).toBeGreaterThan(1.8); // a clearly different zoom
  // getImageTierScale() is the settled zoom times the Capture Mode boost (1 outside Capture Mode).
  expect(Math.abs(last / (k.z * boost) - 1)).toBeLessThan(0.01);
});

test('the zoom readout counts live during a pinch', async ({ page }) => {
  const { drv, C } = await setup(page);
  const k0 = await cam(page);
  await land(drv, C, 100);
  await pinchMove(page, drv, { c: C, g0: 100, g1: 170, ms: 400 });
  const k1 = await cam(page);
  const text = await page.locator('.cnv-zoom-val').innerText();
  await drv.endAll();
  log('8', { zoom: r3(k1.z), readout: text });
  expect(Math.abs(k1.z / k0.z - 1)).toBeGreaterThan(0.2);
  expect(text).toMatch(/%$/);
  expect(Math.abs(parseInt(text, 10) - Math.round(k1.z * 100))).toBeLessThanOrEqual(1);
});

test('with the pan tool active, a pinch still zooms and the pan is not snapped back', async ({ page }) => {
  const { drv, wrap } = await setup(page);
  await page.keyboard.press('h'); // H picks the pan tool (CanvasSurface.jsx keydown handler)
  await sleep(page, 100);
  const k0 = await cam(page);
  const A0 = { x: wrap.l + wrap.w * 0.35, y: wrap.t + wrap.h * 0.5 };
  await drv.start(0, A0);
  for (let i = 1; i <= 6; i++) { await drv.move({ 0: { x: A0.x + 5 * i, y: A0.y } }); await sleep(page, 16); }
  const A1 = { ...drv.down[0] };
  await drv.start(1, { x: A1.x + 100, y: A1.y });
  const m = mid(A1, { x: A1.x + 100, y: A1.y });
  for (let i = 1; i <= 20; i++) {
    await drv.move(pairAt(m, 100 + 70 * (i / 20)));
    await sleep(page, 16);
  }
  const kPinched = await cam(page);
  await drv.endAll();
  await sleep(page, 500);
  const kEnd = await cam(page);
  log('9', { z0: r3(k0.z), zPinched: r3(kPinched.z), zEnd: r3(kEnd.z), panStartToEnd: [r3(kEnd.px - k0.px), r3(kEnd.py - k0.py)] });
  expect(kPinched.z / k0.z).toBeGreaterThan(1.5);
  expect(Math.abs(kEnd.z / kPinched.z - 1)).toBeLessThan(0.01);
  // A snap back to the one-finger pan's start would move the pan on lift; it must stay where the pinch left it.
  expect(dist({ x: kEnd.px, y: kEnd.py }, { x: kPinched.px, y: kPinched.py })).toBeLessThan(2);
  expect(dist({ x: kEnd.px, y: kEnd.py }, { x: k0.px, y: k0.py })).toBeGreaterThan(20);
});
