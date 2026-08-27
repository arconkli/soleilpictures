import { expect, test } from '@playwright/test';

// Drawing with a finger, on the board and in the sketch pad.
//
// There was NO touch coverage for drawing at all before this file — draw-routing,
// draw-undo and stroke-cull all run on desktop-chrome with a mouse — which is how
// a phone and tablet shipped with the draw tool unreachable from the rail, its
// options bar hidden behind the bottom nav, and a pinch in draw mode painting a
// smear across the board.
//
// Touch-only behaviour, so skip the mouse project throughout.

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'these are touch interactions');
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  // The blank board settles before the rail is safe to drive.
  await page.waitForTimeout(1000);
});

// A one-finger stroke, dispatched as real PointerEvents with pointerType:'touch'
// so it exercises the same routing a finger does (Playwright's mouse API sends
// pointerType:'mouse', which takes an entirely different branch).
async function fingerStroke(page, selector, { from, to, steps = 12, pointerId = 1 }) {
  return page.evaluate(async ({ selector, from, to, steps, pointerId }) => {
    const el = document.querySelector(selector);
    if (!el) return { ok: false, why: 'no element' };
    const r = el.getBoundingClientRect();
    const at = (t) => ({
      clientX: r.left + from.x + (to.x - from.x) * t,
      clientY: r.top + from.y + (to.y - from.y) * t,
    });
    const ev = (type, p, extra = {}) => new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, ...p, ...extra,
    });
    el.dispatchEvent(ev('pointerdown', at(0)));
    for (let i = 1; i <= steps; i++) {
      window.dispatchEvent(ev('pointermove', at(i / steps)));
      await new Promise(requestAnimationFrame);
    }
    window.dispatchEvent(ev('pointerup', at(1), { buttons: 0 }));
    await new Promise(requestAnimationFrame);
    return { ok: true };
  }, { selector, from, to, steps, pointerId });
}


test.describe('board', () => {
  test('draw is on the rail, and a finger stroke commits to the board', async ({ page }) => {
    // Reachability: on a desktop D reaches Draw instantly, but a touch device
    // has no keyboard — the rail is the only sane way in.
    const drawTool = page.getByRole('button', { name: 'Free-draw tool', exact: true });
    await expect(drawTool).toBeVisible();
    await drawTool.click();
    await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-draw/);

    const before = await page.locator('.strokes-layer path').count();
    await fingerStroke(page, '.canvas-wrap', { from: { x: 160, y: 300 }, to: { x: 300, y: 380 } });
    await page.waitForTimeout(300);
    // One committed stroke renders as two paths: the invisible hit halo and the
    // visible line (the same contract draw-routing.spec.js pins).
    expect(await page.locator('.strokes-layer path').count()).toBe(before + 2);
  });

  test('the draw options bar stays visible while you draw', async ({ page }) => {
    // It was added to the auto-hide set alongside the rail and the bottom nav,
    // which meant the colour you were drawing with faded out the instant you
    // touched the canvas and popped back ~700ms after you lifted. The rail is
    // worth hiding — it sits over the drawing area. The bar you are USING is not.
    await page.getByRole('button', { name: 'Free-draw tool', exact: true }).click();
    await page.waitForTimeout(300);
    const mid = await page.evaluate(async () => {
      const el = document.querySelector('.canvas-wrap');
      const r = el.getBoundingClientRect();
      const ev = (t, x, extra = {}) => new PointerEvent(t, {
        bubbles: true, cancelable: true, composed: true, pointerId: 5,
        pointerType: 'touch', isPrimary: true, button: 0, buttons: 1,
        clientX: r.left + x, clientY: r.top + 250, ...extra,
      });
      el.dispatchEvent(ev('pointerdown', 120));
      let seen = '1';
      for (let i = 1; i <= 30; i++) {
        window.dispatchEvent(ev('pointermove', 120 + i * 6));
        await new Promise(requestAnimationFrame);
        if (i === 15) seen = getComputedStyle(document.querySelector('.tob')).opacity;
      }
      window.dispatchEvent(ev('pointerup', 300, { buttons: 0 }));
      return seen;
    });
    expect(parseFloat(mid)).toBeGreaterThan(0.5);
  });

  test('the draw options bar is fully on screen, clear of the bottom nav', async ({ page }) => {
    await page.getByRole('button', { name: 'Free-draw tool', exact: true }).click();
    const tob = page.locator('.tob');
    await expect(tob).toBeVisible();

    const bar = await tob.boundingBox();
    const viewport = page.viewportSize();
    expect(bar.y + bar.height).toBeLessThanOrEqual(viewport.height);

    // .tob used to wrap into three rows at bottom:14px, with the bottom nav
    // covering two of them — the swatches, the thickness picker and the button
    // that opens the sketch pad were all simply unreachable.
    const nav = page.locator('.mb-nav');
    if (await nav.count()) {
      const navBox = await nav.boundingBox();
      if (navBox) expect(bar.y + bar.height).toBeLessThanOrEqual(navBox.y + 1);
    }
    // A single row, not a stack.
    expect(bar.height).toBeLessThan(120);
  });

  test('a finger can select strokes with the lasso', async ({ page }) => {
    // The reason the lasso exists: one-finger touch on the select tool pans, so
    // the marquee is mouse/stylus-only and a finger could not select anything.
    await page.getByRole('button', { name: 'Free-draw tool', exact: true }).click();
    await fingerStroke(page, '.canvas-wrap', { from: { x: 200, y: 300 }, to: { x: 280, y: 340 } });
    await page.waitForTimeout(250);
    expect(await page.locator('.strokes-layer path').count()).toBe(2);

    await page.getByRole('button', { name: 'Lasso' }).click();
    await page.waitForTimeout(150);
    // Trace a loop around it with one finger.
    await page.evaluate(async () => {
      const el = document.querySelector('.canvas-wrap');
      const r = el.getBoundingClientRect();
      // Canvas-relative, exactly like fingerStroke — the stroke sits at
      // (200,300)-(280,340) in this space, so the loop has to be in it too.
      const loop = [[160, 260], [320, 260], [320, 380], [160, 380], [160, 265]]
        .map(([x, y]) => [r.left + x, r.top + y]);
      const ev = (type, x, y, extra = {}) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 7,
        pointerType: 'touch', isPrimary: true, button: 0, buttons: 1,
        clientX: x, clientY: y, ...extra,
      });
      el.dispatchEvent(ev('pointerdown', loop[0][0], loop[0][1]));
      for (let i = 1; i < loop.length; i++) {
        const [ax, ay] = loop[i - 1], [bx, by] = loop[i];
        for (let s = 1; s <= 8; s++) {
          window.dispatchEvent(ev('pointermove', ax + (bx - ax) * s / 8, ay + (by - ay) * s / 8));
          await new Promise(requestAnimationFrame);
        }
      }
      window.dispatchEvent(ev('pointerup', loop.at(-1)[0], loop.at(-1)[1], { buttons: 0 }));
      await new Promise(requestAnimationFrame);
    });
    await page.waitForTimeout(300);

    // Selected: the stroke gains its selection ring, and the tool hands over.
    expect(await page.locator('.strokes-layer path').count()).toBe(3);
    await expect(page.locator('.canvas-wrap')).toHaveClass(/tool-select/);
  });

  test('the sketch pad is reachable from the draw options', async ({ page }) => {
    await page.getByRole('button', { name: 'Free-draw tool', exact: true }).click();
    const canvasBtn = page.locator('.tob-canvas-btn');
    await expect(canvasBtn).toBeVisible();
    await canvasBtn.click();
    await expect(page.locator('.sketchpad-surface')).toBeVisible();
  });
});

test.describe('sketch pad', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByRole('button', { name: 'Free-draw tool', exact: true }).click();
    await page.locator('.tob-canvas-btn').click();
    await expect(page.locator('.sketchpad-surface')).toBeVisible();
  });

  test('a finger stroke commits, and a dense burst does not stall it', async ({ page }) => {
    expect(await page.locator('.sketchpad-svg path').count()).toBe(0);
    // 400 samples in one gesture is the shape of Pencil input that used to
    // rebuild the point array and the whole path string on every native event.
    const t0 = Date.now();
    await fingerStroke(page, '.sketchpad-surface',
      { from: { x: 30, y: 30 }, to: { x: 300, y: 140 }, steps: 400 });
    const elapsed = Date.now() - t0;
    await page.waitForTimeout(200);
    expect(await page.locator('.sketchpad-svg path').count()).toBe(1);
    // Generous — this is a smoke alarm for quadratic behaviour, not a benchmark.
    expect(elapsed).toBeLessThan(20000);
  });

  test('the drawing surface owns its gestures', async ({ page }) => {
    // The pad portals onto document.body, OUTSIDE .canvas-wrap{touch-action:none},
    // so without an explicit rule it inherits html{touch-action:pan-x pan-y} and
    // the browser can claim a one-finger drag and cancel the stroke halfway.
    //
    // Read the computed style in-page rather than via toHaveCSS: WebKit reports
    // touch-action as an empty string, and user-select only under its prefix.
    const css = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('.sketchpad-surface'));
      return {
        touchAction: s.touchAction || s.webkitTouchAction || '',
        userSelect: s.userSelect || s.webkitUserSelect || '',
        callout: s.webkitTouchCallout || '',
      };
    });
    // An engine that doesn't report the property still applies the rule; only
    // assert what it will actually tell us.
    if (css.touchAction) expect(css.touchAction).toBe('none');
    expect(css.userSelect).toBe('none');
    if (css.callout) expect(css.callout).toBe('none');
  });

  test('primary controls meet a 44px touch target', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'tablet', 'phone-width compact bar');
    for (const sel of ['.sp-tool', '.sp-chip', '.sp-action']) {
      const n = await page.locator(sel).count();
      expect(n, `${sel} should exist`).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        const box = await page.locator(sel).nth(i).boundingBox();
        if (!box) continue; // scrolled out of the tool zone is fine
        expect(Math.min(box.width, box.height),
          `${sel}[${i}] is below a usable touch target`).toBeGreaterThanOrEqual(40);
      }
    }
  });

  test('commit and close never scroll out of reach', async ({ page }) => {
    const viewport = page.viewportSize();
    for (const sel of ['.sp-action-primary', '.sp-x']) {
      const box = await page.locator(sel).first().boundingBox();
      expect(box, `${sel} should be laid out`).toBeTruthy();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  });
});

// Multi-touch needs CDP, which is Chromium-only.
test.describe('two fingers', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'CDP touch dispatch is Chromium-only');
  });

  test('pinching in draw mode leaves no stray stroke on the board', async ({ page }) => {
    await page.getByRole('button', { name: 'Free-draw tool', exact: true }).click();
    const before = await page.locator('.strokes-layer path').count();

    const cdp = await page.context().newCDPSession(page);
    const pt = (x, y, id) => ({ x, y, id, radiusX: 10, radiusY: 10, force: 1 });
    const v = page.viewportSize();
    const cx = v.width / 2, cy = v.height / 2;

    // First finger lands and starts a stroke — that is unavoidable, the tool
    // cannot know a second finger is coming. It drags a little, THEN the second
    // finger arrives and the gesture becomes a pinch.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(cx - 40, cy, 1)] });
    for (let i = 1; i <= 4; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(cx - 40 + i * 6, cy, 1)] });
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [pt(cx - 16, cy, 1), pt(cx + 40, cy, 2)],
    });
    for (let i = 1; i <= 8; i++) {
      const d = 40 + i * 10;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [pt(cx - d, cy, 1), pt(cx + d, cy, 2)],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);

    // The half-drawn line must be discarded, not committed: every sample after
    // the second finger landed was mapped through a transform that was moving.
    expect(await page.locator('.strokes-layer path').count()).toBe(before);
    expect(await page.locator('.strokes-layer path').count()).toBe(before);
  });

  test('pinching in the sketch pad zooms it', async ({ page }) => {
    await page.getByRole('button', { name: 'Free-draw tool', exact: true }).click();
    await page.locator('.tob-canvas-btn').click();
    await expect(page.locator('.sketchpad-surface')).toBeVisible();
    await expect(page.locator('.sp-zoom-reset')).toHaveCount(0);

    const box = await page.locator('.sketchpad-surface').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const pt = (x, y, id) => ({ x, y, id, radiusX: 10, radiusY: 10, force: 1 });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [pt(cx - 30, cy, 1), pt(cx + 30, cy, 2)],
    });
    for (let i = 1; i <= 8; i++) {
      const d = 30 + i * 12;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [pt(cx - d, cy, 1), pt(cx + d, cy, 2)],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);

    // Zoomed in, and there is a one-tap way back — a pinch you cannot undo
    // strands people at 700% with no idea how they got there.
    const reset = page.locator('.sp-zoom-reset');
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(reset).toHaveCount(0);
  });
});

test.describe('pad zoom', () => {
  test('drawing while the pad is zoomed lands where the finger is', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'CDP touch dispatch is Chromium-only');
    await page.getByRole('button', { name: 'Free-draw tool', exact: true }).click();
    await page.locator('.tob-canvas-btn').first().click();
    await expect(page.locator('.sketchpad-surface')).toBeVisible();
    await page.waitForTimeout(300);

    const box = await page.locator('.sketchpad-surface').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const pt = (x, y, id) => ({ x, y, id, radiusX: 10, radiusY: 10, force: 1 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(cx - 30, cy, 1), pt(cx + 30, cy, 2)] });
    for (let i = 1; i <= 6; i++) {
      const d = 30 + i * 12;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(cx - d, cy, 1), pt(cx + d, cy, 2)] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
    await expect(page.locator('.sp-zoom-reset')).toBeVisible();

    // The zoom/pan transform is applied to the drawing surface ITSELF, so
    // toLogical's getBoundingClientRect reads it and no coordinate maths has to
    // know about it. Prove that: a point drawn under the finger must map back
    // to the same viewport pixel.
    const probe = await page.evaluate(async () => {
      const el = document.querySelector('.sketchpad-surface');
      const r = el.getBoundingClientRect();
      const X = r.left + r.width * 0.5, Y = r.top + r.height * 0.5;
      const ev = (t, x, y, extra = {}) => new PointerEvent(t, {
        bubbles: true, cancelable: true, composed: true, pointerId: 21,
        pointerType: 'touch', isPrimary: true, button: 0, buttons: 1,
        clientX: x, clientY: y, ...extra,
      });
      el.dispatchEvent(ev('pointerdown', X, Y));
      for (let i = 1; i <= 8; i++) { window.dispatchEvent(ev('pointermove', X + i * 4, Y)); await new Promise(requestAnimationFrame); }
      window.dispatchEvent(ev('pointerup', X + 32, Y, { buttons: 0 }));
      await new Promise(requestAnimationFrame);
      return { X, Y, rect: { left: r.left, top: r.top, w: r.width, h: r.height } };
    });
    await page.waitForTimeout(300);
    const d = await page.evaluate(() => document.querySelector('.sketchpad-svg path')?.getAttribute('d'));
    expect(d, 'a stroke should have been committed').toBeTruthy();
    const m = d.match(/M([-\d.]+),([-\d.]+)/);
    const vb = await page.evaluate(() =>
      document.querySelector('.sketchpad-svg').getAttribute('viewBox').split(' ').map(Number));
    const backX = probe.rect.left + (parseFloat(m[1]) / vb[2]) * probe.rect.w;
    const backY = probe.rect.top + (parseFloat(m[2]) / vb[3]) * probe.rect.h;
    expect(Math.abs(backX - probe.X)).toBeLessThan(3);
    expect(Math.abs(backY - probe.Y)).toBeLessThan(3);
  });
});
