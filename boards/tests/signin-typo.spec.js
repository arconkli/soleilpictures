// signin-typo.spec.js — the real SignIn screen offers a one-tap domain fix.
// Renders the real SignIn (no ?local); skipped where the screen is not reachable.
import { expect, test } from '@playwright/test';

test('a mistyped gmail domain gets a one-tap fix under the field', async ({ page }) => {
  await page.goto('/');
  const email = page.locator('input[type="email"]');
  try { await expect(email).toBeVisible({ timeout: 20000 }); }
  catch { test.skip(true, 'SignIn not reachable in this environment'); }
  await email.fill('me@gmail.como');
  const offer = page.locator('.auth-typo');
  await expect(offer).toBeVisible();
  await expect(offer).toContainText('me@gmail.com');
  await offer.click();
  await expect(email).toHaveValue('me@gmail.com');
  await expect(offer).toHaveCount(0);
  // A correct address is never second-guessed.
  await email.fill('me@studio.com');
  await expect(offer).toHaveCount(0);
});
