// A tour step that sits on screen doesn't keep the page busy (PERF-08).
//
// The pill tracked its anchor with a perpetual requestAnimationFrame loop —
// a querySelector and five layout reads every frame for as long as a step was
// showing, which on pick_intent / add_content can be minutes — and the target
// ring pulsed a 30px box-shadow forever. Tracking is per-frame only while
// something moves now, with a slow poll otherwise; the pulse runs a few times
// and rests. Driven through the DEV ?tourqa=1 harness.
import { expect, test } from '@playwright/test';

async function countAnchorLookups(page, ms) {
  return page.evaluate(async (wait) => {
    let n = 0;
    const orig = Document.prototype.querySelector;
    Document.prototype.querySelector = function (sel) {
      if (typeof sel === 'string' && sel.startsWith('[data-tour="')) n += 1;
      return orig.call(this, sel);
    };
    await new Promise((r) => setTimeout(r, wait));
    Document.prototype.querySelector = orig;
    return n;
  }, ms);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?tourqa=1');
  await expect(page.locator('#tourqa-ready')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-tour="cluster-tool"]')).toHaveClass(/tour-target/);
});

test('an idle step polls slowly instead of every frame', async ({ page }) => {
  await page.waitForTimeout(1000);          // let the arrival settle
  const n = await countAnchorLookups(page, 1500);
  // ~90 at 60 Hz before; a 200 ms poll is ~8.
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThan(20);
});

test('the pill still follows an anchor that moves with no input event', async ({ page }) => {
  const pill = page.locator('.onboarding-tour');
  await page.waitForTimeout(1000);
  const before = await pill.boundingBox();
  await page.evaluate(() => {
    const a = document.querySelector('[data-tour="cluster-tool"]');
    a.style.transform = 'translateY(120px)';
  });
  await expect.poll(async () => (await pill.boundingBox()).y, { timeout: 2000 })
    .toBeGreaterThan(before.y + 60);
});

test('the target ring pulses a few times, not forever', async ({ page }) => {
  const count = await page.locator('[data-tour="cluster-tool"]')
    .evaluate((el) => getComputedStyle(el).animationIterationCount);
  expect(count).not.toBe('infinite');
});
