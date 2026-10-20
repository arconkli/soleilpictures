// Only the newest sign-in code works, and an address with no ending is refused.
//
// Asking again kills the code before it, and nothing said so: one person
// resent, then typed the old code three times. An address with no real ending
// (@ddsb, @a.m) passed the browser's own check, and submitting it created an
// account whose code went nowhere.
//
// The OTP send, the verify and every analytics write are intercepted: no email
// leaves and no row reaches the production table.
import { test, expect } from '@playwright/test';

async function isolate(page, sent) {
  await page.route('**/auth/v1/otp**', (route) => {
    try { sent.push(route.request().postDataJSON()?.email); } catch { /* ignore */ }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/rest/v1/analytics_events**', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: '[]' }));
}

const rejectEveryCode = (page) => page.route('**/auth/v1/verify**', (route) => route.fulfill({
  status: 403, contentType: 'application/json',
  body: JSON.stringify({ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }),
}));

test('an address with no ending is refused before any code is sent', async ({ page }) => {
  const sent = [];
  await isolate(page, sent);
  await page.goto('/');
  const field = page.getByLabel('Email address');
  await expect(field).toBeVisible({ timeout: 15000 });
  for (const addr of ['someone@ddsb', 'someone@a.m']) {
    await field.fill(addr);
    await page.getByRole('button', { name: /Continue with email/ }).click();
    await expect(page.locator('.auth-error')).toContainText('missing its ending');
    await expect(page.locator('.auth-code-input')).toHaveCount(0);
  }
  // A known provider typed bare keeps its one-tap fix, and the fixed address sends.
  await field.fill('someone@gmail');
  await page.getByRole('button', { name: /Did you mean/ }).click();
  await expect(field).toHaveValue('someone@gmail.com');
  await page.getByRole('button', { name: /Continue with email/ }).click();
  await expect(page.locator('.auth-code-input')).toBeVisible({ timeout: 15000 });
  expect(sent).toEqual(['someone@gmail.com']);
});

test('one code: the step and a wrong code read as before', async ({ page }) => {
  const sent = [];
  await isolate(page, sent);
  await rejectEveryCode(page);
  await page.goto('/');
  await page.getByLabel('Email address').fill('first-try@gmail.com');
  await page.getByRole('button', { name: /Continue with email/ }).click();
  const input = page.locator('.auth-code-input');
  await expect(input).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Check your inbox for the 6-digit code/)).toBeVisible();
  await input.fill('123456');
  await expect(page.locator('.auth-error')).toHaveText("That code didn't match. Check the digits, or request a new one.");
});

test('after a resend, the step and a wrong code say only the newest works, across a reload', async ({ page }) => {
  const sent = [];
  await page.clock.install();
  await isolate(page, sent);
  await rejectEveryCode(page);
  await page.goto('/');
  await page.getByLabel('Email address').fill('resender@gmail.com');
  await page.getByRole('button', { name: /Continue with email/ }).click();
  const input = page.locator('.auth-code-input');
  await expect(input).toBeVisible({ timeout: 15000 });

  await page.clock.setSystemTime(Date.now() + 61_000);
  await page.clock.runFor(1100);
  await page.getByRole('button', { name: 'Resend code' }).click();
  await expect(page.getByText(/New code sent\. Only the newest one works/)).toBeVisible();
  expect(sent).toEqual(['resender@gmail.com', 'resender@gmail.com']);

  await input.fill('123456');
  await expect(page.locator('.auth-error')).toContainText('Only the newest code works');

  // The phone case: back from the mail app to a reloaded tab.
  await page.reload();
  await expect(input).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/New code sent\. Only the newest one works/)).toBeVisible();

  // Editing the address starts over at one code.
  await page.getByRole('button', { name: 'edit' }).click();
  await page.getByRole('button', { name: /Continue with email/ }).click();
  await expect(page.getByText(/Check your inbox for the 6-digit code/)).toBeVisible({ timeout: 15000 });
});
