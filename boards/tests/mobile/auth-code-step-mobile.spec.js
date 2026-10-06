// Phones are where the code step was being lost: "sent, switched to the mail
// app, never came back". After a reload the step must still be there, with the
// inbox shortcut on screen. OTP send and analytics writes are intercepted.
import { test, expect } from '@playwright/test';

test('on a phone, the code step and its inbox shortcut survive a reload', async ({ page }) => {
  await page.route('**/auth/v1/otp**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/rest/v1/analytics_events**', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: '[]' }));
  await page.goto('/');
  await page.getByLabel('Email address').fill('e2e-phone-step@gmail.com');
  await page.getByRole('button', { name: /Continue with email/ }).click();
  await expect(page.locator('.auth-code-input')).toBeVisible({ timeout: 15000 });

  await page.reload();
  await expect(page.locator('.auth-code-input')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.auth-email-readonly')).toHaveText('e2e-phone-step@gmail.com');
  const box = page.locator('a.auth-mailbox');
  await expect(box).toBeInViewport();
  await expect(box).toHaveText('Open Gmail');
});
