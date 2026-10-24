import { expect, test } from '@playwright/test';

// A view-only member or a public link can page a schedule to another month.
// ‹ › / Today / the date jump only move this viewer's local anchor, so they
// were never the editors' to gate (CARDS-08). ?roqa=1 renders the local board
// read-only (canEdit=false, isPublic=true).

test('a read-only viewer can page a schedule to the next month and back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForSelector('.canvas-wrap');
  const canvas = page.locator('.canvas-wrap');
  await canvas.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: rect.left + 520, clientY: rect.top + 200,
    }));
  });
  await page.locator('.ctx-menu').first().locator('.ctx-submenu-wrap', { hasText: 'Add' }).hover();
  await page.locator('.ctx-submenu').getByRole('menuitem', { name: 'Schedule', exact: true }).click();
  await expect(page.locator('.schedc')).toBeVisible();
  // Let the local harness persist the board before reopening it read-only.
  await page.waitForTimeout(800);

  await page.goto('/?local=1&roqa=1&blank=1');
  const sched = page.locator('.schedc');
  await expect(sched).toBeVisible();
  // Editor-only controls stay hidden for the viewer…
  await expect(sched.getByRole('group', { name: 'Schedule view' })).toHaveCount(0);
  // …but paging is there.
  const title = sched.locator('.schedc-title').first();
  const before = (await title.innerText()).trim();
  await sched.getByRole('button', { name: 'Next' }).click();
  await expect(title).not.toHaveText(before);
  await sched.getByRole('button', { name: 'Go to today' }).click();
  await expect(title).toHaveText(before);
});
