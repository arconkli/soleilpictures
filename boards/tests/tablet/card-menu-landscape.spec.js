// A card's menu under a finger on an iPad held sideways: the desktop layout,
// so the menu stays beside the ⋯ that opened it instead of rising as a sheet,
// and a finger still fits it: its quick row and its rows 44px tall (plan.md
// §2.2 and §2.3, "iPad: anchored popover, quick row 44px tall, rows 44px").
// An upright iPad is in the phone's shell and gets the sheet
// (mobile/phone-sheet.spec.js).
import { expect, test } from '@playwright/test';
import { tap } from '../touch/helpers.js';

const MIN = 44;
const menu = (page) => page.locator('.ctx-menu:not(.ctx-submenu)');

test('a card\'s ⋯ opens the menu beside it, not a sheet, with its quick row and rows a finger tall', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await page.waitForSelector('.canvas-wrap .card', { timeout: 30000 });
  // The board fits itself to its cards once they land; let the camera settle.
  await page.waitForTimeout(900);
  const b = await page.locator('[data-card-id="home-image"]').boundingBox();
  await tap(page, { x: b.x + b.width / 2, y: b.y + b.height - 6 });
  const more = page.locator('.sel-menu > .card-menu-btn');
  await expect(more).toBeVisible();
  const m0 = await more.boundingBox();
  await tap(page, { x: m0.x + m0.width / 2, y: m0.y + m0.height / 2 });
  await expect(menu(page)).toBeVisible();
  // Measured once its opening scale (0.98 to 1, plan.md §2.1) has run.
  await menu(page).evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));

  // Anchored: no sheet, no sheet header, and near the ⋯.
  await expect(menu(page)).not.toHaveClass(/is-sheet/);
  await expect(page.locator('.ctx-sheet-head')).toHaveCount(0);
  const box = await menu(page).boundingBox();
  const gap = Math.hypot(
    Math.max(box.x - (m0.x + m0.width), 0, m0.x - (box.x + box.width)),
    Math.max(box.y - (m0.y + m0.height), 0, m0.y - (box.y + box.height)));
  expect(gap).toBeLessThan(48);

  // Cut, Copy, Duplicate, Delete as the quick row's buttons, each 44px tall.
  const quick = menu(page).locator('.ctx-quick').getByRole('menuitem');
  await expect(quick).toHaveCount(4);
  for (const q of await quick.all()) {
    expect((await q.boundingBox()).height).toBeGreaterThanOrEqual(MIN);
  }
  // Every row of the list a finger tall.
  const rows = menu(page).locator('button.ctx-item');
  expect(await rows.count()).toBeGreaterThan(3);
  for (const r of await rows.all()) {
    expect((await r.boundingBox()).height).toBeGreaterThanOrEqual(MIN);
  }
});
