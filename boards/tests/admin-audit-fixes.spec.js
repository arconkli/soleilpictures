// Admin audit fixes (2026-10-11 platform audit, ADMIN-*).
//
// Each guard here pins one finding on the DEV-only fixture harness
// (?adminpreview=1): no auth, no network, nothing written anywhere. The harness
// numbers are synthetic, so what is asserted is the rule, never a figure.

import { test, expect } from '@playwright/test';

async function openAdmin(page, { tab = 'overview', view, theme = 'dark', query = '' } = {}) {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem('soleil.ui', JSON.stringify({ theme: t }));
      document.documentElement.setAttribute('data-theme', t);
    } catch { /* ignore */ }
  }, theme);
  await page.goto(`/?adminpreview=1&tab=${tab}${view ? `&view=${view}` : ''}${query}`);
}

test.describe('admin funnel (ADMIN-1)', () => {
  test('the retired Welcome page is not drawn, and the ⚠ and Biggest leak agree', async ({ page }) => {
    await openAdmin(page, { view: 'funnel' });
    const hero = page.locator('.admin-hero-funnel').first();
    await expect(hero).toBeVisible({ timeout: 15000 });

    await expect(hero.locator('.admin-funnel-row-label', { hasText: 'Welcome page' })).toHaveCount(0);
    await expect(hero.locator('.admin-funnel-fork')).not.toContainText(/Welcome/);

    const flagged = (await hero.locator('.is-biggest-leak .admin-funnel-row-label').innerText()).trim();
    const leak = (await page.locator('.adm-leak-step').innerText()).trim();
    expect(leak).not.toMatch(/Welcome/);
    expect(leak.endsWith(`→ ${flagged}`)).toBe(true);
  });
});
