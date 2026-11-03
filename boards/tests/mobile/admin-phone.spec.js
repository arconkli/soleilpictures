// The phone admin panel (pages/admin/phone/) in the dev-only fixture harness:
// /admin?adminpreview=1&phone=1. No auth, no network; numbers come from
// src/local/AdminPreviewHarness.jsx and adminPhoneFixtures.js.

import { test, expect } from '@playwright/test';

const T = { timeout: 20000 };
let errors;

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const open = (page, extra = '') => page.goto(`/admin?adminpreview=1&phone=1${extra}`);

test('Today shows the three numbers, the week rows, signups and what needs a look', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('ap-active-now').locator('b')).toHaveText('14', T);
  await expect(page.getByTestId('ap-paying').locator('b')).toHaveText('138');
  await expect(page.getByTestId('ap-signups-today')).toBeVisible();

  await expect(page.getByRole('heading', { name: 'This week vs last' })).toBeVisible();
  await expect(page.locator('[data-testid^="ap-row-"]')).toHaveCount(6);
  for (const id of ['signups', 'wau', 'checkouts']) await expect(page.getByTestId(`ap-row-${id}`)).toBeVisible();
  await expect(page.getByTestId('ap-row-signups')).toContainText(/[▲▼]/);

  await expect(page.getByRole('heading', { name: 'Newest signups' })).toBeVisible();
  const people = page.locator('.ap-who > div');
  expect(await people.count()).toBeGreaterThan(0);
  expect(await people.count()).toBeLessThanOrEqual(5);
  await expect(page.getByRole('heading', { name: 'Needs a look' })).toBeVisible();
});

test('a week row opens a sheet with a link to the full admin, and the backdrop closes it', async ({ page }) => {
  await open(page);
  await page.getByTestId('ap-row-wau').click(T);
  const sheet = page.getByRole('dialog', { name: 'Active people' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Open full admin' })).toHaveAttribute('href', '/admin?tab=overview&full=1');
  await page.locator('.ap-sheet-bg').click({ position: { x: 10, y: 10 } });
  await expect(sheet).toHaveCount(0);
});

test('the tab bar has Today, Posts and Boards, with the unposted count on Posts', async ({ page }) => {
  await open(page);
  const tabs = page.getByRole('tablist', { name: 'Admin' }).getByRole('tab');
  await expect(tabs).toHaveCount(3, T);
  await expect(page.getByRole('tab', { name: /^Today/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: /^Posts/ })).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('tab', { name: /^Boards/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Posts/ }).locator('.ap-badge')).toHaveText('2', T);
  // Clusters is a plain link beside the tablist, not a fourth tab.
  const home = page.getByRole('link', { name: 'Clusters', exact: true });
  await expect(home).toBeVisible();
  await expect(home).toHaveAttribute('href', '/');
  await expect(tabs).toHaveCount(3);
});

test('Posts lists how the last ones did and today\'s cards; Posted sticks across a reload', async ({ page }) => {
  await open(page, '&tab=posts');
  await expect(page.getByRole('heading', { name: 'How the last ones did' })).toBeVisible(T);
  const did = page.locator('.ap-did .r');
  await expect(did).toHaveCount(6);
  for (let n = 4; n <= 9; n++) await expect(did.nth(n - 4)).toContainText(`#${n}`);

  for (const n of [14, 15]) {
    const card = page.getByTestId(`ap-post-${n}`);
    await expect(card).toBeVisible();
    for (const name of ['Save all', 'Copy text', 'Posted']) await expect(card.getByRole('button', { name, exact: true })).toBeVisible();
    const imgs = card.locator('.ap-strip img');
    await expect(imgs).toHaveCount(n === 14 ? 6 : 4, T);
    for (const src of await imgs.evaluateAll((els) => els.map((e) => e.src))) expect(src).toMatch(/^blob:/);
    await expect.poll(() => imgs.evaluateAll((els) => els.every((e) => e.complete && e.naturalWidth > 0))).toBe(true);
  }

  const card = page.getByTestId('ap-post-14');
  await card.getByRole('button', { name: 'Posted', exact: true }).click();
  await expect(card).toHaveClass(/is-done/);
  await expect(card.locator('.is-posted')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('tab', { name: /^Posts/ }).locator('.ap-badge')).toHaveText('1');
  await expect.poll(() => page.evaluate(() => window.__phonePosted)).toEqual([14]);

  await open(page, '&tab=posts');
  await expect(page.getByTestId('ap-post-14')).toHaveClass(/is-done/, T);
  await expect(page.getByTestId('ap-post-15')).not.toHaveClass(/is-done/);
});

test('Earlier expands a day to show its posts', async ({ page }) => {
  await open(page, '&tab=posts');
  const day = page.getByRole('button', { name: /4 posts/ });
  await expect(day).toBeVisible(T);
  await expect(page.getByTestId('ap-post-10')).toHaveCount(0);
  await day.click();
  for (const n of [10, 11, 12, 13]) await expect(page.getByTestId(`ap-post-${n}`)).toBeVisible();
});

test('the Boards tab shows the boards library and puts ?tab=boards in the URL', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('ap-paying')).toBeVisible(T);
  await page.getByRole('tab', { name: /^Boards/ }).click();
  await expect(page.locator('.ab-tile').first()).toBeVisible(T);
  await expect(page.getByRole('tab', { name: /^Boards/ })).toHaveAttribute('aria-selected', 'true');
  expect(new URL(page.url()).searchParams.get('tab')).toBe('boards');
});
