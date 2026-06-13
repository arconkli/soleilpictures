// Theme bootstrap regression — the pre-React inline script in index.html
// resolves the rendered theme before React mounts, with the precedence:
//
//   explicit user choice (soleil.ui cache) → OS prefers-color-scheme → dark
//
// This is the cold-load / reload half of the "theme resets when you open the
// admin dashboard" fix. A returning user's explicit choice must survive every
// reload regardless of their OS theme, and a brand-new visitor must pick up
// their OS theme. Runs on the unauthenticated landing screen (no theme writer
// there) so the asserted attribute is purely the bootstrap's output.
//
// Mirrors lib/theme.js `resolveTheme`; keep the two in lockstep.

import { test, expect } from '@playwright/test';

async function loadWith(page, { cache, colorScheme }) {
  if (colorScheme) await page.emulateMedia({ colorScheme });
  // Seed (or clear) the soleil.ui cache BEFORE the document's inline
  // bootstrap runs on the next navigation.
  await page.addInitScript((c) => {
    try {
      if (c === null) localStorage.removeItem('soleil.ui');
      else localStorage.setItem('soleil.ui', JSON.stringify(c));
    } catch (_) { /* ignore */ }
  }, cache ?? null);
  await page.goto('/');
}

test.describe('theme bootstrap precedence', () => {
  test('no explicit choice + light OS → light', async ({ page }) => {
    await loadWith(page, { cache: null, colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('no explicit choice + dark OS → dark', async ({ page }) => {
    await loadWith(page, { cache: null, colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('explicit dark wins over light OS', async ({ page }) => {
    await loadWith(page, { cache: { theme: 'dark' }, colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('explicit light wins over dark OS, and survives a reload', async ({ page }) => {
    await loadWith(page, { cache: { theme: 'light' }, colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // The reset bug: a light user flips to dark on reload/remount. It must not.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});
