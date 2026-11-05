// The phone admin panel's Sources, Money, Sharing, Problems and Emails pages
// (pages/admin/phone/Phone{Sources,Money,Sharing,Problems,Emails}.jsx) in the
// dev-only fixture harness: /admin?adminpreview=1&phone=1&page=<id>. No auth, no
// network; numbers come from src/local/adminFixtures.js.

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

const PAGES = [
  { id: 'sources', h1: 'Sources', figures: 2 },
  { id: 'money', h1: 'Money', figures: 4 },
  { id: 'sharing', h1: 'Sharing', figures: 2 },
  { id: 'problems', h1: 'Problems', figures: 1 },
  { id: 'emails', h1: 'Emails', figures: 1 },
];

const go = (page, id) => page.goto(`/admin?adminpreview=1&phone=1&page=${id}`);

// Wait until no figure is still a loading placeholder.
const settled = (page, id) => expect(page.getByTestId(`ap-page-${id}`).locator('.ap-skel')).toHaveCount(0, T);

for (const p of PAGES) {
  test(`${p.id}: the deep link shows the page, its figures, clean text and no overflow`, async ({ page }) => {
    await go(page, p.id);
    const root = page.getByTestId(`ap-page-${p.id}`);
    await expect(root).toBeVisible(T);
    await expect(root.getByRole('heading', { level: 1, name: p.h1 })).toBeVisible();
    await expect(root.locator('figure.ap-f')).toHaveCount(p.figures);
    await settled(page, p.id);

    const text = await root.innerText();
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
    expect(text).not.toMatch(/@/); // no email addresses on screen

    const fit = await page.evaluate(() => {
      const s = document.querySelector('.ap-scroll');
      return { sw: s.scrollWidth, cw: s.clientWidth };
    });
    expect(fit.sw).toBeLessThanOrEqual(fit.cw);

    await expect(root.getByRole('link', { name: 'Open full admin' })).toBeVisible();
  });

  test(`${p.id}: "‹ Today" returns to the home`, async ({ page }) => {
    await go(page, p.id);
    const root = page.getByTestId(`ap-page-${p.id}`);
    await expect(root).toBeVisible(T);
    await root.getByRole('button', { name: /Today/ }).click();
    await expect(root).toHaveCount(0);
    await expect(page.getByTestId('ap-lead')).toBeVisible(T);
    await expect(page).not.toHaveURL(/page=/);
  });
}

test('sources: the 7 | 30 days chips switch and the bars change', async ({ page }) => {
  await go(page, 'sources');
  const root = page.getByTestId('ap-page-sources');
  const d30 = root.getByRole('button', { name: '30 days' });
  const d7 = root.getByRole('button', { name: '7 days' });
  await expect(d30).toHaveAttribute('aria-pressed', 'true', T);
  await expect(d7).toHaveAttribute('aria-pressed', 'false');
  const first = root.locator('figure.ap-f').first();
  await expect(first.locator('.ap-rk').first()).toBeVisible(T);
  const before = await first.innerText();
  expect(before).toContain('signups in 30 days');

  await d7.click();
  await expect(d7).toHaveAttribute('aria-pressed', 'true');
  await expect(d30).toHaveAttribute('aria-pressed', 'false');
  await expect(first).toContainText('in 7 days');
  const after = await first.innerText();
  expect(after).not.toBe(before);
  expect(after).not.toMatch(/NaN|undefined|Infinity/);

  await d30.click();
  await expect(first).toContainText('signups in 30 days');
});

test('sources: who comes back names its group and counts small groups', async ({ page }) => {
  await go(page, 'sources');
  const fig = page.getByTestId('ap-page-sources').locator('figure.ap-f').nth(1);
  await expect(fig).toContainText('Who comes back, by source', T);
  await expect(fig).toContainText('different group from Figure 1');
  await expect(fig.locator('.ap-rk').first()).toBeVisible(T);
  expect(await fig.locator('.ap-rk').count()).toBeGreaterThan(2);
  await expect(fig).toContainText(/\d+ of \d+/); // a group under 15 shows counts
});

test('money: tiles, ladder, reasons, trial and the card-limit bar', async ({ page }) => {
  await go(page, 'money');
  const root = page.getByTestId('ap-page-money');
  await settled(page, 'money');
  await expect(root.locator('.ap-ns > div')).toHaveCount(4, T);
  await expect(root).toContainText('payments failing');
  await expect(root).toContainText('From offer to paying');
  await expect(root.locator('.ap-lad > div')).toHaveCount(5);
  await expect(root).toContainText('Why people said not yet');
  await expect(root).toContainText('Could try it today');
  await expect(root.locator('.ap-split')).toBeVisible();
});

test('sharing: the open week is hollow and the table dashes a step a route cannot have', async ({ page }) => {
  await go(page, 'sharing');
  const root = page.getByTestId('ap-page-sharing');
  await settled(page, 'sharing');
  await expect(root.locator('.ap-b-open')).toHaveCount(1, T);
  const rows = root.locator('.ap-tbl tbody tr');
  expect(await rows.count()).toBeGreaterThan(3);
  await expect(root.locator('.ap-tbl')).toContainText('—');
  await expect(root.locator('.ap-tbl')).toContainText('Emailed invitation');
  await expect(root).toContainText(/Invitations sent in the last 30 days: \d+/);
  await expect(root).toContainText('The table counts signups by the share they came through');
});

test('problems: browsers, not people, and one dot each', async ({ page }) => {
  await go(page, 'problems');
  const root = page.getByTestId('ap-page-problems');
  await settled(page, 'problems');
  await expect(root).toContainText('browsers affected', T);
  await expect(root).toContainText('new problems');
  expect(await root.innerText()).not.toMatch(/people affected/i);
  const dots = await root.locator('.ap-crowd i').count();
  expect(dots).toBeGreaterThan(0);
  expect(dots).toBeLessThanOrEqual(100);
});

test('emails: one row per template with friendly names and honest opens', async ({ page }) => {
  await go(page, 'emails');
  const root = page.getByTestId('ap-page-emails');
  await settled(page, 'emails');
  await expect(root.locator('.ap-em').first()).toBeVisible(T);
  await expect(root).toContainText('Product update');
  await expect(root).toContainText('no opens recorded');
  await expect(root).toContainText(/\d+ of \d+ opened/); // under 15 delivered: counts
  await expect(root).toContainText('File comment digest'); // an id with no name falls back to its words
});
