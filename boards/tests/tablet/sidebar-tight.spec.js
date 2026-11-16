// The files sidebar on a 10.2-inch iPad held sideways (?sidebarqa=1, 1080px
// wide): the desktop layout under a finger, where the two cards side by side
// took 472px. The files start folded to their heading under the clusters; one
// tap shows them, and that is remembered. An 11-inch iPad shows them from the
// start, as before (lib/sidebarLayout.js TOUCH_FILES_QUERY).
import { expect, test } from '@playwright/test';
import { bootSignedIn } from '../helpers/signedInStub.js';

async function open(page) {
  await page.goto('/?sidebarqa=1');
  await page.waitForSelector('[data-sidebarqa-ready]');
  await expect(page.locator('.sbf-card.is-tree')).toBeVisible();
}

test('1080 wide: the files start folded, one tap shows them, and a reload keeps them', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 810 });
  await open(page);
  const frame = page.locator('.sbf-frame');
  await expect(frame).toHaveClass(/is-files-hidden/);
  const bar = page.locator('.sbf-files-bar');
  await expect(bar).toBeVisible();
  await expect(page.locator('.sbf-files .sbf-file').first()).toBeHidden();
  // The folded card sits under the clusters' card, at its width.
  const tree = await page.locator('.sbf-card.is-tree').boundingBox();
  const files = await page.locator('.sbf-card.is-files').boundingBox();
  expect(files.y).toBeGreaterThanOrEqual(tree.y + tree.height);
  expect(Math.round(files.width)).toBe(Math.round(tree.width));
  expect(tree.x + tree.width).toBeLessThan(260);

  await bar.tap();
  await expect(frame).not.toHaveClass(/is-files-hidden/);
  await expect(frame).toHaveClass(/is-side/);
  await expect(page.locator('.sbf-files .sbf-file').first()).toBeVisible();

  await page.reload();
  await page.waitForSelector('[data-sidebarqa-ready]');
  await expect(frame).toHaveClass(/is-side/);
  await expect(frame).not.toHaveClass(/is-files-hidden/);

  // Hide folds them again, and that is remembered too.
  await page.locator('.sbf-files-hide').tap();
  await expect(frame).toHaveClass(/is-files-hidden/);
  await page.reload();
  await page.waitForSelector('[data-sidebarqa-ready]');
  await expect(frame).toHaveClass(/is-files-hidden/);
});

test('1194 wide: the files show from the start', async ({ page }) => {
  await page.setViewportSize({ width: 1194, height: 834 });
  await open(page);
  const frame = page.locator('.sbf-frame');
  await expect(frame).toHaveClass(/is-side/);
  await expect(frame).not.toHaveClass(/is-files-hidden/);
  await expect(page.locator('.sbf-files .sbf-file').first()).toBeVisible();
});

test('what a 1080 wide screen shows leaves a wider one as it was', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 810 });
  await open(page);
  await expect(page.locator('.sbf-frame')).toHaveClass(/is-files-hidden/);
  await page.setViewportSize({ width: 1194, height: 834 });
  await expect(page.locator('.sbf-frame')).toHaveClass(/is-side/);
  await expect(page.locator('.sbf-frame')).not.toHaveClass(/is-files-hidden/);
});

// The real app, not the harness: App.jsx works the fit out and hands it to the
// sidebar and to the room the board leaves for it (--sb-w).
test('the app at 1080 wide: the files start folded, the board has the room, and a tap shows them', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 810 });
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch (_) {} });
  await bootSignedIn(page, {
    rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] },
  });
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.sb-ws-trigger')).toBeVisible();
  const frame = page.locator('.sbf-frame');
  await expect(frame).toHaveClass(/is-files-hidden/);
  const sbw = () => page.locator('.app').evaluate((el) => parseFloat(el.style.getPropertyValue('--sb-w')));
  const folded = await sbw();
  expect(folded).toBeGreaterThan(0);
  expect(folded).toBeLessThan(260);
  // The clusters' card and its margin, nothing more.
  const tree = await page.locator('.sbf-card.is-tree').boundingBox();
  expect(Math.round(tree.x + tree.width)).toBe(Math.round(folded));

  await page.locator('.sbf-files-bar').tap();
  await expect(frame).not.toHaveClass(/is-files-hidden/);
  await expect.poll(sbw).toBeGreaterThan(folded);
});
