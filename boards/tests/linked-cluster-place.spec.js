import { expect, test } from '@playwright/test';

// "Linked cluster" from the right-click Add menu must land AT the click point
// (it used to be the one Add action that ignored pos — addLink hardcoded
// x:1080). Seeded harness (no &blank=1) so the board picker has rows to pick.

test('right-click → Add → Linked cluster places the boardlink at the click point', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?local=1&reset=1');
  await page.waitForSelector('.canvas-wrap');
  // Seeded boards auto-frame on load — wait for the camera to stop moving so
  // the click→canvas mapping is stable across the menu → picker round-trip.
  await page.waitForFunction(() => {
    const el = document.querySelector('.canvas');
    if (!el) return false;
    const t = getComputedStyle(el).transform;
    if (window.__lcpLastT === t) { window.__lcpStable = (window.__lcpStable || 0) + 1; }
    else { window.__lcpStable = 0; window.__lcpLastT = t; }
    return window.__lcpStable >= 8;
  }, { polling: 100, timeout: 15000 });

  // Right-click a spot on empty canvas (clear of the seeded cards).
  const pt = await page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap');
    const r = wrap.getBoundingClientRect();
    // Spots deep inside the canvas so the mapped world point clears addLink's
    // x/y ≥ 8 clamp (a click near the world origin would legitimately shift).
    const spots = [
      [r.right - 200, r.bottom - 120],
      [r.right - 320, r.bottom - 200],
      [r.right - 200, r.top + 140],
    ];
    for (const [x, y] of spots) {
      const el = document.elementFromPoint(x, y);
      if (el && !el.closest('.card, .cnv-tool, .cnv-zoom, .inbox')) {
        el.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, clientX: x, clientY: y,
        }));
        return { x, y };
      }
    }
    return null;
  });
  expect(pt).not.toBeNull();

  const menu = page.locator('.ctx-menu').first();
  await expect(menu).toBeVisible();
  await menu.locator('.ctx-submenu-wrap', { hasText: 'Add' }).hover();
  await page.locator('.ctx-submenu').getByRole('button', { name: 'Linked cluster', exact: true }).click();

  // The board picker (CommandPalette pick mode) opens — pick the first result.
  const picker = page.getByPlaceholder('Search boards to link…');
  await expect(picker).toBeVisible();
  await picker.press('Enter');

  // The boardlink card centers on the right-click point.
  const link = page.locator('.card-kind-boardlink').first();
  await expect(link).toBeVisible();
  const box = await link.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  expect(Math.abs(cx - pt.x)).toBeLessThan(60);
  expect(Math.abs(cy - pt.y)).toBeLessThan(60);
});
