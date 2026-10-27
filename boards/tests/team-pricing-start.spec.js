// team-pricing-start.spec.js — the Team card on the signed-out /pricing and the
// way through sign-in to the setup (lib/teamStart.js). The card is on
// everywhere since the Team launch (teamPricingAllowed).
import { test, expect } from '@playwright/test';
import { bootSignedIn } from './helpers/signedInStub.js';

const KEY = 'soleil.boards.pending.team.start';

test('signed out: the third card; Start keeps the seats and billing through sign-in, which says so', async ({ page }) => {
  await page.goto('/pricing');
  const card = page.locator('.pp-plan-team');
  await expect(card).toBeVisible();
  await expect(page.locator('.pp-plans .pp-plan')).toHaveCount(3);
  await expect(page.locator('table.pp-compare-team thead th').nth(3)).toHaveText('Team');

  await page.getByRole('tab', { name: /Annual/ }).click();
  await card.getByRole('button', { name: 'One more seat' }).click();
  await card.getByRole('button', { name: 'Start a Team trial' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  const kept = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  expect(kept).toMatchObject({ seats: 13, billing: 'annual' });
  await expect(page.locator('.auth-hint')).toContainText('Sign in to start your Team trial');
});

test('signed out: Start free drops a kept Team start', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.locator('.pp-plan-team')).toBeVisible();
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ seats: 8, billing: 'monthly', at: Date.now() })), KEY);
  await page.locator('.pp-plan-free .pp-plan-cta').click();
  await page.waitForURL((u) => u.pathname === '/');
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
});

test('signed in: a kept Team start opens the setup with its seats and billing, once', async ({ page }) => {
  await page.addInitScript((k) => {
    try {
      if (!sessionStorage.getItem('stashed')) {
        localStorage.setItem(k, JSON.stringify({ seats: 14, billing: 'annual', at: Date.now() }));
        sessionStorage.setItem('stashed', '1');
      }
    } catch (_) {}
  }, KEY);
  await bootSignedIn(page);
  await page.waitForURL((u) => u.pathname === '/team/new', { timeout: 15000 });
  expect(new URL(page.url()).search).toBe('?seats=14&billing=annual');
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
});
