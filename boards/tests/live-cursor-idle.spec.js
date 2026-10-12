// PERF-09: every peer LiveCursor ran its own requestAnimationFrame loop for as
// long as it was mounted — a peer resting their mouse kept the main thread
// busy every frame, once per visible cursor. The loop now parks once the
// cursor has eased to rest and wakes on the next sample. Driven through the
// ?presenceqa=1 harness, which mounts the real <CanvasPresence>/<LiveCursor>.

import { expect, test } from '@playwright/test';

async function rafCallsOver(page, ms) {
  return page.evaluate((ms) => new Promise((resolve) => {
    const orig = window.requestAnimationFrame;
    let n = 0;
    window.requestAnimationFrame = (cb) => { n++; return orig.call(window, cb); };
    setTimeout(() => { window.requestAnimationFrame = orig; resolve(n); }, ms);
  }), ms);
}

test('resting peer cursors stop scheduling frames, and move again on a new sample', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?presenceqa=1');
  await page.waitForSelector('#root[data-presenceqa-ready="1"]');
  await page.evaluate(() => window.__soleilPresenceTest.seedPeers(8));
  await expect.poll(() => page.evaluate(() => window.__soleilPresenceTest.renderedCursorCount())).toBe(8);

  // Let every cursor ease to rest, then count frames requested while idle.
  await page.waitForTimeout(600);
  const idle = await rafCallsOver(page, 1000);
  // Eight looping cursors request ~480 frames a second; parked, ~none.
  expect(idle).toBeLessThan(40);

  // A new sample wakes a cursor and it reaches its new spot.
  await page.evaluate(() => {
    const aw = window.__soleilPresenceAw;
    const st = aw._states.get(1);
    st.canvasCursor = { ...st.canvasCursor, x: st.canvasCursor.x + 300 };
    aw._touch(1);
    aw._emit();
  });
  const moving = await rafCallsOver(page, 300);
  expect(moving).toBeGreaterThan(0);
});
