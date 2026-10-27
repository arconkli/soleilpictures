// Walking through buying Team (the preview): the third card on /pricing and
// the setup at /team/new. Mounted through src/local/teamProbe.js (?local=1
// renders its own shell, so the pricing view and the setup are mounted over
// it); the routes' own guards are pinned by teamPreviewWiring.test.mjs.
import { expect, test } from '@playwright/test';

async function boot(page) {
  await page.goto('/?local=1&reset=1&blank=1&tier=admin');
  await page.waitForLoadState('domcontentloaded');
}

async function mountPricing(page, args = {}) {
  await boot(page);
  await page.evaluate(async (a) => {
    const m = await import('/src/local/teamProbe.js');
    m.mountPricingTeam(a);
  }, args);
  const card = page.locator('.pp-plan-team');
  await expect(card).toBeVisible();
  return card;
}

async function mountSetup(page, search = '') {
  await boot(page);
  await page.evaluate(async (s) => {
    const m = await import('/src/local/teamProbe.js');
    m.mountTeamSetup({ search: s });
  }, search);
  const panel = page.locator('.su-panel');
  await expect(panel).toBeVisible();
  return panel;
}

const nav = (page) => page.evaluate(() => window.__teamBuy.nav);

test('pricing: three cards; the seat stepper follows the sum, never below 3; annual shows per-month and per-year; Start and Talk to us', async ({ page }) => {
  const card = await mountPricing(page);
  await expect(page.locator('.pp-plans .pp-plan')).toHaveCount(3);
  await expect(card).toContainText('More than 10 editors');
  // The owner (2026-10-26): the benefits are shown, in Creator's look.
  await expect(card.locator('.pricing-benefit-t')).toHaveText([
    'Everything in Creator, for each editor', '1TB a seat, one shared drive', 'More than 10 people who edit',
    'Admins, and work the team owns', 'Their own workspaces, too', 'Join by link or company email',
  ]);
  const compare = page.locator('table.pp-compare-team');
  await expect(compare.locator('thead th').nth(3)).toHaveText('Team');
  await expect(compare.locator('tbody tr')).toHaveCount(6);
  await expect(compare.getByRole('row', { name: /People who edit/ })).toContainText('A seat each, 3 to 100');
  await expect(card.locator('[data-seats]')).toHaveText('12');
  await expect(card.locator('[data-seat-sum]')).toHaveText('$300/mo');
  await card.getByRole('button', { name: 'One more seat' }).click();
  await expect(card.locator('[data-seats]')).toHaveText('13');
  await expect(card.locator('[data-seat-sum]')).toHaveText('$325/mo');
  for (let i = 0; i < 12; i += 1) await card.getByRole('button', { name: 'One fewer seat' }).click({ force: true });
  await expect(card.locator('[data-seats]')).toHaveText('3');
  await expect(card.getByRole('button', { name: 'One fewer seat' })).toBeDisabled();

  await page.getByRole('tab', { name: /Annual/ }).click();
  await expect(card.locator('.pp-plan-price')).toContainText('$20');
  await expect(card.locator('[data-seat-sum]')).toHaveText('$720/yr');

  await card.getByRole('button', { name: 'Start a Team trial' }).click();
  expect(await page.evaluate(() => window.__teamBuy.started)).toEqual([{ seats: 3, plan: 'annual' }]);

  // Talk to us is a page of its own (team-talk.spec.js walks it).
  await expect(page.getByRole('link', { name: 'Talk to us' })).toHaveAttribute('href', '/pricing/talk-to-us');
});

test('setup: workspaces, seats, billing, Stripe preview line, invites and the way back', async ({ page }) => {
  const panel = await mountSetup(page, '?seats=12&billing=annual');
  await expect(panel.getByRole('checkbox')).toHaveCount(4);
  await expect(panel.getByRole('checkbox', { checked: true })).toHaveCount(3);
  await expect(panel).toContainText('Step 1 of 3');

  await panel.getByRole('checkbox', { name: /Music videos/ }).click();
  await panel.getByRole('button', { name: 'Continue' }).click();
  await expect(panel).toContainText('10 people edit these workspaces today');
  await panel.getByRole('button', { name: 'Back' }).click();
  await panel.getByRole('checkbox', { name: /Music videos/ }).click();
  await panel.getByRole('button', { name: 'Continue' }).click();

  await expect(panel).toContainText('12 people edit these workspaces today');
  await expect(panel).toContainText('12 seats × $240');
  await expect(panel).toContainText('$2,880 a year');
  await panel.getByRole('radio', { name: /Monthly/ }).click();
  await expect(panel).toContainText('12 seats × $25');
  await expect(panel).toContainText('$300 a month');

  await panel.getByRole('button', { name: /Continue to payment/ }).click();
  await expect(panel).toContainText('Preview: this is where Stripe takes the card. Nothing was charged.');
  await panel.locator('textarea').fill('lena@northlight.studio, marcus@northlight.studio');
  await expect(panel.getByRole('button', { name: 'Send 2 invites' })).toBeVisible();
  await panel.getByRole('button', { name: 'Show me how' }).click();
  await expect(panel).toContainText('soleil-verification=');
  await panel.getByRole('button', { name: 'Send 2 invites' }).click();

  await expect(panel).toContainText('Northlight Films is ready');
  await expect(panel).toContainText('2 invites sent');
  await expect(panel).toContainText('Lena and Marcus can view.');
  await panel.getByRole('button', { name: 'Open the team page' }).click();
  expect(await nav(page)).toEqual(['/']);
  const keys = await page.evaluate(() => ({
    as: localStorage.getItem('soleil.preview.teamAs'),
    boot: sessionStorage.getItem('soleil.preview.openTeamPage'),
  }));
  expect(keys).toEqual({ as: 'owner', boot: '1' });
});

test('a typed team name reaches the done step and is kept for the team page', async ({ page }) => {
  const panel = await mountSetup(page);
  await panel.getByLabel('Team name').fill('Lumen Pictures');
  await panel.getByRole('button', { name: 'Continue' }).click();
  await panel.getByRole('button', { name: /Continue to payment/ }).click();
  await panel.getByRole('button', { name: 'Skip for now' }).click();
  await expect(panel).toContainText('Lumen Pictures is ready');
  await panel.getByRole('button', { name: 'Open the team page' }).click();
  expect(await page.evaluate(() => localStorage.getItem('soleil.preview.teamName'))).toBe('Lumen Pictures');
});

test('on a phone the setup panel fits and the pricing cards stack', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await mountSetup(page, '?seats=12&billing=annual');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const box = await panel.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(391);
  await panel.getByRole('button', { name: 'Continue' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  const card = await mountPricing(page);
  const xs = await page.locator('.pp-plans .pp-plan').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(new Set(xs).size).toBe(1);
  await expect(card).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
