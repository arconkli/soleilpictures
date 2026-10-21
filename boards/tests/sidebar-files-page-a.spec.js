// The full Files page in direction A's look on the sidebar QA harness
// (?sidebarqa=1&surface=files; the harness gives the page A's look unless
// &look=today). Run: npx playwright test tests/sidebar-files-page-a.spec.js --project=desktop-chrome
import { test, expect } from '@playwright/test';

const page_ = (extra = '') => `/?sidebarqa=1&surface=files${extra}`;
async function open(page, extra = '') {
  await page.goto(page_(extra));
  await page.locator('[data-sidebarqa-ready]').waitFor();
  await page.locator('.list-wrap').first().waitFor();
}
async function drag(page, id, dx, dy, { steps = 8 } = {}) {
  const b = await page.locator(`[data-handle="${id}"]`).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
  await page.mouse.up();
}

test.describe('one Files at a time', () => {
  test('the sidebar card folds to its bar while the page is open, its meter kept', async ({ page }) => {
    await open(page);
    const card = page.locator('.sbf-card.is-files');
    await expect(card).toHaveClass(/is-page-fold/);
    const bar = page.locator('.sbf-files-bar.is-page');
    await expect(bar).toContainText('Files');
    await expect(bar).toContainText('full screen');
    await expect(bar).toContainText('Shrink');
    await expect(page.locator('.sbf-card.is-files > .sbf-files')).toBeHidden();
    await expect(page.locator('.sbf-meter')).toBeVisible();
    await expect(page.locator('.list-wrap')).toHaveAttribute('data-look', 'sb');
    await expect(page.locator('.app')).toHaveClass(/is-files-page/);
  });

  test('Shrink in the bar goes back to the board, the card open', async ({ page }) => {
    await open(page);
    await page.locator('.sbf-files-bar.is-page').click();
    await expect(page.locator('[data-sidebarqa-surface="board"]')).toBeVisible();
    await expect(page.locator('.sbf-card.is-files > .sbf-files')).toBeVisible();
    await expect(page.locator('.app')).not.toHaveClass(/is-files-page/);
  });

  test('Shrink opens the card even when it was hidden before', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('soleil.ui.sidebarLayout', JSON.stringify({ filesHidden: true })));
    await open(page);
    await page.locator('.sbf-files-bar.is-page').click();
    await expect(page.locator('.sbf-card.is-files > .sbf-files')).toBeVisible();
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('soleil.ui.sidebarLayout') || '{}'));
    expect(kept.filesHidden).toBe(false);
  });

  test('a handle dragged while the page is open never keeps the fold', async ({ page }) => {
    await open(page);
    await drag(page, 'treeRight', 30, 0);
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('soleil.ui.sidebarLayout') || '{}'));
    expect(kept.filesHidden).not.toBe(true);
  });

  test('⌘\\ (Ctrl here) shrinks the page back into the sidebar', async ({ page }) => {
    await open(page);
    await page.locator('.list-wrap').click({ position: { x: 600, y: 600 } });
    await page.keyboard.press('Control+Backslash');
    await expect(page.locator('[data-sidebarqa-surface="board"]')).toBeVisible();
    await expect(page.locator('.sbf-card.is-files > .sbf-files')).toBeVisible();
  });

  test('&look=today keeps the page and the card as production has them', async ({ page }) => {
    await open(page, '&look=today');
    await expect(page.locator('.sbf-card.is-files')).not.toHaveClass(/is-folded/);
    await expect(page.locator('.list-wrap')).not.toHaveAttribute('data-look', /.+/);
    await expect(page.locator('.app')).not.toHaveClass(/is-files-page/);
  });
});
