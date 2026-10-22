// Back from Stripe Checkout leaves the Creator button usable (ACCOUNT-09).
//
// The CTA went busy and left via location.assign; Safari's back/forward cache
// restored the page exactly as it was left, busy and disabled, and nothing
// cleared it. A real bfcache round trip to Stripe can't run here, so the
// checkout request is held open (the page is "mid-redirect") and the restore
// is signalled the way the browser signals it: pageshow with persisted=true.
import { expect, test } from '@playwright/test';

test('a bfcache restore clears the busy Creator button on /pricing', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('sb-local-auth-token', '1');
      // startCheckout needs an access token before it will fetch; the dev
      // server's fake project is https://example.supabase.co.
      const exp = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem('sb-example-auth-token', JSON.stringify({
        access_token: 'e2e', refresh_token: 'e2e', token_type: 'bearer',
        expires_in: 3600, expires_at: exp,
        user: { id: '00000000-0000-4000-8000-000000000001', email: 'e2e@local.test', aud: 'authenticated', role: 'authenticated' },
      }));
    } catch (_) {}
  });
  await page.route('**/rest/v1/analytics_events**', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: '[]' }));
  // Never answered: the button stays busy the way it does while leaving.
  await page.route('**/functions/v1/create-checkout-session*', () => {});
  await page.goto('/pricing?local=1&tier=demo');

  const buy = page.locator('.pp-buy');
  await buy.getByRole('button', { name: 'Get Creator' }).click();
  await expect(buy.getByRole('button', { name: 'Opening checkout…' })).toBeDisabled();

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(buy.getByRole('button', { name: 'Get Creator' })).toBeEnabled();
});
