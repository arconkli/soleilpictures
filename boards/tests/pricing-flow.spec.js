import { expect, test } from '@playwright/test';

// Pricing / upgrade / billing flow specs.
//
// These run on the desktop-chrome project against the dev server's FAKE
// Supabase env, so real RPC/edge calls can't succeed. Two affordances make the
// tier-gated surfaces deterministic:
//   • ?local=1            → AuthGate injects a fake signed-in user (existing
//                           local-QA seam in localMode.js).
//   • &tier=demo|paid|... → useMyTier reads the forced tier from the URL
//                           (qaTierOverride, DEV+?local=1-guarded) instead of
//                           calling get_my_tier.
// Edge-function fetches are stubbed so nothing hits the network.
//
// Not covered here (needs a live tier flip the URL seam can't simulate): the
// WaitlistConfirm acceptance auto-advance and the create-checkout-session
// double-subscription server guard — those are verified by code review + the
// edge function's own logic.

test.beforeEach(async ({ page }) => {
  await page.route('**/functions/v1/verify-checkout-session', (route) =>
    route.fulfill({ json: { activated: false, reason: 'not_paid_yet' } }));
  await page.route('**/functions/v1/create-checkout-session', (route) =>
    route.fulfill({ json: { ok: true, url: '/pricing' } }));
  await page.route('**/functions/v1/create-portal-session', (route) =>
    route.fulfill({ json: { ok: true, url: '/settings/billing' } }));
  // /pricing now short-circuits to the SIGNED-OUT public page when no cached
  // Supabase session exists (main.jsx hasCachedSession). These specs exercise
  // the AUTHED, tier-aware page — seed a fake session marker so the app takes
  // the signed-in path and the ?local=1 fake-user seam kicks in as before.
  await page.addInitScript(() => {
    try { localStorage.setItem('sb-local-auth-token', '1'); } catch (_) {}
  });
});

test('pricing page shows the canonical Creator list and the trimmed Demo list', async ({ page }) => {
  await page.goto('/pricing?local=1&tier=demo');

  const creator = page.locator('.pricing-card-creator');
  await expect(creator).toBeVisible();

  // Canonical Creator features (the public list, mirrored everywhere).
  // Storage leads the list — it's the clearest paid differentiator.
  await expect(creator.getByText('100GB storage — upload any file type, no size limit')).toBeVisible();
  await expect(creator.getByText('Unlimited visitors with Edit Mode')).toBeVisible();
  await expect(creator.getByText('Unlimited workspaces, boards & files')).toBeVisible();
  await expect(creator.getByText('All Creative Tools available')).toBeVisible();
  await expect(creator.getByText('Access to all Virtual + Social events')).toBeVisible();
  // High-res exports was removed from the offering — must not reappear.
  await expect(page.getByText(/high.?res/i)).toHaveCount(0);

  // Monthly-first default: $25/mo (annual-default drove pricing abandons).
  // Toggle to annual → $20/mo with the savings badge.
  await expect(creator.locator('.pricing-card-price')).toContainText('$25');
  await creator.getByRole('tab', { name: 'Annual' }).click();
  await expect(creator.locator('.pricing-card-price')).toContainText('$20');
  await expect(creator.getByText('Save 20%')).toBeVisible();

  // CTA wording is centralized.
  await expect(creator.getByRole('button', { name: 'Get Creator' })).toBeVisible();

  // Demo card: just the 100-card sandbox + view-only framing. No audio/boards detail.
  const demo = page.locator('.pricing-card-demo');
  await expect(demo).toContainText('100 cards');
  await expect(demo).toContainText('View Mode only');
  await expect(demo).not.toContainText('audio');
  await expect(demo).not.toContainText('editable boards');
});

test('an already-paid user is routed to manage billing, not a second checkout', async ({ page }) => {
  await page.goto('/pricing?local=1&tier=paid');

  const creator = page.locator('.pricing-card-creator');
  await expect(creator).toBeVisible();
  await expect(creator.getByRole('button', { name: /Manage billing/ })).toBeVisible();
  await expect(creator.getByRole('button', { name: 'Get Creator' })).toHaveCount(0);
  // No plan toggle / price for someone who already subscribed.
  await expect(creator.locator('.pricing-card-toggle')).toHaveCount(0);
  await expect(creator).toContainText('already on Creator');
});

test('the in-app upgrade modal matches the pricing page copy', async ({ page }) => {
  await page.goto('/?local=1&reset=1&tier=demo');

  const chip = page.locator('.upgrade-chip');
  await expect(chip).toBeVisible();
  await chip.click();

  const modal = page.locator('.upgrade-modal');
  await expect(modal).toBeVisible();
  // Same canonical Creator features as the public page.
  await expect(modal.getByText('Unlimited visitors with Edit Mode')).toBeVisible();
  await expect(modal.getByText('Access to all Virtual + Social events')).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Get Creator' })).toBeVisible();
  await expect(modal.getByText(/high.?res/i)).toHaveCount(0);
});

test('checkout success without a session_id shows a recovery card (no dead-end)', async ({ page }) => {
  await page.goto('/pricing/success?local=1&tier=demo');

  await expect(page.getByText(/NO CHECKOUT FOUND/i)).toBeVisible();
  await expect(page.getByText(/couldn't find a checkout session/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to pricing' })).toBeVisible();
});

test('a completed checkout shows a Welcome celebration before entering', async ({ page }) => {
  await page.goto('/pricing/success?local=1&tier=paid&session_id=cs_test_celebrate');

  // Celebration appears immediately (it redirects to "/" ~2.4s later).
  await expect(page.getByText(/Welcome to Creator/i)).toBeVisible({ timeout: 2000 });
});

test('a pending waitlist user sees status + a skip-the-wait price from billingCopy', async ({ page }) => {
  // maybeSingle() fetches as a list, so stub an array with one pending row.
  await page.route('**/rest/v1/waitlist_entries**', (route) =>
    route.fulfill({ json: [{ status: 'pending' }] }));

  await page.goto('/waitlist/status?local=1&tier=waitlist');

  await expect(page.getByText("We'll be in touch soon.")).toBeVisible();
  // Skip CTA price comes from billingCopy (monthly-first $25/mo → annual $20/mo).
  const skip = page.locator('.waitlist-skip');
  await expect(skip.getByRole('button', { name: 'Subscribe — $25/mo' })).toBeVisible();
  await skip.getByRole('tab', { name: 'Annual' }).click();
  await expect(skip.getByRole('button', { name: 'Subscribe — $20/mo' })).toBeVisible();
});

test('a waitlist user with no application is offered a path forward', async ({ page }) => {
  await page.route('**/rest/v1/waitlist_entries**', (route) => route.fulfill({ json: [] }));

  await page.goto('/waitlist/status?local=1&tier=waitlist');

  await expect(page.getByText('Pick a path to continue.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'See Pricing →' })).toBeVisible();
});
