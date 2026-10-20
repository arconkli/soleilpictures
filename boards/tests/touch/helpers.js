// What a finger does, for the touch specs (tests/touch/, tests/tablet/).
//
// Taps go through page.touchscreen, which both engines turn into real touch
// and pointer events. Holds, drags and pinches need a finger that stays down,
// which only CDP's Input.dispatchTouchEvent gives: Chromium only. WebKit drops
// pointerType from a constructor-made PointerEvent (see mobile/long-press), so
// a spec that holds skips WebKit with `needsHold(test, browserName)` and the
// hold goes on the device checklist instead.

export function needsHold(test, browserName) {
  test.skip(browserName !== 'chromium',
    'a held finger needs CDP touch (Chromium); WebKit drops pointerType from synthesized ' +
    'PointerEvents — check this one on a real iPad');
}

async function cdp(page) {
  if (!page.__touchCdp) page.__touchCdp = await page.context().newCDPSession(page);
  return page.__touchCdp;
}

const pt = (p, id = 0) => ({ x: Math.round(p.x), y: Math.round(p.y), id, radiusX: 4, radiusY: 4, force: 1 });

export async function touchDown(page, points) {
  await (await cdp(page)).send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points.map(pt) });
}
export async function touchMove(page, points) {
  await (await cdp(page)).send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points.map(pt) });
}
export async function touchUp(page) {
  await (await cdp(page)).send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

export async function tap(page, p) {
  await page.touchscreen.tap(Math.round(p.x), Math.round(p.y));
}

// A finger held still for `ms`, then lifted.
export async function hold(page, p, ms = 650) {
  await touchDown(page, [p]);
  await page.waitForTimeout(ms);
  await touchUp(page);
}

// Held still for `ms`, then dragged through `path` (in steps), then lifted.
export async function holdDrag(page, from, path, { ms = 650, steps = 8, lift = true } = {}) {
  await touchDown(page, [from]);
  await page.waitForTimeout(ms);
  let at = from;
  for (const to of path) {
    for (let i = 1; i <= steps; i++) {
      await touchMove(page, [{ x: at.x + (to.x - at.x) * (i / steps), y: at.y + (to.y - at.y) * (i / steps) }]);
      await page.waitForTimeout(16);
    }
    at = to;
  }
  if (lift) await touchUp(page);
  return at;
}

// A quick one-finger drag: no hold first.
export async function swipe(page, from, to, { steps = 8 } = {}) {
  return holdDrag(page, from, [to], { ms: 0, steps });
}

// Two fingers spreading (or closing) around `center`, from `gap` to `toGap` apart.
export async function pinch(page, center, gap, toGap, { steps = 8 } = {}) {
  const at = (g) => [{ x: center.x - g / 2, y: center.y }, { x: center.x + g / 2, y: center.y }];
  await touchDown(page, at(gap).map((p, i) => ({ ...p, id: i })));
  for (let i = 1; i <= steps; i++) {
    const g = gap + (toGap - gap) * (i / steps);
    await (await cdp(page)).send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(g).map((p, k) => pt(p, k)) });
    await page.waitForTimeout(16);
  }
  await touchUp(page);
}

// The box a finger can actually hit, found the way a tap finds it: walk out
// from the centre along each axis and keep going while elementFromPoint still
// lands on the control (or something inside it). That counts a ::before hit
// slop, and it does not count what an ancestor clips or a sibling covers —
// boundingBox() reports neither.
export async function hitBox(locator, { reach = 40 } = {}) {
  return locator.evaluate((el, reach) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hits = (x, y) => {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
      const at = document.elementFromPoint(x, y);
      return !!at && (at === el || el.contains(at));
    };
    if (!hits(cx, cy)) return { w: 0, h: 0, covered: true };
    const run = (dx, dy) => {
      let n = 0;
      while (n < reach + Math.max(r.width, r.height) && hits(cx + dx * (n + 1), cy + dy * (n + 1))) n++;
      return n;
    };
    return { w: run(-1, 0) + run(1, 0) + 1, h: run(0, -1) + run(0, 1) + 1, covered: false };
  }, reach);
}

// The zoomed layer's scale on the canvas, from the camera transform.
export async function canvasZoom(page) {
  return page.evaluate(() => {
    const layer = document.querySelector('.canvas-wrap > .canvas');
    const m = layer && getComputedStyle(layer).transform;
    if (!m || m === 'none') return 1;
    const v = m.match(/matrix\(([^)]+)\)/);
    return v ? Number(v[1].split(',')[0]) : 1;
  });
}

// A point on empty canvas: nothing but the board's own layers under it.
export async function emptyCanvasPoint(page, { from = 'right' } = {}) {
  const pt = await page.evaluate((from) => {
    const wrap = document.querySelector('.canvas-wrap');
    const b = wrap.getBoundingClientRect();
    const xs = [];
    for (let f = 0.95; f > 0.05; f -= 0.05) xs.push(from === 'right' ? f : 1 - f);
    for (let fy = 0.25; fy < 0.9; fy += 0.05) {
      for (const fx of xs) {
        const x = b.left + b.width * fx;
        const y = b.top + b.height * fy;
        const el = document.elementFromPoint(x, y);
        if (el && el.closest('.canvas-wrap') && (el.classList.contains('cards-layer') || el.classList.contains('canvas-wrap') || el.classList.contains('grain-canvas'))) {
          return { x, y };
        }
      }
    }
    return null;
  }, from);
  if (!pt) throw new Error('no empty canvas point found');
  return pt;
}
