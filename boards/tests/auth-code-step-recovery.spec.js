// The sign-in code step recovers from the things that happen on a phone.
//
// ACCOUNT-07: the resend countdown was decremented once per timer tick, and a
// phone suspends timers while you're in the mail app, so it resumed where it
// froze. It is read off the wall clock now. ACCOUNT-08: a wrong code left the
// field full (maxLength 6) and unfocused, with the keyboard gone. ACCOUNT-06:
// "Explore a live board" sat under the code form, a competing exit at the step
// people abandon most.
//
// The OTP send, the verify and every analytics write are intercepted: no email
// leaves and no row reaches the production table.
import { test, expect } from '@playwright/test';

async function isolate(page) {
  await page.route('**/auth/v1/otp**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/rest/v1/analytics_events**', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: '[]' }));
}

const seed = (page, entry) => page.addInitScript((e) => {
  try { localStorage.setItem('soleil.auth.pendingCode', JSON.stringify({ ...e, sentAt: Date.now() + e.offset })); } catch { /* ignore */ }
}, entry);

test('the resend countdown catches up after the tab was in the background', async ({ page }) => {
  await page.clock.install();
  await isolate(page);
  await seed(page, { email: 'phone-user@gmail.com', offset: -5_000 });
  await page.goto('/');
  await expect(page.locator('.auth-code-input')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /Resend in \d+s/ })).toBeVisible();

  // Two minutes pass with no timer firing (a suspended tab), then the person
  // comes back to it.
  await page.clock.setSystemTime(Date.now() + 2 * 60 * 1000);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: 'Resend code' })).toBeEnabled();
});

test('one tick after a long suspension reads the real time, not the frozen count', async ({ page }) => {
  await page.clock.install();
  await isolate(page);
  await seed(page, { email: 'phone-user@gmail.com', offset: -5_000 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Resend in \d+s/ })).toBeVisible({ timeout: 15000 });
  await page.clock.setSystemTime(Date.now() + 2 * 60 * 1000);
  await page.clock.runFor(1100);
  await expect(page.getByRole('button', { name: 'Resend code' })).toBeEnabled();
});

test('a wrong code empties the field and hands focus back', async ({ page }) => {
  await isolate(page);
  await page.route('**/auth/v1/verify**', (route) => route.fulfill({
    status: 403, contentType: 'application/json',
    body: JSON.stringify({ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }),
  }));
  await seed(page, { email: 'wrong-code@gmail.com', offset: 0 });
  await page.goto('/');
  const input = page.locator('.auth-code-input');
  await expect(input).toBeVisible({ timeout: 15000 });
  await input.fill('123456');               // auto-submits on the sixth digit
  await expect(page.locator('.auth-error')).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(input).toBeEnabled();
  await expect(input).toBeFocused();
  // Typing again clears the stale message.
  await page.keyboard.type('6');
  await expect(input).toHaveValue('6');
  await expect(page.locator('.auth-error')).toHaveCount(0);
});

test('the explore-a-board exit is offered on the email step, not the code step', async ({ page }) => {
  await isolate(page);
  await page.goto('/');
  await expect(page.getByLabel('Email address')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('a.sb-explore')).toHaveCount(1);
  await page.getByLabel('Email address').fill('e2e-explore@gmail.com');
  await page.getByRole('button', { name: /Continue with email/ }).click();
  await expect(page.locator('.auth-code-input')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('a.sb-explore')).toHaveCount(0);
});
