import { expect, test } from '@playwright/test';

// Desktop visual regression baseline. Captures screenshots of the major
// surfaces at 1280×800 (the canonical desktop viewport). On the first run,
// Playwright writes the baseline PNGs to tests/visual/__screenshots__/.
// Subsequent runs diff against those baselines and fail on meaningful
// drift.
//
// To regenerate the baseline after an intentional desktop change, run:
//   npx playwright test tests/visual --update-snapshots --project=desktop-chrome
//
// Mobile projects skip this entire file at runtime — desktop pixel drift
// is meaningless on a phone viewport.

test.beforeEach(async ({ }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome',
    'desktop-baseline is only meaningful on the desktop-chrome project');
});

test.use({ viewport: { width: 1280, height: 800 } });

test('local studio shell — desktop baseline', async ({ page }) => {
  await page.goto('/?local=1');
  // Wait for the canvas surface that polish-smoke.spec already proves is
  // visible at this viewport. This anchors the shot to a known-good frame.
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.waitForTimeout(800);
  // Mask the grain layer — it animates and would cause every diff to fail.
  await expect(page).toHaveScreenshot('studio-shell.png', {
    fullPage: false,
    mask: [page.locator('.grain-canvas, .grain-surface')],
    maxDiffPixelRatio: 0.01,
  });
});
