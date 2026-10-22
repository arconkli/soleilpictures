// The files sidebar on a tablet held sideways (?sidebarqa=1): desktop width,
// so the floating cards, with a finger for a pointer. Stacked, the files card
// showed about one file under its chrome; side by side, both cards run the
// full height (owner, 2026-10-20), and the button above the files stacks them.
import { expect, test } from '@playwright/test';

async function open(page) {
  await page.goto('/?sidebarqa=1');
  await page.waitForSelector('[data-sidebarqa-ready]');
  await expect(page.locator('.sbf-block').first()).toBeVisible();
}

const rectOf = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width };
});

test('clusters and files side by side, both the whole height, with room for a dozen files', async ({ page }) => {
  await open(page);
  await expect(page.locator('.sbf-frame')).toHaveClass(/is-side/);
  const vh = page.viewportSize().height;
  const tree = await rectOf(page.locator('.sbf-card.is-tree'));
  const files = await rectOf(page.locator('.sbf-card.is-files'));
  // Each card runs from the top margin to the bottom one.
  for (const card of [tree, files]) {
    expect(Math.round(card.top)).toBe(8);
    expect(Math.round(card.bottom)).toBe(vh - 8);
  }
  // Beside each other, about 470px together.
  expect(files.left).toBeGreaterThan(tree.right);
  expect(Math.round(files.right - tree.left + 8)).toBeLessThanOrEqual(480);
  // Rows a finger can take, and plenty of them in view.
  const rows = await page.locator('.sbf-files .sbf-file').evaluateAll((els, bottom) => els
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.height > 0 && r.bottom <= bottom).map((r) => Math.round(r.height)), files.bottom);
  expect(rows.length).toBeGreaterThanOrEqual(8);
  for (const h of rows) expect(h).toBe(44);
});

test('the button above the files stacks them, remembered, and puts them back', async ({ page }) => {
  await open(page);
  const toggle = page.locator('.sbf-iconbtn.is-reveal');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // Side by side is this screen's default, not a choice kept in gold.
  await expect(toggle).not.toHaveClass(/is-kept/);
  await toggle.tap();
  await expect(page.locator('.sbf-frame')).not.toHaveClass(/is-side/);
  await page.reload();
  await page.waitForSelector('[data-sidebarqa-ready]');
  await expect(page.locator('.sbf-frame')).not.toHaveClass(/is-side/);
  await page.locator('.sbf-iconbtn.is-reveal').tap();
  await expect(page.locator('.sbf-frame')).toHaveClass(/is-side/);
});

test('a finger sizing the files never stacks them', async ({ page }) => {
  await open(page);
  // The files' right edge, pulled well past where a mouse would stack them.
  const before = await rectOf(page.locator('.sbf-card.is-files'));
  const handle = page.locator('.sbf-handle[data-handle="right"], .sbf-handle.is-right').first();
  test.skip(!(await handle.count()), 'no right handle in this build');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 300, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.sbf-frame')).toHaveClass(/is-side/);
  const after = await rectOf(page.locator('.sbf-card.is-files'));
  expect(after.width).toBeLessThan(before.width);
  expect(Math.round(after.width)).toBeGreaterThanOrEqual(232);
});

test('Info’s drawer hangs 8px under the islands, which a finger makes taller', async ({ page }) => {
  await open(page);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('soleil-open-info', { detail: { boardId: 'film', cardIds: ['film-img-1'] } })));
  const drawer = page.locator('.cb-detail.is-drawer');
  await expect(drawer).toBeVisible();
  const island = await rectOf(page.locator('.chrome-island').first());
  expect(Math.round(island.height)).toBe(44);
  const box = await rectOf(drawer);
  expect(Math.round(box.top - island.bottom)).toBe(8);
});
