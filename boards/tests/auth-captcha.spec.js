// The sign-in code request carries a Turnstile token once a site key is built
// in (src/auth/turnstile.js, 2026-10-06 audit).
//
// Runs only when a key is set, against a dev server started with it — use
// Cloudflare's always-pass invisible test key, on a port of its own so a
// running server (built without the key) is not reused:
//
//   PW_PORT=5198 VITE_TURNSTILE_SITE_KEY=1x00000000000000000000BB \
//     npx playwright test tests/auth-captcha.spec.js --project=desktop-chrome
//
// Without a key the app sends no token at all, which is today's production
// behaviour until the owner creates the widget.
//
// The OTP send and every analytics write are intercepted: no email leaves.
import { test, expect } from '@playwright/test';

test.skip(!process.env.VITE_TURNSTILE_SITE_KEY, 'needs VITE_TURNSTILE_SITE_KEY on a dev server started with it');

test('a code request carries a Turnstile token', async ({ page }) => {
  const sent = [];
  await page.route('**/auth/v1/otp**', async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/rest/v1/analytics_events**', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: '[]' }));

  await page.goto('/');
  await page.getByLabel('Email address').fill('e2e-captcha@gmail.com');
  await page.getByRole('button', { name: /Continue with email/ }).click();
  await expect(page.locator('.auth-code-input')).toBeVisible({ timeout: 30000 });

  expect(sent).toHaveLength(1);
  const token = sent[0]?.gotrue_meta_security?.captcha_token;
  expect(token, `no captcha token in ${JSON.stringify(sent[0])}`).toBeTruthy();
  // An invisible pass leaves nothing on screen.
  await expect(page.locator('.auth-captcha')).toBeHidden();
});
