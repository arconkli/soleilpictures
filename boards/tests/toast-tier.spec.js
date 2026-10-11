import { expect, test } from '@playwright/test';

// Toasts (Undo included) must be visible and clickable above every overlay:
// they rendered at z-index 1100, under the doc overlay and Settings. Driven
// through the DEV ?revealqa=1 harness, which mounts the real FeedbackProvider.

async function toastIsOnTop(page) {
  return page.evaluate(() => {
    const t = [...document.querySelectorAll('.toast')].pop();
    if (!t) return 'no toast';
    const r = t.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return t.contains(hit) ? 'top' : `covered by ${hit?.className || hit?.tagName}`;
  });
}

test('a toast is on top of Settings and of a later INT_MAX overlay, and is announced', async ({ page }) => {
  await page.goto('/?revealqa=1');
  await expect(page.locator('#revealqa-ready')).toBeVisible();
  // The announcer is mounted before any toast exists.
  const polite = page.locator('.sr-only[aria-live="polite"]');
  await expect(polite).toHaveCount(1);
  await expect(page.locator('.toast-stack')).toHaveCount(0);

  // Settings' real backdrop class (z-index 2147483646, full screen).
  await page.evaluate(() => {
    const bg = document.createElement('div');
    bg.className = 'settings-bg';
    document.body.appendChild(bg);
  });
  await page.locator('[data-reveal]').first().dispatchEvent('click');
  await expect(page.locator('.toast')).toHaveCount(1);
  expect(await toastIsOnTop(page)).toBe('top');
  await expect(polite).not.toHaveText('');

  // An overlay at the same max z-index opened AFTER the stack (Pricing from
  // Settings > Billing): the next toast must still land above it.
  await page.evaluate(() => {
    const top = document.createElement('div');
    top.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.3)';
    top.className = 'qa-intmax-overlay';
    document.body.appendChild(top);
  });
  await page.locator('[data-reveal]').nth(1).dispatchEvent('click');
  await expect(page.locator('.toast')).toHaveCount(2);
  expect(await toastIsOnTop(page)).toBe('top');
});
