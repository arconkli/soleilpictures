// Milanote-style focus: on the board-select (create) step — where a single rail
// tool is the .tour-target — the OTHER rail icons grey out (opacity 0.32) so the
// eye lands on the highlighted tool. It must NOT dim on the content step, where
// the rail itself is the target (all tools stay full so the user can pick any).
import { expect, test } from '@playwright/test';

test.describe('tour board-select step dims the other rail icons', () => {
  test('non-target rail tools grey out when a rail tool is the target', async ({ page }) => {
    await page.goto('/?local=1&reset=1');
    await expect(page.locator('.cnv-tools')).toBeVisible();

    // Simulate the create step: ring a single rail tool (the Cluster tool).
    await page.evaluate(() => {
      document.body.setAttribute('data-tour-active', '1');
      document.querySelector('[data-tour="cluster-tool"]').classList.add('tour-target');
    });

    const opacityOf = (sel) =>
      page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).opacity, sel);

    // A different (non-target) rail tool fades to the disabled opacity…
    await expect
      .poll(() => opacityOf('.cnv-tools .cnv-tool[aria-label="Add note tool"]'))
      .toBe('0.32');
    // …while the highlighted target stays full.
    expect(await opacityOf('[data-tour="cluster-tool"]')).toBe('1');

    await page.evaluate(() => {
      document.querySelector('[data-tour="cluster-tool"]').classList.remove('tour-target');
      document.body.removeAttribute('data-tour-active');
    });
  });

  test('content step (whole rail is the target) does NOT dim any tool', async ({ page }) => {
    await page.goto('/?local=1&reset=1');
    await expect(page.locator('.cnv-tools')).toBeVisible();

    // Simulate the content step: the rail container itself is the target.
    await page.evaluate(() => {
      document.body.setAttribute('data-tour-active', '1');
      document.querySelector('.cnv-tools').classList.add('tour-target');
    });

    const noteOpacity = await page.evaluate(
      () => getComputedStyle(document.querySelector('.cnv-tools .cnv-tool[aria-label="Add note tool"]')).opacity,
    );
    expect(noteOpacity).toBe('1');

    await page.evaluate(() => {
      document.querySelector('.cnv-tools').classList.remove('tour-target');
      document.body.removeAttribute('data-tour-active');
    });
  });
});
