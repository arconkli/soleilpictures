// Universe scale bench — drives the REAL UniverseGraph pipeline
// (snapshot paging → worker layout → disc/halo/sphere rendering)
// over a synthetic corpus via the DEV-only admin preview harness.
//
// The regression this guards: the universe silently capping at
// PostgREST's 1,000-row truncation. Every requested node must make it
// through paging AND into the render state, at a size 30× the old
// visible universe and well past anything a single snapshot page
// carries.

import { test, expect } from '@playwright/test';

test.describe('admin universe at scale', () => {
  test('every synthetic node survives paging into render state', async ({ page }) => {
    await page.goto('/?adminpreview=1&tab=universe&n=30000');

    // The harness stamps expected totals; UniverseGraph stamps what
    // actually made it into refs.nodes after the full page walk.
    await page.waitForFunction(
      () => window.__universeQaStats && window.__universeQaExpected,
      null, { timeout: 90000 },
    );
    const { stats, expected } = await page.evaluate(() => ({
      stats: window.__universeQaStats,
      expected: window.__universeQaExpected,
    }));
    expect(stats.nodes).toBe(expected.nodes);
    expect(stats.nodes).toBeGreaterThanOrEqual(30000);
    // Orphan-free synthetic corpus: every edge resolves.
    expect(stats.edges).toBe(expected.edges);

    // Worker settles → calibration overlay clears and the scene is live.
    await expect(page.locator('.universe-overlay')).toHaveCount(0, { timeout: 90000 });
    await expect(page.locator('.universe-canvas canvas')).toBeVisible();
  });

  test('clicking a node opens the pick affordance', async ({ page }) => {
    await page.goto('/?adminpreview=1&tab=universe&n=2000');
    await page.waitForFunction(() => window.__universeQaStats, null, { timeout: 90000 });
    await expect(page.locator('.universe-overlay')).toHaveCount(0, { timeout: 90000 });
    // Poke around the center of the canvas until a node hit registers —
    // the fit framing guarantees the bulk of the universe is on screen.
    const canvas = page.locator('.universe-canvas canvas');
    const box = await canvas.boundingBox();
    let picked = false;
    for (let i = 0; i < 25 && !picked; i++) {
      const x = box.x + box.width * (0.3 + 0.4 * Math.random());
      const y = box.y + box.height * (0.3 + 0.4 * Math.random());
      await page.mouse.click(x, y);
      picked = (await page.getByTestId('universe-qa-picked').count()) > 0;
      // A miss enters pointer-lock fly mode — leave it before retrying.
      if (!picked) await page.keyboard.press('Escape');
    }
    expect(picked).toBe(true);
  });
});
