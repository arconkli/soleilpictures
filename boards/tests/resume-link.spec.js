import { expect, test } from '@playwright/test';

// /resume is the landing for every lifecycle email CTA. It must render for a
// visitor with NO session — booting AuthGate here would show the exact sign-in
// wall the page exists to skip, which is what the win-back program was dying on.
//
// Redemption itself is server-side and is covered against the deployed edge
// function (single-use, expiry, and a GET leaving the token unspent). What is
// worth pinning in the browser is the routing and the two visible states.

const VALID_SHAPE = 'a'.repeat(64);   // 64 hex chars — the mint's shape

test('a resume link renders the resume prompt, not the sign-in wall', async ({ page }) => {
  await page.goto(`/resume?rt=${VALID_SHAPE}&w=ws-1&b=board-1&lc=reengage_1`);

  await expect(page.getByRole('button', { name: /Open my clusters/i })).toBeVisible({ timeout: 15000 });
  // The OTP form belongs to AuthGate; seeing it here means the route fell through.
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
});

test('a spent or malformed token degrades to ordinary sign-in', async ({ page }) => {
  await page.goto('/resume?rt=not-a-real-token');

  await expect(page.getByText(/already been used or has expired/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('link', { name: /^Sign in$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Open my clusters/i })).toHaveCount(0);
});

test('a resume link with no token at all still offers a way in', async ({ page }) => {
  await page.goto('/resume');

  await expect(page.getByRole('link', { name: /^Sign in$/i })).toBeVisible({ timeout: 15000 });
});
