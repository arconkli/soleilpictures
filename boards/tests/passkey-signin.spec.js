// Passkeys on the sign-in box (lib/passkeys.js, 2026-10-29).
//
//   npx playwright test tests/passkey-signin.spec.js --project=desktop-chrome
//
// Passkeys only work on the production host, so the box hides them anywhere
// else. ?pkqa=1 (dev builds only) lifts that check, and a stand-in
// PublicKeyCredential plays the browser; Supabase's passkey endpoints and
// every analytics write are intercepted. Nothing real is signed in.
import { test, expect } from '@playwright/test';

const CHALLENGE = 'q83vEjRWeJA'; // base64url bytes, any will do

// A stand-in for the browser's WebAuthn: conditional requests wait until
// aborted, as a real one waits for the person to pick; a modal one does what
// window.__pkModal says ('cancel' or 'pick').
function fakeWebAuthn() {
  class FakePKC {}
  FakePKC.isConditionalMediationAvailable = async () => true;
  FakePKC.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
  window.PublicKeyCredential = FakePKC;
  window.__pkRequests = [];
  const cred = () => Object.assign(Object.create(FakePKC.prototype), {
    id: 'cred-1',
    type: 'public-key',
    toJSON: () => ({ id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: {}, clientExtensionResults: {} }),
  });
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: {
      get: (opts) => {
        window.__pkRequests.push(opts.mediation || 'modal');
        if (opts.mediation === 'conditional') {
          return new Promise((_, reject) => {
            opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          });
        }
        if (window.__pkModal === 'pick') return Promise.resolve(cred());
        return Promise.reject(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'));
      },
      create: () => Promise.reject(new DOMException('no', 'NotAllowedError')),
    },
  });
}

async function quiet(page) {
  await page.route('**/rest/v1/analytics_events**', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: '[]' }));
}

async function passkeyServer(page, { verify } = {}) {
  await page.route('**/auth/v1/passkeys/authentication/options', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        challenge_id: 'ch-1',
        expires_at: Math.floor(Date.now() / 1000) + 300,
        options: { challenge: CHALLENGE, rpId: 'clusters.soleilpictures.com', timeout: 300000, userVerification: 'preferred' },
      }),
    }));
  await page.route('**/auth/v1/passkeys/authentication/verify', (route) =>
    route.fulfill(verify || { status: 500, contentType: 'application/json', body: '{}' }));
}

test('no passkey where the browser has none', async ({ page }) => {
  await quiet(page);
  await page.addInitScript(() => { delete window.PublicKeyCredential; });
  await page.goto('/?pkqa=1');
  const email = page.getByLabel('Email address');
  await expect(email).toBeVisible({ timeout: 30000 });
  await expect(email).toHaveAttribute('autocomplete', 'email');
  await expect(page.getByRole('button', { name: 'Use a passkey' })).toHaveCount(0);
});

test('no passkey off the production host', async ({ page }) => {
  await quiet(page);
  await page.addInitScript(fakeWebAuthn);
  await page.goto('/');
  await expect(page.getByLabel('Email address')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: 'Use a passkey' })).toHaveCount(0);
  await expect(page.getByLabel('Email address')).toHaveAttribute('autocomplete', 'email');
});

test('the email field offers passkeys, and the quiet link opens the sheet', async ({ page }) => {
  await quiet(page);
  await passkeyServer(page);
  await page.addInitScript(fakeWebAuthn);
  await page.goto('/?pkqa=1');
  const email = page.getByLabel('Email address');
  await expect(email).toHaveAttribute('autocomplete', 'email webauthn', { timeout: 30000 });
  const link = page.getByRole('button', { name: 'Use a passkey' });
  await expect(link).toBeVisible();
  // No wait starts (and no challenge is asked for) until a person is there…
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__pkRequests.length)).toBe(0);
  // …then the autofill wait is running…
  await page.mouse.move(40, 40);
  await expect.poll(() => page.evaluate(() => window.__pkRequests.join(','))).toBe('conditional');
  // …and the link's sheet takes over; closing it says nothing and the wait
  // starts again.
  await link.click();
  await expect.poll(() => page.evaluate(() => window.__pkRequests.join(','))).toBe('conditional,modal,conditional');
  await expect(page.locator('.auth-error')).toHaveCount(0);
  await expect(link).toBeEnabled();
});

test('a passkey the server no longer knows says so in plain words', async ({ page }) => {
  await quiet(page);
  await passkeyServer(page, {
    verify: {
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ code: 404, error_code: 'webauthn_credential_not_found', msg: 'Credential not found' }),
    },
  });
  await page.addInitScript(fakeWebAuthn);
  await page.addInitScript(() => { window.__pkModal = 'pick'; });
  await page.goto('/?pkqa=1');
  await page.getByRole('button', { name: 'Use a passkey' }).click({ timeout: 30000 });
  await expect(page.locator('.auth-error')).toContainText("isn't on your account", { timeout: 15000 });
  // Still on the email step, ready for the code instead.
  await expect(page.getByLabel('Email address')).toBeEnabled();
});
