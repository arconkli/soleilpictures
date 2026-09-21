import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';

const byName = (rows, name) => rows.filter((r) => r.event === name);
import { DEMO_CARD_LIMIT } from '../src/lib/demoCardCap.js';

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

test('pricing page states the price high, leads with the free action, and shows the three real limits', async ({ page }) => {
  await page.goto('/pricing?local=1&tier=demo');

  // The page is a scrolling public page now, on the same shell as the
  // comparison pages almost all of its traffic arrives from — not the fixed,
  // centred .pricing-screen it shared with .welcome-screen and the error panel.
  await expect(page.locator('.public-shell.seo-shell')).toBeVisible();
  await expect(page.locator('.pricing-screen')).toHaveCount(0);

  // The PRICE is above the fold even though the ACTION is the free start.
  // People who open a pricing page came for the number.
  await expect(page.locator('.seo-subhead')).toContainText('$25/mo');
  // And the CAP is on the free plan CARD. It used to be in this same subhead,
  // because there were no plan cards and the subhead was carrying the entire
  // offer in one sentence — both prices, the cap, the collaborator rule and
  // two promises about what free is not. The claim did not move surfaces by
  // accident; it moved onto the card that makes it.
  await expect(page.locator('.pp-plan-free')).toContainText(`${DEMO_CARD_LIMIT} cards`);

  // Both plans, side by side, without scrolling. This is what a pricing page
  // is and what this one did not have: free was a prose section, Creator was a
  // table, and the only buy surface was a 460px box alone on an empty screen
  // 2,300px down. If a future edit puts either plan below the fold at a
  // laptop viewport, that regression is this assertion's whole subject.
  await expect(page.locator('.pp-plan')).toHaveCount(2);
  await expect(page.locator('.pp-plan-free')).toBeInViewport();
  await expect(page.locator('.pp-plan-creator')).toBeInViewport();

  // Real product, not a feature list: a published board in a browser frame.
  const frame = page.locator('.seo-frame');
  await expect(frame).toBeVisible();
  await expect(frame.locator('img')).toHaveAttribute('src', /^\/landing\/.+\.webp$/);
  await expect(frame.locator('a.seo-frame-shot')).toHaveAttribute('href', /^\/c\//);

  // The three differences that are actually enforced in code — the card cap
  // trigger, the file-type gate, and the free per-file ceilings — as a
  // comparison rather than four abstract bullets.
  const table = page.locator('.seo-compare');
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await expect(table).toContainText('Unlimited');
  await expect(table).toContainText('Any file');
  await expect(table).toContainText('No limit');

  // High-res exports was removed from the offering — must not reappear.
  await expect(page.getByText(/high.?res/i)).toHaveCount(0);
  // These three shipped and were false: 'edit access' became free for every
  // tier in migration 0188, and the other two never had an implementation.
  // They must never come back.
  await expect(page.getByText(/edit access/i)).toHaveCount(0);
  await expect(page.getByText('Every creative tool')).toHaveCount(0);
  await expect(page.getByText('All Virtual + Social events')).toHaveCount(0);

  // Monthly-first default: $25/mo (annual-default drove pricing abandons).
  // Toggle to annual → $20/mo with the savings badge.
  const buy = page.locator('.pp-buy');
  await expect(buy.locator('.pricing-card-price')).toContainText('$25');
  await buy.getByRole('tab', { name: 'Annual' }).click();
  await expect(buy.locator('.pricing-card-price')).toContainText('$20');
  await expect(buy.getByText('Save 20%')).toBeVisible();

  // CTA wording is centralized, and it is on the Creator card itself.
  await expect(buy.getByRole('button', { name: 'Get Creator' })).toBeVisible();
  // This route is the SIGNED-IN one (the suite seeds an auth marker), and a
  // signed-in demo account is already on the free plan — so it is offered no
  // free action anywhere on the page. It used to be offered a jump link down
  // to what Creator changes instead; that link is gone because the thing it
  // jumped to is now on screen beside the free card. What must NOT happen is
  // the free card's slot collapsing: the two cards' feet would go ragged and
  // the reader would be left unsure which plan they are on.
  await expect(page.getByRole('button', { name: 'Start free' })).toHaveCount(0);
  await expect(page.locator('.pp-plan-free')).toContainText('Your current plan');

  // The free plan: the card cap is the only real limit. It is NOT view-only —
  // 0188 made editor collaboration free for every tier — and clusters/boards
  // were never capped, so the free tier says so plainly. This describes the
  // plan a NEW account gets, so it is DEMO_CARD_LIMIT and not whatever cap the
  // viewer's own account carries.
  const free = page.locator('.pp-free-list');
  await expect(free).toContainText(`${DEMO_CARD_LIMIT} cards`);
  await expect(free).toContainText('Unlimited clusters');
  await expect(free).toContainText('Free collaboration');
  await expect(free).not.toContainText('View Mode only');
  // Audio appears in the comparison as a free SIZE cap, which is honest; it
  // must not appear in the free plan's feature list as something sold.
  await expect(free).not.toContainText('audio');

  // The trial is never offered here, signed in or out. Standing decision.
  await expect(page.getByText(/days free|free for 14 days/i)).toHaveCount(0);
});

test('both plans AND both buttons are on the first screen of a small laptop', async ({ page }) => {
  // 1280x720 is the smallest laptop this page is read on, and it is the one
  // that catches a hero creeping back up in size — a pricing page whose BUY
  // BUTTON needs a scroll has lost the argument before making it.
  //
  // Measured before this layout, at exactly this viewport: the only buy
  // surface on the page sat at y=2300 of a 3,116px document, below a prose
  // section about the free plan and a comparison table. Measured during it,
  // with the plan cards in but the hero still two lines tall: y=773 of 720.
  //
  // This is a fold BUDGET, not a pixel assertion. Anything may be spent
  // differently — headline size, card padding, benefit leading — as long as
  // the four things a person came here for still land on the first screen.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/pricing?local=1&tier=demo&cards=0');
  await page.locator('.pp-plan-creator').waitFor();
  // Fonts decide the headline's line count, and the line count is most of the
  // budget. Measuring before they settle reports a page that does not exist —
  // an earlier version of this check did exactly that and passed on a layout
  // that was, once loaded, 100px over.
  await page.evaluate(() => document.fonts.ready);

  // The free card's action slot is a BUTTON when there is a free action to
  // offer and a "Your current plan" panel when there is not — this suite seeds
  // an auth marker, so it is the latter here. Either way it is the row that
  // has to clear the fold, which is why the check takes whichever is there
  // rather than assuming the signed-out shape.
  for (const sel of [
    '.pp-plan-free', '.pp-plan-creator',
    '.pp-plan-free :is(.pp-plan-cta, .pp-plan-current)', '.pp-buy-cta',
  ]) {
    await expect(page.locator(sel), `${sel} must be on the first screen`).toBeInViewport({ ratio: 0.9 });
  }

  // And the headline is the one line it was cut down to be. Two lines here is
  // ~60px, which is most of the margin the buttons are clearing the fold by.
  const h1 = await page.locator('.seo-h1').evaluate((el) => ({
    h: el.getBoundingClientRect().height,
    lh: parseFloat(getComputedStyle(el).lineHeight),
  }));
  expect(Math.round(h1.h / h1.lh), 'the /pricing headline sets on one line').toBe(1);
});

test('on a short laptop the whole offer is reachable, top and bottom', async ({ page }) => {
  // The modal grew when the benefits gained explanations, and a centred grid
  // item taller than the viewport overflows in BOTH directions with no way to
  // scroll back to it. Measured before the fix at 660px of viewport: a 697px
  // modal, `overflow-y: visible`, and the primary CTA below the fold with no
  // way to reach it. flex + `margin: auto` on the panel is what makes the top
  // reachable; place-items: center is what did not.
  await page.setViewportSize({ width: 1440, height: 660 });
  await page.goto('/?local=1&reset=1&tier=demo&cards=42&limit=50');
  await page.locator('.upgrade-chip').click();

  const modal = page.locator('.upgrade-modal');
  await expect(modal).toBeVisible();
  const backdrop = page.locator('.upgrade-backdrop');

  // It really is taller than the viewport here — otherwise this test proves
  // nothing and would keep passing after a regression.
  const { scrollH, clientH, overflowY } = await backdrop.evaluate((el) => ({
    scrollH: el.scrollHeight, clientH: el.clientHeight, overflowY: getComputedStyle(el).overflowY,
  }));
  expect(scrollH, 'the offer must exceed this viewport for the test to mean anything').toBeGreaterThan(clientH);
  expect(overflowY, 'the backdrop must be able to scroll').toBe('auto');

  // The top is reachable: scroll to 0 and the eyebrow is on screen.
  await backdrop.evaluate((el) => { el.scrollTop = 0; });
  const topBox = await modal.boundingBox();
  expect(topBox.y, 'the top of the modal must not sit above the viewport').toBeGreaterThanOrEqual(0);
  await expect(page.locator('.upgrade-eyebrow')).toBeInViewport();

  // And the bottom is reachable: the primary CTA can be scrolled to and clicked.
  const cta = page.locator('.pricing-cta-primary');
  await cta.scrollIntoViewIfNeeded();
  await expect(cta).toBeInViewport();
});

test('on a phone the sheet keeps a real close button in reach', async ({ page }) => {
  // The paywall becomes a bottom sheet at phone width and the SHEET is the
  // scroll container, so an absolutely-positioned close scrolls away with the
  // content — measured at 390x700 it ended at y:-56, entirely off screen. It
  // is sticky now, and `flex: none` is load-bearing: height is the MAIN axis
  // in a column flex container, so the default shrink collapsed the 44px tap
  // target to its 22px line-height under an overflowing sheet.
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/?local=1&reset=1&tier=demo&cards=42&limit=50');
  await page.locator('.upgrade-chip').click();

  const modal = page.locator('.upgrade-modal');
  await expect(modal).toBeVisible();
  const { scrollH, clientH } = await modal.evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
  expect(scrollH, 'the sheet must overflow here or this proves nothing').toBeGreaterThan(clientH);

  const close = page.locator('.upgrade-close');
  const box = await close.boundingBox();
  expect(box.height, 'the phone tap-target floor').toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);

  // Scroll the sheet to the bottom; the close must still be on screen.
  await modal.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const after = await close.boundingBox();
  expect(after.y, 'the close must not scroll out of the sheet').toBeGreaterThanOrEqual(0);
  await expect(close).toBeInViewport();
});

test('an already-paid user is routed to manage billing, not a second checkout', async ({ page }) => {
  await page.goto('/pricing?local=1&tier=paid');

  const buy = page.locator('.pp-buy');
  await expect(buy).toBeVisible();
  await expect(buy.getByRole('button', { name: /Manage billing/ })).toBeVisible();
  await expect(buy.getByRole('button', { name: 'Get Creator' })).toHaveCount(0);
  // No plan toggle / price for someone who already subscribed.
  await expect(buy.locator('.pricing-card-toggle')).toHaveCount(0);
  await expect(buy).toContainText('already on Creator');
});

test('the in-app upgrade modal matches the pricing page copy, and offers the trial to a real body of work', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await page.goto('/?local=1&reset=1&tier=demo&cards=60&limit=100');

  const chip = page.locator('.upgrade-chip');
  await expect(chip).toBeVisible();
  await chip.click();

  const modal = page.locator('.upgrade-modal');
  await expect(modal).toBeVisible();
  // Same canonical Creator features as the public page. (Substrings chosen to
  // sit only in the feature list, not the modal's subhead copy.)
  await expect(modal.getByText('Any file type')).toBeVisible();
  await expect(modal.getByText('No size limits')).toBeVisible();
  await expect(modal.getByText('All Virtual + Social events')).toHaveCount(0);
  await expect(modal.getByText(/high.?res/i)).toHaveCount(0);

  // Sixty cards is a real body of work, so the in-product button is the trial
  // — with the terms under it — and the request carries the flag for the
  // server to re-decide.
  const cta = modal.getByRole('button', { name: /Try Creator free for \d+ days/ });
  await expect(cta).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Get Creator' })).toHaveCount(0);
  await expect(modal.locator('.upgrade-trial-note')).toContainText(/Card required/);
  await cta.click();
  // The harness has no session, so startCheckout stops before any fetch; the
  // must-land intent and the classified error are what prove the flag rode
  // along (checkout.js sends the same `trial` in the request body).
  await expect.poll(() => byName(rows, 'pricing_creator_intent').length, { timeout: 8000 }).toBeGreaterThan(0);
  const intent = byName(rows, 'pricing_creator_intent')[0];
  expect(intent.props.trial).toBe(true);
  expect(intent.props.plan).toBe('monthly');
  await expect.poll(() => byName(rows, 'checkout_error').length, { timeout: 8000 }).toBeGreaterThan(0);
  const err = byName(rows, 'checkout_error')[0];
  expect(err.props.trial).toBe(true);
  expect(err.props.kind).toBe('auth');
});

test('an account that already had its trial is offered Creator, not a second trial', async ({ page }) => {
  await page.goto('/?local=1&reset=1&tier=demo&cards=60&limit=100&trialed=1');
  await page.locator('.upgrade-chip').click();
  const modal = page.locator('.upgrade-modal');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Get Creator' })).toBeVisible();
  await expect(modal.getByRole('button', { name: /Try Creator/ })).toHaveCount(0);
  await expect(modal.locator('.upgrade-trial-note')).toHaveCount(0);
});

test('a first-day account with a handful of cards is not offered the trial', async ({ page }) => {
  // The chip is suppressed at this depth; the first-value banner is the way in.
  await page.goto('/?local=1&reset=1&tier=demo&cards=5&limit=50&onboarded=1&firstvalue=1');
  await page.locator('.fv-banner').getByRole('button', { name: 'See Creator' }).click();
  const modal = page.locator('.upgrade-modal');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Get Creator' })).toBeVisible();
  await expect(modal.getByRole('button', { name: /Try Creator/ })).toHaveCount(0);
});

test('the signed-in /pricing route never offers the trial', async ({ page }) => {
  await page.goto('/pricing?local=1&tier=demo&cards=60&limit=100');
  const buy = page.locator('.pp-buy');
  await expect(buy.getByRole('button', { name: 'Get Creator' })).toBeVisible();
  await expect(buy.getByRole('button', { name: /Try Creator/ })).toHaveCount(0);
});

test('the signed-OUT page leads with the free action, because it cannot sell', async ({ page }) => {
  // main.jsx routes PublicPricingPage only when there is NO cached Supabase
  // session. The suite's beforeEach seeds one via addInitScript, which re-runs
  // on every navigation and survives clearCookies — so undo it with a later
  // init script, which runs after it.
  await page.addInitScript(() => {
    try { localStorage.removeItem('sb-local-auth-token'); } catch (_) {}
  });
  await page.goto('/pricing');

  // The primary action is free-to-start. Not a softening of the offer — the
  // price is in the subhead above it — but a correction: a signed-out visitor
  // has no session to bill, so "Get Creator" here has only ever been able to
  // send them to sign in.
  // On the free plan CARD, beside the priced one, so the two are compared
  // rather than read in sequence. The hero carries no button at all now — it
  // is a headline and one line, because the cards are directly beneath it.
  const free = page.locator('.pp-plan-free');
  await expect(free.getByRole('button', { name: 'Start free' })).toBeVisible();
  await expect(free).toBeInViewport();
  await expect(page.locator('.seo-subhead')).toContainText('$25/mo');

  // And the closing band repeats the free action, not the paid one.
  await expect(page.locator('.seo-cta-band').getByRole('button', { name: 'Start free' })).toBeVisible();

  // The trial is in-product only. A signed-out visitor has built nothing and
  // could not be eligible anyway, but the page must not imply otherwise.
  await expect(page.getByText(/days free|free for 14 days|free trial/i)).toHaveCount(0);
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
