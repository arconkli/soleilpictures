// The sign-in code step survives a reload, and helps people find the code.
//
// A phone goes to its mail app to read the code and can come back to a reloaded
// tab. The code step used to live only in React state, so that person faced an
// empty email field and no sign their code was coming — and after the 09-20
// invite abuse, Gmail filed codes as spam for most of a week while people
// waited here. lib/pendingCode.js remembers the address (never the code) for a
// short window; lib/mailboxLink.js offers the inbox, searching every folder.
//
// The OTP send and every analytics write are intercepted: no email leaves and
// no row reaches the production table.
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

test('the code step survives a reload, with the address and an inbox shortcut', async ({ page }) => {
  await isolate(page);
  await page.goto('/');
  await page.getByLabel('Email address').fill('e2e-code-step@gmail.com');
  await page.getByRole('button', { name: /Continue with email/ }).click();
  await expect(page.locator('.auth-code-input')).toBeVisible({ timeout: 15000 });

  await page.reload();
  await expect(page.locator('.auth-code-input')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.auth-email-readonly')).toHaveText('e2e-code-step@gmail.com');
  // The resend cooldown resumes rather than restarting at zero.
  await expect(page.getByRole('button', { name: /Resend in \d+s/ })).toBeVisible();

  const box = page.locator('a.auth-mailbox');
  await expect(box).toHaveText('Open Gmail');
  await expect(box).toHaveAttribute('target', '_blank');
  expect(decodeURIComponent(await box.getAttribute('href'))).toContain('in:anywhere');
  await expect(page.locator('.auth-work-hint')).toHaveCount(0);

  // "edit" forgets the step: a reload is back on the email field.
  await page.getByRole('button', { name: 'edit' }).click();
  await page.reload();
  await expect(page.getByLabel('Email address')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.auth-code-input')).toHaveCount(0);
});

test('an expired code step falls back to the email field', async ({ page }) => {
  await isolate(page);
  await seed(page, { email: 'old-step@gmail.com', offset: -16 * 60 * 1000 });
  await page.goto('/');
  await expect(page.getByLabel('Email address')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.auth-code-input')).toHaveCount(0);
});

test('a work address is told how to get a code through, and gets no inbox link', async ({ page }) => {
  await isolate(page);
  await seed(page, { email: 'producer@studio.film', offset: 0 });
  await page.goto('/');
  await expect(page.locator('.auth-code-input')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.auth-work-hint')).toBeVisible();
  await expect(page.locator('a.auth-mailbox')).toHaveCount(0);
});
