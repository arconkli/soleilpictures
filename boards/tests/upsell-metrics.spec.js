// Upsell exposure instrumentation (up_* family) — asserts the behavioral
// telemetry actually lands at the PostgREST layer on the real surfaces:
// the chip→modal path, feature-row hover detection, dismiss methods, the
// CTA/error path, the invite alternative, the /pricing page summary + trace,
// and the public page's trace-suppression rule (lp_trace owns anon visitors).
//
// Same harness as pricing-flow.spec.js: dev server's FAKE Supabase env,
// ?local=1 fake user + &tier= override, edge functions stubbed. Note that in
// this harness startCheckout throws 'Not signed in.' BEFORE any fetch (no real
// session), which conveniently exercises the intent→error path: the must-land
// pricing_creator_intent still fires, error_seen lands in the summary, and no
// navigation happens.
//
// Dev StrictMode double-mounts each surface, ending a throwaway exposure
// (~0ms summary with dismiss_method 'nav') before the real one — assertions
// poll for the REAL rows (specific dismiss_method / outcome), mirroring
// landing-metrics.spec.js.

import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';

const byName = (rows, name) => rows.filter((r) => r.event === name);

test.beforeEach(async ({ page }) => {
  await page.route('**/functions/v1/verify-checkout-session', (route) =>
    route.fulfill({ json: { activated: false, reason: 'not_paid_yet' } }));
  await page.route('**/functions/v1/create-checkout-session', (route) =>
    route.fulfill({ json: { ok: true, url: '/pricing' } }));
  await page.route('**/functions/v1/create-portal-session', (route) =>
    route.fulfill({ json: { ok: true, url: '/settings/billing' } }));
});

// /pricing routes to the SIGNED-OUT public page unless a cached Supabase
// session marker exists (main.jsx hasCachedSession) — seed it for the
// signed-in surfaces only.
async function seedAuthMarker(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('sb-local-auth-token', '1'); } catch (_) {}
  });
}

// Hover a zone long enough to count as a read (FEATURE_HOVER_MS=300), then
// move off it so the pointerout closes the measurement.
async function hoverAndLeave(page, sel, offSel) {
  await page.hover(sel);
  await page.waitForTimeout(450);
  await page.hover(offSel);
}

test('chip → modal: entry click, feature-row read, toggle, and Escape dismiss all land', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await seedAuthMarker(page);
  await page.goto('/?local=1&reset=1&tier=demo');

  const chip = page.locator('.upgrade-chip');
  await expect(chip).toBeVisible();
  await chip.click();

  const modal = page.locator('.upgrade-modal');
  await expect(modal).toBeVisible();

  // Read the storage pitch line (row 1), then the plan toggle, then bail via Esc.
  await hoverAndLeave(page, '.upgrade-modal [data-up-feat="1"]', '.upgrade-modal .upgrade-title');
  await modal.getByRole('tab', { name: 'Annual' }).click();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  // The Esc summary beacons on close and flushes the whole queue with it.
  await expect.poll(
    () => byName(rows, 'up_exposure_summary').some((r) => r.props.dismiss_method === 'esc'),
    { timeout: 8000 },
  ).toBe(true);

  const chipClick = byName(rows, 'up_chip_click')[0];
  expect(chipClick).toBeTruthy();
  expect(typeof chipClick.props.count).toBe('number');
  expect(typeof chipClick.props.limit).toBe('number');

  const view = byName(rows, 'pricing_view').find((r) => r.props.surface === 'modal');
  expect(view.props.via).toBe('chip');
  expect(view.props.copy_rev).toBeTruthy();
  expect(typeof view.props.exposure_n).toBe('number');

  const hover = byName(rows, 'up_feature_hover')[0];
  expect(hover.props.row).toBe(1);
  expect(hover.props.key).toBe('storage');
  expect(hover.props.ms).toBeGreaterThanOrEqual(300);

  const abandon = byName(rows, 'pricing_abandon').find((r) => r.props.method === 'esc');
  expect(abandon.props.toggles_n).toBe(1);
  expect(typeof abandon.props.dwell_ms).toBe('number');

  const summary = byName(rows, 'up_exposure_summary').find((r) => r.props.dismiss_method === 'esc');
  expect(summary.props.outcome).toBe('dismiss');
  expect(summary.props.surface).toBe('modal');
  expect(summary.props.via).toBe('chip');
  expect(summary.props.tier).toBe('demo');
  expect(summary.props.toggles_n).toBe(1);
  expect(summary.props.toggle_seq).toBe('m>a');
  expect(summary.props.plan_final).toBe('annual');
  expect(summary.props.feat_rows).toContain(1);
  expect(summary.props.feat_ms).toBeGreaterThanOrEqual(300);
  expect(typeof summary.props.ttfi_ms).toBe('number');
  expect(summary.props.error_seen).toBe(false);
});

test('CTA click: enriched must-land intent fires, and the summary keeps outcome cta with error_seen', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await seedAuthMarker(page);
  await page.goto('/?local=1&reset=1&tier=demo');

  await page.locator('.upgrade-chip').click();
  const modal = page.locator('.upgrade-modal');
  await expect(modal).toBeVisible();

  // No real session → startCheckout throws before any fetch; the intent beacon
  // has already fired and the modal shows the inline error.
  await modal.getByRole('button', { name: 'Get Creator' }).click();
  await expect(modal.locator('.auth-error')).toBeVisible();

  await expect.poll(() => byName(rows, 'pricing_creator_intent').length, { timeout: 8000 }).toBeGreaterThan(0);
  const intent = byName(rows, 'pricing_creator_intent')[0];
  expect(intent.props.surface).toBe('modal');
  expect(intent.props.via).toBe('chip');
  expect(typeof intent.props.exposure_n).toBe('number');
  expect(typeof intent.props.dwell_ms).toBe('number');
  expect(typeof intent.props.ttfi_ms).toBe('number');

  // Closing after the error must NOT overwrite the cta outcome (first wins).
  await page.keyboard.press('Escape');
  await expect.poll(
    () => byName(rows, 'up_exposure_summary').some((r) => r.props.outcome === 'cta'),
    { timeout: 8000 },
  ).toBe(true);
  const summary = byName(rows, 'up_exposure_summary').find((r) => r.props.outcome === 'cta');
  expect(summary.props.dismiss_method).toBe(null);
  expect(summary.props.error_seen).toBe(true);
  // The post-error close is an abandon (redirect was cancelled by the failure).
  expect(byName(rows, 'pricing_abandon').some((r) => r.props.method === 'esc')).toBe(true);
});

test('the invite-friends alternative records its own event and the invite_alt outcome', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await seedAuthMarker(page);
  await page.goto('/?local=1&reset=1&tier=demo');

  await page.locator('.upgrade-chip').click();
  const modal = page.locator('.upgrade-modal');
  await expect(modal).toBeVisible();
  await modal.locator('.upgrade-invite-alt').click();
  await expect(modal).toHaveCount(0);

  await expect.poll(
    () => byName(rows, 'up_exposure_summary').some((r) => r.props.outcome === 'invite_alt'),
    { timeout: 8000 },
  ).toBe(true);
  const alt = byName(rows, 'up_invite_alt_click')[0];
  expect(alt.props.surface).toBe('modal');
  expect(alt.props.via).toBe('chip');
  expect(typeof alt.props.dwell_ms).toBe('number');
});

test('/pricing page: summary beacons on pagehide with surface page + a PII-safe up_trace', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await seedAuthMarker(page);
  // The harness's fake user counts as genuinely-new, which opens the ps_*
  // journey and (correctly) suppresses up_trace. Stamp the journey done to
  // simulate the RETURNING user this trace exists for.
  await page.addInitScript(() => {
    try { localStorage.setItem('soleil_ps_done_local-qa-user', '1'); } catch (_) {}
  });
  await page.goto('/pricing?local=1&tier=demo');

  const creator = page.locator('.pricing-card-creator');
  await expect(creator).toBeVisible();
  await creator.getByRole('tab', { name: 'Annual' }).click();
  await creator.getByRole('tab', { name: 'Monthly' }).click();

  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(
    () => byName(rows, 'up_exposure_summary').some(
      (r) => r.props.surface === 'page' && r.props.toggles_n === 2,
    ),
    { timeout: 8000 },
  ).toBe(true);

  const summary = byName(rows, 'up_exposure_summary')
    .find((r) => r.props.surface === 'page' && r.props.toggles_n === 2);
  expect(summary.props.toggle_seq).toBe('m>a>m');
  expect(summary.props.plan_final).toBe('monthly');

  const view = byName(rows, 'pricing_view').find((r) => r.props.surface === 'page');
  expect(typeof view.props.exposure_n).toBe('number');

  // The trace arms on the signed-in page (no journey open in the harness) and
  // its records are structural identities only — never values or keystrokes.
  const traces = byName(rows, 'up_trace');
  expect(traces.length).toBeGreaterThan(0);
  const recs = traces.flatMap((t) => t.props.ev);
  expect(recs.some((r) => r.k === 'click')).toBe(true);
  expect(recs.every((r) => !('value' in r) && !('text' in r))).toBe(true);
});

test('public /pricing: envelope on pricing_view, Creator-only data attributes, and NO up_trace (lp_trace owns anon)', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  await page.goto('/pricing');   // no session marker → the signed-out public page

  const creator = page.locator('.pricing-card-creator');
  await expect(creator).toBeVisible();

  // The shared FeatureList stamps hover keys on the Creator list ONLY.
  await expect(creator.locator('[data-up-feat]')).toHaveCount(5);
  await expect(page.locator('.pricing-card-demo [data-up-feat]')).toHaveCount(0);

  // Interact, then leave — anon interaction belongs to lp_trace, not up_trace.
  await creator.getByRole('tab', { name: 'Annual' }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

  // Poll for the REAL exposure's summary (the StrictMode throwaway fires one
  // with zero interactions first).
  await expect.poll(
    () => byName(rows, 'up_exposure_summary').some(
      (r) => r.props.surface === 'public_page' && r.props.toggles_n >= 1,
    ),
    { timeout: 8000 },
  ).toBe(true);

  const view = byName(rows, 'pricing_view').find((r) => r.props.surface === 'public_page');
  expect(view.props.copy_rev).toBeTruthy();     // was missing on this surface pre-up_*
  expect(view.props.tier).toBe('signed_out');

  expect(byName(rows, 'up_trace').length).toBe(0);
  const summary = byName(rows, 'up_exposure_summary')
    .find((r) => r.props.surface === 'public_page' && r.props.toggles_n >= 1);
  expect(summary.props.tier).toBe('signed_out');
});
