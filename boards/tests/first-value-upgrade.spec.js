import { expect, test } from '@playwright/test';

// First-value upgrade nudge specs.
//
// The nudge is a soft, non-blocking banner shown ONCE to a demo user the first
// time they place a genuine (non-seeded) card — re-timing the upgrade ask to the
// "aha" moment instead of only at the 100-card cap. See:
//   • boards/src/lib/firstValueTrigger.js  — pure gating logic (tested directly)
//   • boards/src/components/FirstValueUpgradeBanner.jsx — the banner
//   • App.jsx — wiring + once-per-account persistence
//
// Two deterministic seams (DEV + ?local=1 only, same trust boundary as the rest
// of localMode.js):
//   • window.__soleilFirstValueTest → the pure genuine-vs-seeded helper
//   • &firstvalue=1                 → force-renders the banner (gated on demo tier)
// Edge-function fetches are stubbed so nothing hits the network.

test.beforeEach(async ({ page }) => {
  await page.route('**/functions/v1/create-checkout-session', (route) =>
    route.fulfill({ json: { ok: true, url: '/pricing' } }));
  await page.route('**/functions/v1/create-portal-session', (route) =>
    route.fulfill({ json: { ok: true, url: '/settings/billing' } }));
});

test('hasGenuineCard: only a real (non-onb-) card counts, never the seeded starters', async ({ page }) => {
  await page.goto('/?local=1&reset=1&tier=demo');
  await page.waitForFunction(() => !!window.__soleilFirstValueTest);

  const cases = await page.evaluate(() => {
    const { hasGenuineCard } = window.__soleilFirstValueTest;
    return {
      mixed:     hasGenuineCard([{ id: 'onb-welcome' }, { id: 'real-card-1' }]),
      seededOnly: hasGenuineCard([{ id: 'onb-welcome' }, { id: 'onb-try' }, { id: 'onb-tip' }]),
      oneReal:   hasGenuineCard([{ id: 'abc123' }]),
      empty:     hasGenuineCard([]),
      nullish:   hasGenuineCard(null),
      garbage:   hasGenuineCard([{}, { id: '' }, null]),
    };
  });

  expect(cases.mixed).toBe(true);
  expect(cases.seededOnly).toBe(false);
  expect(cases.oneReal).toBe(true);
  expect(cases.empty).toBe(false);
  expect(cases.nullish).toBe(false);
  expect(cases.garbage).toBe(false);
});

test('isSeedCard / genuineCards: onboarding seeds (onb-*) are excluded from genuine placements', async ({ page }) => {
  await page.goto('/?local=1&reset=1&tier=demo');
  await page.waitForFunction(() => !!window.__soleilFirstValueTest);

  const r = await page.evaluate(() => {
    const { isSeedCard, genuineCards } = window.__soleilFirstValueTest;
    return {
      seed:        isSeedCard({ id: 'onb-welcome' }),
      real:        isSeedCard({ id: 'real-1' }),
      nullish:     isSeedCard(null),
      genuineOnly: genuineCards([{ id: 'onb-welcome' }, { id: 'onb-try' }, { id: 'real-1' }]).map((c) => c.id),
      allSeeds:    genuineCards([{ id: 'onb-welcome' }, { id: 'onb-try' }, { id: 'onb-tip' }]).length,
      empty:       genuineCards([]).length,
    };
  });

  expect(r.seed).toBe(true);
  expect(r.real).toBe(false);
  expect(r.nullish).toBe(false);
  expect(r.genuineOnly).toEqual(['real-1']);
  expect(r.allSeeds).toBe(0);   // a pure seed batch yields zero genuine cards → no card_placed fires
  expect(r.empty).toBe(0);
});

test('a demo user sees the soft banner, and "See Creator" opens the first-value modal', async ({ page }) => {
  await page.goto('/?local=1&reset=1&tier=demo&onboarded=1&firstvalue=1');

  const banner = page.locator('.fv-banner');
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('button', { name: 'See Creator' })).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Not now' })).toBeVisible();

  await banner.getByRole('button', { name: 'See Creator' }).click();

  // Opens the existing upgrade modal with the warm "first-value" framing (title
  // "You're building something.", not the cap-hit "Your work outgrew the demo."
  // wall) and the canonical Get Creator CTA.
  const modal = page.locator('.upgrade-modal');
  await expect(modal).toBeVisible();
  await expect(modal.getByText(/You're building something/i)).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Get Creator' })).toBeVisible();
  // The banner yields to the modal.
  await expect(banner).toHaveCount(0);
});

test('"Not now" dismisses the banner', async ({ page }) => {
  await page.goto('/?local=1&reset=1&tier=demo&onboarded=1&firstvalue=1');

  const banner = page.locator('.fv-banner');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Not now' }).click();
  await expect(banner).toHaveCount(0);
});

test('the banner never shows for a paid user (demo-gated)', async ({ page }) => {
  await page.goto('/?local=1&reset=1&tier=paid&onboarded=1&firstvalue=1');
  // App boots (upgrade chip is demo-only, so just assert the canvas/topbar exists)
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.fv-banner')).toHaveCount(0);
});
