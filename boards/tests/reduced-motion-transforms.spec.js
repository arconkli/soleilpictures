// reduced-motion-transforms.spec.js — prefers-reduced-motion must reduce
// MOTION, not positions.
//
// styles.css used to carry `*, *::before, *::after { transform: none
// !important }` under the reduced-motion query. A transform is as often a
// position as a movement, so that one line left the phone sidebar drawer
// parked open over the app (its closed state IS translateX(-100%)), stacked
// every peer cursor at the canvas origin, un-flipped flipped photos and pushed
// the empty-cluster panel off-centre (VIS-01, VIS-02, CANVAS-A-X1). These pin
// the replacement: durations clamped, loops stopped, transforms left alone.
//
// emulateMedia, not test.use({ reducedMotion }) — the latter has silently
// failed to apply in this repo — and every test proves the query matched.

import { expect, test } from '@playwright/test';

async function reduceMotion(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const applied = await page.evaluate(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  expect(applied, 'emulateMedia did not take — every assertion below would be vacuous').toBe(true);
}

test('the closed phone sidebar drawer stays off-screen with motion reduced', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await reduceMotion(page);
  await page.goto('/?local=1&reset=1&blank=1');
  const sidebar = page.locator('.sidebar').first();
  await expect(sidebar).toBeAttached();
  await expect(sidebar).not.toHaveClass(/is-mobile-open/);
  // Give any clamped transition time to settle before measuring.
  await page.waitForTimeout(300);
  const box = await sidebar.boundingBox();
  expect(box, 'the sidebar must be laid out').not.toBeNull();
  expect(box.x + box.width, 'the closed drawer must sit entirely off the left edge').toBeLessThanOrEqual(1);
});

test('the empty-cluster panel stays centred with motion reduced', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await reduceMotion(page);
  await page.goto('/?local=1&reset=1&blank=1');
  const panel = page.locator('.cnv-empty-tiles');
  await expect(panel).toBeVisible();
  await page.waitForTimeout(300);
  const { mid, wrapMid } = await panel.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const p = el.offsetParent.getBoundingClientRect();
    return { mid: r.left + r.width / 2, wrapMid: p.left + p.width / 2 };
  });
  expect(Math.abs(mid - wrapMid), 'the panel must be centred in its frame, not shifted by half its width').toBeLessThan(4);
});

test('inline transforms survive and infinite loops stop with motion reduced', async ({ page }) => {
  await reduceMotion(page);
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('#root')).toBeVisible();
  const probe = await page.evaluate(() => {
    // A peer cursor / flipped image / fitted embed: a plain inline transform.
    const pos = document.createElement('div');
    pos.style.transform = 'translate(40px, 20px)';
    // Any infinite rotation (upload badges, payment spinners …), which under
    // the duration clamp alone would whirl at 120ms a turn.
    const spin = document.createElement('span');
    spin.style.animation = 'spin 0.8s linear infinite';
    document.body.append(pos, spin);
    const out = {
      transform: getComputedStyle(pos).transform,
      iterations: getComputedStyle(spin).animationIterationCount,
      spinAnimation: getComputedStyle(spin).animationName,
    };
    pos.remove(); spin.remove();
    return out;
  });
  expect(probe.transform).toBe('matrix(1, 0, 0, 1, 40, 20)');
  expect(probe.spinAnimation, 'the probe must actually be animated').not.toBe('none');
  expect(probe.iterations).toBe('1');
});
